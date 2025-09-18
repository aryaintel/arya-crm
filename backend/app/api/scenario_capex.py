# backend/app/api/scenario_capex.py
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import text

from .deps import get_db, get_current_user, CurrentUser, require_permissions

router = APIRouter(prefix="/business-cases/scenarios", tags=["capex"])


# ---------- Schemas ----------
class CapexIn(BaseModel):
    # Nakit çıkışının olduğu ay
    year: int = Field(..., ge=1900, le=3000)
    month: int = Field(..., ge=1, le=12)
    amount: float
    notes: Optional[str] = None

    # V2: asset & amortisman bilgileri
    asset_name: Optional[str] = None
    category: Optional[str] = None
    service_start_year: Optional[int] = None
    service_start_month: Optional[int] = Field(None, ge=1, le=12)
    useful_life_months: Optional[int] = Field(None, ge=1, le=1200)
    depr_method: Optional[str] = "straight_line"
    salvage_value: Optional[float] = 0
    is_active: Optional[bool] = True

    # V3: i.Capital ilaveleri
    disposal_year: Optional[int] = None
    disposal_month: Optional[int] = Field(None, ge=1, le=12)
    disposal_proceeds: Optional[float] = 0
    replace_at_end: Optional[bool] = False
    per_unit_cost: Optional[float] = None
    quantity: Optional[int] = None
    contingency_pct: Optional[float] = 0  # % olarak (örn 10 => %10)
    partial_month_policy: Optional[str] = "full_month"  # full_month|mid_month


class CapexPatch(BaseModel):
    year: Optional[int] = Field(None, ge=1900, le=3000)
    month: Optional[int] = Field(None, ge=1, le=12)
    amount: Optional[float] = None
    notes: Optional[str] = None

    asset_name: Optional[str] = None
    category: Optional[str] = None
    service_start_year: Optional[int] = None
    service_start_month: Optional[int] = Field(None, ge=1, le=12)
    useful_life_months: Optional[int] = Field(None, ge=1, le=1200)
    depr_method: Optional[str] = None
    salvage_value: Optional[float] = None
    is_active: Optional[bool] = None

    # V3 patch alanları
    disposal_year: Optional[int] = None
    disposal_month: Optional[int] = Field(None, ge=1, le=12)
    disposal_proceeds: Optional[float] = None
    replace_at_end: Optional[bool] = None
    per_unit_cost: Optional[float] = None
    quantity: Optional[int] = None
    contingency_pct: Optional[float] = None
    partial_month_policy: Optional[str] = None


class CapexOut(CapexIn):
    id: int
    scenario_id: int

    class Config:
        orm_mode = True


# ---------- Helpers ----------
def _to_bool(v: Any) -> Optional[bool]:
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    try:
        return bool(int(v))
    except Exception:
        return bool(v)


def _to_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None


def _row_to_dict(row: Dict[str, Any]) -> Dict[str, Any]:
    d = dict(row)

    # sayısal cast
    for k in (
        "amount",
        "salvage_value",
        "disposal_proceeds",
        "per_unit_cost",
        "contingency_pct",
    ):
        if k in d:
            d[k] = _to_float(d[k])

    # quantity int'e yakınsın
    if "quantity" in d and d["quantity"] is not None:
        try:
            d["quantity"] = int(d["quantity"])
        except Exception:
            pass

    # bool cast
    for k in ("is_active", "replace_at_end"):
        if k in d:
            d[k] = _to_bool(d[k])

    return d


def _select_cols() -> str:
    # tüm alanları seç
    return (
        "c.id, c.scenario_id, c.year, c.month, c.amount, c.notes, "
        "c.asset_name, c.category, c.service_start_year, c.service_start_month, "
        "c.useful_life_months, c.depr_method, c.salvage_value, c.is_active, "
        "c.disposal_year, c.disposal_month, c.disposal_proceeds, "
        "c.replace_at_end, c.per_unit_cost, c.quantity, c.contingency_pct, "
        "c.partial_month_policy"
    )


def _ensure_scenario_in_tenant(db: Session, tenant_id: int, scenario_id: int) -> None:
    r = db.execute(
        text(
            """
            SELECT s.id
            FROM scenarios s
            JOIN business_cases bc ON bc.id = s.business_case_id
            JOIN opportunities o ON o.id = bc.opportunity_id
            WHERE s.id = :sid AND o.tenant_id = :tid
            """
        ),
        {"sid": scenario_id, "tid": tenant_id},
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail="Scenario not found")


def _get_by_id_for_tenant(db: Session, tenant_id: int, capex_id: int) -> Dict[str, Any]:
    r = db.execute(
        text(
            f"""
            SELECT {_select_cols()}
            FROM scenario_capex c
            JOIN scenarios s ON s.id = c.scenario_id
            JOIN business_cases bc ON bc.id = s.business_case_id
            JOIN opportunities o ON o.id = bc.opportunity_id
            WHERE c.id = :id AND o.tenant_id = :tid
            """
        ),
        {"id": capex_id, "tid": tenant_id},
    ).mappings().first()
    if not r:
        raise HTTPException(status_code=404, detail="Capex not found")
    return _row_to_dict(r)


