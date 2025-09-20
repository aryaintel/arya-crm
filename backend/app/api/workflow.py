# backend/app/api/workflow.py
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.orm import Session
from sqlalchemy import select, func

from .deps import get_db, get_current_user
from ..models import (
    Scenario,
    ScenarioBOQItem,
    ScenarioOverhead,   # TWC varsayımları burada tutuluyor
    ScenarioCapex,
    ScenarioService,
)

router = APIRouter(
    prefix="/scenarios",
    tags=["workflow"],
)

# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------
def _get_scenario(db: Session, scenario_id: int) -> Scenario:
    sc = db.get(Scenario, scenario_id)
    if not sc:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return sc

def _counts(db: Session, scenario_id: int) -> Dict[str, int]:
    boq_active = db.execute(
        select(func.count(ScenarioBOQItem.id)).where(
            ScenarioBOQItem.scenario_id == scenario_id,
            ScenarioBOQItem.is_active.is_(True),
        )
    ).scalar_one() or 0

    # TWC: Varsayımları ScenarioOverhead tarafında saklıyoruz (sabit satırlar olabilir)
    twc_rows = db.execute(
        select(func.count(ScenarioOverhead.id)).where(
            ScenarioOverhead.scenario_id == scenario_id
        )
    ).scalar_one() or 0

    capex_active = db.execute(
        select(func.count(ScenarioCapex.id)).where(
            ScenarioCapex.scenario_id == scenario_id,
            (ScenarioCapex.is_active.is_(True)) | (ScenarioCapex.is_active.is_(None)),
        )
    ).scalar_one() or 0

    services_active = db.execute(
        select(func.count(ScenarioService.id)).where(
            ScenarioService.scenario_id == scenario_id,
            ScenarioService.is_active.is_(True),
        )
    ).scalar_one() or 0

    return {
        "boq_active": int(boq_active),
        "twc_rows": int(twc_rows),
        "capex_active": int(capex_active),
        "services_active": int(services_active),
    }

def _status_payload(sc: Scenario, c: Dict[str, int]) -> Dict[str, Any]:
    # Mevcut bayraklar (SQLite’ta INTEGER 0/1 olarak saklı)
    is_boq_ready = bool(getattr(sc, "is_boq_ready", False))
    is_twc_ready = bool(getattr(sc, "is_twc_ready", False))
    is_capex_ready = bool(getattr(sc, "is_capex_ready", False))
    is_services_ready = bool(getattr(sc, "is_services_ready", False))
    workflow_state = getattr(sc, "workflow_state", "draft") or "draft"

    # Aşama sırası: BOQ -> TWC -> CAPEX -> SERVICES -> READY
    if not is_boq_ready:
        next_step = "boq"
    elif not is_twc_ready:
        next_step = "twc"
    elif not is_capex_ready:
        next_step = "capex"
    elif not is_services_ready:
        next_step = "services"
    else:
        next_step = "ready"

    return {
        "scenario_id": sc.id,
        "state": workflow_state,
        "flags": {
            "is_boq_ready": is_boq_ready,
            "is_twc_ready": is_twc_ready,
            "is_capex_ready": is_capex_ready,
            "is_services_ready": is_services_ready,
        },
        "counts": c,
        "next_step": next_step,
    }

def _require(condition: bool, message: str) -> None:
    if not condition:
        raise HTTPException(status_code=400, detail=message)

# -------------------------------------------------------------------
# GET /workflow  → durum
# -------------------------------------------------------------------
@router.get(
    "/{scenario_id}/workflow",
    summary="Get workflow status of a scenario",
)
def get_workflow_status(
    scenario_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _user = Depends(get_current_user),
):
    sc = _get_scenario(db, scenario_id)
    cnt = _counts(db, scenario_id)
    return _status_payload(sc, cnt)

