from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
from sqlalchemy.orm import Session, sessionmaker
from ..core.config import engine
from ..models import ScenarioRebate, ScenarioRebateTier, ScenarioRebateLump

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

router = APIRouter(prefix="/scenarios", tags=["rebates"])

# ---------- Schemas ----------
class RebateTierIn(BaseModel):
    min_value: float = 0
    max_value: Optional[float] = None
    percent: Optional[float] = None
    amount: Optional[float] = None
    description: Optional[str] = None
    sort_order: int = 0

class RebateLumpIn(BaseModel):
    year: int
    month: int
    amount: float
    currency: str = "USD"
    note: Optional[str] = None

class RebateIn(BaseModel):
    name: str
    scope: str = Field("all", pattern="^(all|boq|services|product)$")
    kind: str = Field("percent", pattern="^(percent|tier_percent|lump_sum)$")
    basis: str = Field("revenue", pattern="^(revenue|volume)$")
    product_id: Optional[int] = None
    valid_from_year: Optional[int] = None
    valid_from_month: Optional[int] = None
    valid_to_year: Optional[int] = None
    valid_to_month: Optional[int] = None
    accrual_method: str = Field("monthly", pattern="^(monthly|quarterly|annual|on_invoice)$")
    pay_month_lag: Optional[int] = 0
    is_active: bool = True
    notes: Optional[str] = None
    # details
    percent: Optional[float] = None        # flat percent (kind=percent)
    tiers: Optional[List[RebateTierIn]] = None
    lumps: Optional[List[RebateLumpIn]] = None

class RebateOut(BaseModel):
    id: int
    name: str
    scope: str
    kind: str
    basis: str
    product_id: Optional[int]
    valid_from_year: Optional[int]
    valid_from_month: Optional[int]
    valid_to_year: Optional[int]
    valid_to_month: Optional[int]
    accrual_method: str
    pay_month_lag: Optional[int]
    is_active: bool
    notes: Optional[str]

    class Config:
        from_attributes = True

# ---------- Endpoints ----------
@router.get("/{scenario_id}/rebates", response_model=List[RebateOut])
def list_rebates(
    scenario_id: int,
    include_details: bool = False,  # şimdilik listede kullanılmıyor; ileride genişletebiliriz
    db: Session = Depends(get_db),
):
    rows = (
        db.query(ScenarioRebate)
        .filter(ScenarioRebate.scenario_id == scenario_id)
        .order_by(ScenarioRebate.id.desc())
        .all()
    )
    return rows

@router.post("/{scenario_id}/rebates", response_model=RebateOut)
def create_rebate(scenario_id: int, body: RebateIn, db: Session = Depends(get_db)):
    r = ScenarioRebate(
        scenario_id=scenario_id,
        name=body.name,
        scope=body.scope,
        kind=body.kind,
        basis=body.basis,
        product_id=body.product_id,
        valid_from_year=body.valid_from_year,
        valid_from_month=body.valid_from_month,
        valid_to_year=body.valid_to_year,
        valid_to_month=body.valid_to_month,
        accrual_method=body.accrual_method,
        pay_month_lag=body.pay_month_lag,
        is_active=body.is_active,
        notes=body.notes,
    )
    db.add(r)
    db.flush()

    # details
    if body.kind == "percent" and body.percent is not None:
        # yüzdeyi tek tier olarak saklayalım
        db.add(ScenarioRebateTier(
            rebate_id=r.id, min_value=0, max_value=None, percent=body.percent, sort_order=0
        ))
    if body.kind == "tier_percent" and body.tiers:
        for i, t in enumerate(body.tiers):
            db.add(ScenarioRebateTier(
                rebate_id=r.id,
                min_value=t.min_value,
                max_value=t.max_value,
                percent=t.percent,
                amount=t.amount,
                description=t.description,
                sort_order=t.sort_order if t.sort_order is not None else i,
            ))
    if body.kind == "lump_sum" and body.lumps:
        for l in body.lumps:
            db.add(ScenarioRebateLump(
                rebate_id=r.id, year=l.year, month=l.month,
                amount=l.amount, currency=l.currency, note=l.note
            ))

    db.commit()
    db.refresh(r)
    return r

@router.put("/{scenario_id}/rebates/{rebate_id}", response_model=RebateOut)
def update_rebate(scenario_id: int, rebate_id: int, body: RebateIn, db: Session = Depends(get_db)):
    r = db.query(ScenarioRebate).filter(
        ScenarioRebate.id == rebate_id, ScenarioRebate.scenario_id == scenario_id
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail="Rebate not found")

    for k, v in body.model_dump(exclude={"tiers", "lumps", "percent"}).items():
        setattr(r, k, v)

    # basit yaklaşım: tiers/lumps’ı sil-yeniden yaz
    if body.kind in ("percent", "tier_percent"):
        db.query(ScenarioRebateTier).filter(ScenarioRebateTier.rebate_id == r.id).delete()
        if body.kind == "percent" and body.percent is not None:
            db.add(ScenarioRebateTier(rebate_id=r.id, min_value=0, percent=body.percent, sort_order=0))
        elif body.tiers:
            for i, t in enumerate(body.tiers):
                db.add(ScenarioRebateTier(
                    rebate_id=r.id,
                    min_value=t.min_value,
                    max_value=t.max_value,
                    percent=t.percent,
                    amount=t.amount,
                    description=t.description,
                    sort_order=t.sort_order if t.sort_order is not None else i,
                ))
    elif body.kind == "lump_sum":
        db.query(ScenarioRebateLump).filter(ScenarioRebateLump.rebate_id == r.id).delete()
        if body.lumps:
            for l in body.lumps:
                db.add(ScenarioRebateLump(
                    rebate_id=r.id, year=l.year, month=l.month,
                    amount=l.amount, currency=l.currency, note=l.note
                ))

    db.commit()
    db.refresh(r)
    return r

@router.delete("/{scenario_id}/rebates/{rebate_id}", status_code=204)
def delete_rebate(scenario_id: int, rebate_id: int, db: Session = Depends(get_db)):
    cnt = db.query(ScenarioRebate).filter(
        ScenarioRebate.id == rebate_id, ScenarioRebate.scenario_id == scenario_id
    ).delete()
    if not cnt:
        raise HTTPException(status_code=404, detail="Rebate not found")
    db.commit()