# ---------- Endpoints ----------
@router.get(
    "/{scenario_id}/capex",
    response_model=List[CapexOut],
    dependencies=[Depends(require_permissions(["cases:read"]))],
)
def list_capex(
    scenario_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    _ensure_scenario_in_tenant(db, current.tenant_id, scenario_id)
    rows = db.execute(
        text(
            f"""
            SELECT {_select_cols()}
            FROM scenario_capex c
            WHERE c.scenario_id = :sid
            ORDER BY c.year, c.month, c.id
            """
        ),
        {"sid": scenario_id},
    ).mappings().all()
    return [_row_to_dict(r) for r in rows]


@router.post(
    "/{scenario_id}/capex",
    response_model=CapexOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(["cases:write"]))],
)
def create_capex(
    scenario_id: int,
    body: CapexIn,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    _ensure_scenario_in_tenant(db, current.tenant_id, scenario_id)

    sql = text(
        """
        INSERT INTO scenario_capex (
          scenario_id, year, month, amount, notes,
          asset_name, category, service_start_year, service_start_month,
          useful_life_months, depr_method, salvage_value, is_active,
          disposal_year, disposal_month, disposal_proceeds,
          replace_at_end, per_unit_cost, quantity, contingency_pct,
          partial_month_policy
        ) VALUES (
          :sid, :y, :m, :a, :n,
          :asset_name, :category, :ssy, :ssm,
          :life, :method, :salvage, :active,
          :dpy, :dpm, :dpp,
          :rep, :puc, :qty, :cntg,
          :pmp
        )
        """
    )
    params = {
        "sid": scenario_id,
        "y": body.year,
        "m": body.month,
        "a": body.amount,
        "n": body.notes,
        "asset_name": body.asset_name,
        "category": body.category,
        "ssy": body.service_start_year,
        "ssm": body.service_start_month,
        "life": body.useful_life_months,
        "method": body.depr_method or "straight_line",
        "salvage": body.salvage_value if body.salvage_value is not None else 0,
        "active": 1 if (body.is_active is None or body.is_active) else 0,
        "dpy": body.disposal_year,
        "dpm": body.disposal_month,
        "dpp": body.disposal_proceeds if body.disposal_proceeds is not None else 0,
        "rep": 1 if body.replace_at_end else 0,
        "puc": body.per_unit_cost,
        "qty": body.quantity,
        "cntg": body.contingency_pct if body.contingency_pct is not None else 0,
        "pmp": body.partial_month_policy or "full_month",
    }
    db.execute(sql, params)
    new_id = db.execute(text("SELECT last_insert_rowid()")).scalar_one()
    db.commit()
    return _get_by_id_for_tenant(db, current.tenant_id, int(new_id))


@router.patch(
    "/capex/{capex_id}",
    response_model=CapexOut,
    dependencies=[Depends(require_permissions(["cases:write"]))],
)
def update_capex(
    capex_id: int,
    body: CapexPatch,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    # kiracı doğrulaması + mevcut satır
    _ = _get_by_id_for_tenant(db, current.tenant_id, capex_id)

    sets = []
    params: Dict[str, Any] = {"id": capex_id}

    if body.year is not None:
        sets.append("year = :y")
        params["y"] = body.year
    if body.month is not None:
        sets.append("month = :m")
        params["m"] = body.month
    if body.amount is not None:
        sets.append("amount = :a")
        params["a"] = body.amount
    if body.notes is not None:
        sets.append("notes = :n")
        params["n"] = body.notes

    if body.asset_name is not None:
        sets.append("asset_name = :asset_name")
        params["asset_name"] = body.asset_name
    if body.category is not None:
        sets.append("category = :category")
        params["category"] = body.category
    if body.service_start_year is not None:
        sets.append("service_start_year = :ssy")
        params["ssy"] = body.service_start_year
    if body.service_start_month is not None:
        sets.append("service_start_month = :ssm")
        params["ssm"] = body.service_start_month
    if body.useful_life_months is not None:
        sets.append("useful_life_months = :life")
        params["life"] = body.useful_life_months
    if body.depr_method is not None:
        sets.append("depr_method = :method")
        params["method"] = body.depr_method
    if body.salvage_value is not None:
        sets.append("salvage_value = :salvage")
        params["salvage"] = body.salvage_value
    if body.is_active is not None:
        sets.append("is_active = :active")
        params["active"] = 1 if body.is_active else 0

    # V3 patch'leri
    if body.disposal_year is not None:
        sets.append("disposal_year = :dpy")
        params["dpy"] = body.disposal_year
    if body.disposal_month is not None:
        sets.append("disposal_month = :dpm")
        params["dpm"] = body.disposal_month
    if body.disposal_proceeds is not None:
        sets.append("disposal_proceeds = :dpp")
        params["dpp"] = body.disposal_proceeds
    if body.replace_at_end is not None:
        sets.append("replace_at_end = :rep")
        params["rep"] = 1 if body.replace_at_end else 0
    if body.per_unit_cost is not None:
        sets.append("per_unit_cost = :puc")
        params["puc"] = body.per_unit_cost
    if body.quantity is not None:
        sets.append("quantity = :qty")
        params["qty"] = body.quantity
    if body.contingency_pct is not None:
        sets.append("contingency_pct = :cntg")
        params["cntg"] = body.contingency_pct
    if body.partial_month_policy is not None:
        sets.append("partial_month_policy = :pmp")
        params["pmp"] = body.partial_month_policy

    if sets:
        sql = "UPDATE scenario_capex SET " + ", ".join(sets) + " WHERE id = :id"
        db.execute(text(sql), params)
        db.commit()

    return _get_by_id_for_tenant(db, current.tenant_id, capex_id)


@router.delete(
    "/capex/{capex_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permissions(["cases:write"]))],
)
def delete_capex(
    capex_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    # kiracı doğrulaması
    _ = _get_by_id_for_tenant(db, current.tenant_id, capex_id)

    res = db.execute(text("DELETE FROM scenario_capex WHERE id = :id"), {"id": capex_id})
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Capex not found")
    db.commit()
    return None
