# backend/app/api/workflow.py
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Path
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import select, func

from ..models import Scenario, ScenarioBOQItem, ScenarioCapex
from .deps import get_db, get_current_user

router = APIRouter(
    prefix="/scenarios",
    tags=["workflow"],
)

# =========================
# Schemas
# =========================
class WorkflowOut(BaseModel):
    scenario_id: int
    workflow_state: str
    is_boq_ready: bool
    is_twc_ready: bool
    is_capex_ready: bool

# =========================
# Helpers
# =========================
def _get_scenario(db: Session, scenario_id: int) -> Scenario:
    sc = db.get(Scenario, scenario_id)
    if not sc:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return sc

def _must_have_active_boq(db: Session, scenario_id: int) -> None:
    cnt = db.execute(
        select(func.count(ScenarioBOQItem.id))
        .where(ScenarioBOQItem.scenario_id == scenario_id)
        .where(ScenarioBOQItem.is_active.is_(True))
    ).scalar_one()
    if cnt == 0:
        raise HTTPException(
            status_code=400,
            detail="No active BOQ items; cannot proceed to TWC.",
        )

def _must_have_capex(db: Session, scenario_id: int) -> None:
    cnt = db.execute(
        select(func.count(ScenarioCapex.id))
        .where(ScenarioCapex.scenario_id == scenario_id)
    ).scalar_one()
    if cnt == 0:
        raise HTTPException(
            status_code=400,
            detail="No CAPEX items; cannot mark CAPEX as ready.",
        )

# =========================
# Routes
# =========================
@router.get(
    "/{scenario_id}/workflow",
    response_model=WorkflowOut,
    summary="Get workflow status of a scenario",
)
def get_workflow(
    scenario_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    sc = _get_scenario(db, scenario_id)
    return WorkflowOut(
        scenario_id=sc.id,
        workflow_state=sc.workflow_state,
        is_boq_ready=bool(sc.is_boq_ready),
        is_twc_ready=bool(sc.is_twc_ready),
        is_capex_ready=bool(sc.is_capex_ready),
    )

@router.post(
    "/{scenario_id}/workflow/mark-twc-ready",
    response_model=WorkflowOut,
    summary="Mark TWC as ready (requires BOQ ready & active items) and move to CAPEX",
)
def mark_twc_ready(
    scenario_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    sc = _get_scenario(db, scenario_id)

    # Ön koşullar: BOQ hazır + aktif BOQ kaydı var
    if not sc.is_boq_ready:
        raise HTTPException(status_code=400, detail="BOQ not ready yet.")
    _must_have_active_boq(db, scenario_id)

    sc.is_twc_ready = True
    sc.workflow_state = "capex"
    db.add(sc)
    db.commit()
    db.refresh(sc)

    return WorkflowOut(
        scenario_id=sc.id,
        workflow_state=sc.workflow_state,
        is_boq_ready=bool(sc.is_boq_ready),
        is_twc_ready=bool(sc.is_twc_ready),
        is_capex_ready=bool(sc.is_capex_ready),
    )

@router.post(
    "/{scenario_id}/workflow/mark-capex-ready",
    response_model=WorkflowOut,
    summary="Mark CAPEX as ready (requires TWC ready & at least one CAPEX item) and move to READY",
)
def mark_capex_ready(
    scenario_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    sc = _get_scenario(db, scenario_id)

    # Ön koşullar: TWC hazır + en az bir CAPEX kalemi
    if not sc.is_twc_ready:
        raise HTTPException(status_code=400, detail="TWC not ready yet.")
    _must_have_capex(db, scenario_id)

    sc.is_capex_ready = True
    sc.workflow_state = "ready"  # P&L aşamasına geçişe hazır
    db.add(sc)
    db.commit()
    db.refresh(sc)

    return WorkflowOut(
        scenario_id=sc.id,
        workflow_state=sc.workflow_state,
        is_boq_ready=bool(sc.is_boq_ready),
        is_twc_ready=bool(sc.is_twc_ready),
        is_capex_ready=bool(sc.is_capex_ready),
    )

@router.post(
    "/{scenario_id}/workflow/reset",
    response_model=WorkflowOut,
    summary="Reset workflow back to draft (flags cleared)",
)
def reset_workflow(
    scenario_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    sc = _get_scenario(db, scenario_id)
    sc.is_boq_ready = False
    sc.is_twc_ready = False
    sc.is_capex_ready = False
    sc.workflow_state = "draft"
    db.add(sc)
    db.commit()
    db.refresh(sc)

    return WorkflowOut(
        scenario_id=sc.id,
        workflow_state=sc.workflow_state,
        is_boq_ready=bool(sc.is_boq_ready),
        is_twc_ready=bool(sc.is_twc_ready),
        is_capex_ready=bool(sc.is_capex_ready),
    )