# -------------------------------------------------------------------
# POST /workflow/mark-twc-ready
# Gereksinim: BOQ hazır + aktif BOQ satırı
# -------------------------------------------------------------------
@router.post(
    "/{scenario_id}/workflow/mark-twc-ready",
    status_code=status.HTTP_200_OK,
    summary="Mark TWC as ready (requires BOQ ready & active items) and move to CAPEX",
)
def mark_twc_ready(
    scenario_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _user = Depends(get_current_user),
):
    sc = _get_scenario(db, scenario_id)
    cnt = _counts(db, scenario_id)

    _require(bool(getattr(sc, "is_boq_ready", False)), "BOQ must be marked ready first.")
    _require(cnt["boq_active"] > 0, "At least one active BOQ item is required.")

    setattr(sc, "is_twc_ready", True)
    setattr(sc, "workflow_state", "twc_ready")
    db.add(sc)
    db.commit()
    db.refresh(sc)

    return _status_payload(sc, _counts(db, scenario_id))

# -------------------------------------------------------------------
# POST /workflow/mark-capex-ready
# Gereksinim: TWC hazır + en az bir CAPEX
# -------------------------------------------------------------------
@router.post(
    "/{scenario_id}/workflow/mark-capex-ready",
    status_code=status.HTTP_200_OK,
    summary="Mark CAPEX as ready (requires TWC ready & at least one CAPEX item) and move to SERVICES",
)
def mark_capex_ready(
    scenario_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _user = Depends(get_current_user),
):
    sc = _get_scenario(db, scenario_id)
    cnt = _counts(db, scenario_id)

    _require(bool(getattr(sc, "is_twc_ready", False)), "TWC must be marked ready first.")
    _require(cnt["capex_active"] > 0, "At least one CAPEX item is required.")

    setattr(sc, "is_capex_ready", True)
    setattr(sc, "workflow_state", "capex_ready")
    db.add(sc)
    db.commit()
    db.refresh(sc)

    return _status_payload(sc, _counts(db, scenario_id))

# -------------------------------------------------------------------
# POST /workflow/mark-services-ready
# Gereksinim: CAPEX hazır + en az bir aktif service
# -------------------------------------------------------------------
@router.post(
    "/{scenario_id}/workflow/mark-services-ready",
    status_code=status.HTTP_200_OK,
    summary="Mark SERVICES as ready (requires CAPEX ready & at least one active service) and move to READY",
)
def mark_services_ready(
    scenario_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _user = Depends(get_current_user),
):
    sc = _get_scenario(db, scenario_id)
    cnt = _counts(db, scenario_id)

    _require(bool(getattr(sc, "is_capex_ready", False)), "CAPEX must be marked ready first.")
    _require(cnt["services_active"] > 0, "At least one active service item is required.")

    setattr(sc, "is_services_ready", True)

    # Tüm adımlar tamamlandıysa workflow_state = ready
    if all([
        bool(getattr(sc, "is_boq_ready", False)),
        bool(getattr(sc, "is_twc_ready", False)),
        bool(getattr(sc, "is_capex_ready", False)),
        True,  # az önce services hazırlandı
    ]):
        setattr(sc, "workflow_state", "ready")
    else:
        setattr(sc, "workflow_state", "services_ready")

    db.add(sc)
    db.commit()
    db.refresh(sc)

    return _status_payload(sc, _counts(db, scenario_id))

# -------------------------------------------------------------------
# POST /workflow/reset  → tüm bayrakları temizle, draft'a dön
# NOT: Precomputed aylık tabloları silmiyoruz; sadece bayraklar.
# -------------------------------------------------------------------
@router.post(
    "/{scenario_id}/workflow/reset",
    status_code=status.HTTP_200_OK,
    summary="Reset workflow back to draft (flags cleared)",
)
def reset_workflow(
    scenario_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _user = Depends(get_current_user),
):
    sc = _get_scenario(db, scenario_id)

    setattr(sc, "is_boq_ready", False)
    setattr(sc, "is_twc_ready", False)
    setattr(sc, "is_capex_ready", False)
    setattr(sc, "is_services_ready", False)
    setattr(sc, "workflow_state", "draft")

    db.add(sc)
    db.commit()
    db.refresh(sc)

    return _status_payload(sc, _counts(db, scenario_id))
