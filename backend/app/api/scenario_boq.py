from typing import Optional, Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..api.deps import get_db, get_current_user, CurrentUser
from ..models import Scenario, ScenarioBOQItem

router = APIRouter(prefix="/business-cases/scenarios", tags=["boq"])

# ---------- Pydantic şemaları ----------
BOQFrequency = Literal["once", "monthly", "per_shipment", "per_tonne"]
BOQCategory  = Literal["bulk_with_freight", "bulk_ex_freight", "freight"]  # NEW

class BOQCreate(BaseModel):
    section: Optional[str] = None
    item_name: str
    unit: str
    quantity: float = 0
    unit_price: float = 0
    unit_cogs: Optional[float] = None
    frequency: BOQFrequency = "once"
    start_year: Optional[int] = None
    start_month: Optional[int] = Field(default=None, ge=1, le=12)
    months: Optional[int] = None
    is_active: bool = True
    notes: Optional[str] = None
    category: Optional[BOQCategory] = None  # NEW

class BOQUpdate(BaseModel):
    section: Optional[str] = None
    item_name: Optional[str] = None
    unit: Optional[str] = None
    quantity: Optional[float] = None
    unit_price: Optional[float] = None
    unit_cogs: Optional[float] = None
    frequency: Optional[BOQFrequency] = None
    start_year: Optional[int] = None
    start_month: Optional[int] = Field(default=None, ge=1, le=12)
    months: Optional[int] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None
    category: Optional[BOQCategory] = None  # NEW

# ---------- yardımcı ----------
def serialize(it: ScenarioBOQItem) -> dict:
    return {
        "id": it.id,
        "scenario_id": it.scenario_id,
        "section": it.section,
        "item_name": it.item_name,
        "unit": it.unit,
        "quantity": float(it.quantity or 0),
        "unit_price": float(it.unit_price or 0),
        "unit_cogs": float(it.unit_cogs) if it.unit_cogs is not None else None,
        "frequency": it.frequency,
        "start_year": it.start_year,
        "start_month": it.start_month,
        "months": it.months,
        "is_active": bool(it.is_active),
        "notes": it.notes,
        "category": it.category,  # NEW
    }

def ensure_scenario_exists(db: Session, scenario_id: int) -> Scenario:
    sc = db.query(Scenario).filter(Scenario.id == scenario_id).first()
    if not sc:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return sc

# ---------- endpoints ----------
@router.get("/{scenario_id}/boq-items")
def list_boq_items(
    scenario_id: int,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
):
    ensure_scenario_exists(db, scenario_id)
    items = (
        db.query(ScenarioBOQItem)
        .filter(ScenarioBOQItem.scenario_id == scenario_id)
        .order_by(ScenarioBOQItem.id.asc())
        .all()
    )
    return [serialize(it) for it in items]

@router.post("/{scenario_id}/boq-items")
def create_boq_item(
    scenario_id: int,
    body: BOQCreate,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
):
    ensure_scenario_exists(db, scenario_id)
    it = ScenarioBOQItem(
        scenario_id=scenario_id,
        section=body.section,
        item_name=body.item_name.strip(),
        unit=body.unit.strip(),
        quantity=body.quantity or 0,
        unit_price=body.unit_price or 0,
        unit_cogs=body.unit_cogs,
        frequency=body.frequency or "once",
        start_year=body.start_year,
        start_month=body.start_month,
        months=body.months,
        is_active=bool(body.is_active),
        notes=body.notes,
        category=body.category,  # NEW
    )
    db.add(it)
    db.commit()
    db.refresh(it)
    return serialize(it)

@router.patch("/boq-items/{item_id}")
def update_boq_item(
    item_id: int,
    body: BOQUpdate,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
):
    it = db.query(ScenarioBOQItem).filter(ScenarioBOQItem.id == item_id).first()
    if not it:
        raise HTTPException(status_code=404, detail="BOQ item not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(it, field, value)

    db.add(it)
    db.commit()
    db.refresh(it)
    return serialize(it)

@router.delete("/boq-items/{item_id}")
def delete_boq_item(
    item_id: int,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
):
    it = db.query(ScenarioBOQItem).filter(ScenarioBOQItem.id == item_id).first()
    if not it:
        raise HTTPException(status_code=404, detail="BOQ item not found")
    db.delete(it)
    db.commit()
    return {"ok": True}
