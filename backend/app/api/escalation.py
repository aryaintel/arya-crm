# backend/app/api/escalation.py
from __future__ import annotations

from enum import Enum
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, conint, confloat

# Projedeki common deps – kendi projenizde ne kullanıyorsanız onu import edin
# Burada Session dependency'yi opsiyonel bıraktım; model entegrasyonunda aktif edeceğiz.
try:
    from sqlalchemy.orm import Session
    from ..core.db import get_db  # sizin projedeki DB dependency (örn. core/db.py)
except Exception:  # pragma: no cover - skeleton çalışma kolaylığı için
    Session = object  # type: ignore
    def get_db():     # type: ignore
        return None

router = APIRouter(tags=["Escalation"])

# ===============================
# Pydantic Schemas (v1 - Skeleton)
# ===============================
class EscalationScope(str, Enum):
    services = "services"
    capex = "capex"
    all = "all"

class EscalationMethod(str, Enum):
    fixed = "fixed"      # sabit % artış (yıllık vs.)
    index = "index"      # endeks bazlı (CPI, PPI, vs.)

class EscalationFrequency(str, Enum):
    none = "none"
    annual = "annual"
    quarterly = "quarterly"
    monthly = "monthly"

class EscalationPolicyBase(BaseModel):
    name: str = Field(..., max_length=255)
    scope: EscalationScope = EscalationScope.all
    method: EscalationMethod = EscalationMethod.fixed

    # fixed method
    fixed_pct: Optional[confloat(ge=0, le=100)] = 0

    # index method (MVP: sadece bir index kodu + baz periyot)
    index_code: Optional[str] = Field(None, description="Örn: TUFE, PPI, USDTRY")
    base_year: Optional[conint(ge=1900, le=2300)] = None
    base_month: Optional[conint(ge=1, le=12)] = None

    # artış uygulama sıklığı
    freq: EscalationFrequency = EscalationFrequency.annual

    notes: Optional[str] = None
    is_active: bool = True

class EscalationPolicyCreate(EscalationPolicyBase):
    pass

class EscalationPolicyUpdate(EscalationPolicyBase):
    pass

class EscalationPolicyOut(EscalationPolicyBase):
    id: int
    scenario_id: int

# Resolve (önizleme) cevabı
class EscalationResolveItem(BaseModel):
    name: str
    scope: EscalationScope
    method: EscalationMethod
    # örn. 2025/09 için çözülmüş efektif artış (yıllık % veya oran)
    effective_pct: float
    source: Optional[str] = None   # "fixed: 5%" / "index: CPI y/y" gibi
    matched_policy_id: Optional[int] = None

class EscalationResolveResponse(BaseModel):
    year: int
    month: int
    items: List[EscalationResolveItem] = []


# =========================================================
# Endpoints (v1 skeleton) – Şimdilik DB’siz, boş/örnek döner
# =========================================================

@router.get(
    "/scenarios/{scenario_id}/escalation-policies",
    response_model=List[EscalationPolicyOut],
)
def list_escalation_policies(scenario_id: int, db: Session = Depends(get_db)):
    """
    Şimdilik boş liste döner. Model entegrasyonu sonrası:
    - ScenarioEscalationPolicy tablosundan aktif kayıtlar getirilecek.
    """
    # TODO: DB entegrasyonu
    return []


@router.post(
    "/scenarios/{scenario_id}/escalation-policies",
    response_model=EscalationPolicyOut,
)
def create_escalation_policy(
    scenario_id: int,
    body: EscalationPolicyCreate,
    db: Session = Depends(get_db),
):
    """
    Skeleton: 501 Not Implemented.
    Model eklenince kayıt oluşturulacak.
    """
    raise HTTPException(status_code=501, detail="Not implemented yet (skeleton).")


@router.put(
    "/scenarios/{scenario_id}/escalation-policies/{policy_id}",
    response_model=EscalationPolicyOut,
)
def update_escalation_policy(
    scenario_id: int,
    policy_id: int,
    body: EscalationPolicyUpdate,
    db: Session = Depends(get_db),
):
    """
    Skeleton: 501 Not Implemented.
    """
    raise HTTPException(status_code=501, detail="Not implemented yet (skeleton).")


@router.delete(
    "/scenarios/{scenario_id}/escalation-policies/{policy_id}",
    status_code=204,
)
def delete_escalation_policy(
    scenario_id: int,
    policy_id: int,
    db: Session = Depends(get_db),
):
    """
    Skeleton: 501 Not Implemented.
    """
    raise HTTPException(status_code=501, detail="Not implemented yet (skeleton).")


@router.get(
    "/scenarios/{scenario_id}/escalation/resolve",
    response_model=EscalationResolveResponse,
)
def resolve_escalation(
    scenario_id: int,
    year: int = Query(..., ge=1900, le=2300),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
):
    """
    Önizleme amaçlı: verilen (yıl/ay) için uygulanacak efektif artışları döndürür.
    Şimdilik boş döner. Model + kural motoru eklendiğinde gerçek değerler hesaplanacak.
    """
    # TODO: DB'den aktif politikaları çek, metoda göre efektif_pct hesapla
    return EscalationResolveResponse(year=year, month=month, items=[])
