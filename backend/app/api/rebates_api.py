from __future__ import annotations

from typing import List, Optional, Any, Dict
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from .deps import get_db, get_current_user

# Tüm path'ler bu prefix altına indirildi
router = APIRouter(prefix="/api/scenarios", tags=["rebates"])


# =========================
# Schemas & Validators
# =========================
class RebateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    scope: str = Field("all")                   # all|boq|services|product
    kind: str = Field("percent")                # percent|tier_percent|lump_sum
    basis: str = Field("revenue")               # revenue|volume
    product_id: Optional[int] = None

    valid_from_year: Optional[int] = None
    valid_from_month: Optional[int] = Field(None, ge=1, le=12)
    valid_to_year: Optional[int] = None
    valid_to_month: Optional[int] = Field(None, ge=1, le=12)

    accrual_method: str = Field("monthly")      # monthly|quarterly|annual|on_invoice
    pay_month_lag: Optional[int] = 0

    is_active: bool = True
    notes: Optional[str] = None

    # kind='percent' için tek değer
    percent_value: Optional[Decimal] = Field(None, description="Only for kind='percent'")

    # toplu gönderim kolaylığı
    tiers: Optional[List[Dict[str, Any]]] = None
    lumps: Optional[List[Dict[str, Any]]] = None

    @validator("scope")
    def _scope_ok(cls, v: str) -> str:
        allow = {"all", "boq", "services", "product"}
        if v not in allow:
            raise ValueError(f"scope must be one of {sorted(allow)}")
        return v

    @validator("kind")
    def _kind_ok(cls, v: str) -> str:
        allow = {"percent", "tier_percent", "lump_sum"}
        if v not in allow:
            raise ValueError(f"kind must be one of {sorted(allow)}")
        return v

    @validator("basis")
    def _basis_ok(cls, v: str) -> str:
        allow = {"revenue", "volume"}
        if v not in allow:
            raise ValueError(f"basis must be one of {sorted(allow)}")
        return v

    @validator("accrual_method")
    def _accrual_ok(cls, v: str) -> str:
        allow = {"monthly", "quarterly", "annual", "on_invoice"}
        if v not in allow:
            raise ValueError(f"accrual_method must be one of {sorted(allow)}")
        return v


class RebateOut(BaseModel):
    id: int
    scenario_id: int
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
        orm_mode = True


class TierIn(BaseModel):
    min_value: Decimal = 0
    max_value: Optional[Decimal] = None
    percent: Optional[Decimal] = None
    amount: Optional[Decimal] = None
    description: Optional[str] = None
    sort_order: int = 0

    @validator("percent", "amount", pre=True, always=True)
    def _one_of_percent_amount(cls, v, values, **kwargs):
        other = values.get("amount") if kwargs["field"].name == "percent" else values.get("percent")
        if (v is None) and (other is None):
            raise ValueError("Either percent or amount must be provided")
        return v


class TierOut(BaseModel):
    id: int
    rebate_id: int
    min_value: Decimal
    max_value: Optional[Decimal]
    percent: Optional[Decimal]
    amount: Optional[Decimal]
    description: Optional[str]
    sort_order: int

    class Config:
        orm_mode = True


class LumpIn(BaseModel):
    year: int
    month: int = Field(..., ge=1, le=12)
    amount: Decimal
    currency: str = Field("USD", min_length=3, max_length=3)
    note: Optional[str] = None


class LumpOut(BaseModel):
    id: int
    rebate_id: int
    year: int
    month: int
    amount: Decimal
    currency: str
    note: Optional[str]

    class Config:
        orm_mode = True


# Detaylı liste dönüşü
class RebateOutFull(RebateOut):
    tiers: Optional[List[TierOut]] = None
    lumps: Optional[List[LumpOut]] = None


# =========================
# Helpers
# =========================
def _ensure_scenario(db: Session, scenario_id: int) -> None:
    r = db.execute(text("SELECT 1 FROM scenarios WHERE id = :sid"), {"sid": scenario_id}).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Scenario not found")


def _ensure_rebate(db: Session, scenario_id: int, rebate_id: int) -> Dict[str, Any]:
    r = db.execute(
        text("SELECT * FROM scenario_rebates WHERE id = :rid AND scenario_id = :sid"),
        {"rid": rebate_id, "sid": scenario_id},
    ).mappings().fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Rebate not found")
    return dict(r)


def _fetch_tiers(db: Session, rebate_id: int) -> List[Dict[str, Any]]:
    rows = db.execute(
        text(
            "SELECT id, rebate_id, min_value, max_value, percent, amount, description, sort_order "
            "FROM scenario_rebate_tiers WHERE rebate_id = :rid ORDER BY sort_order, id"
        ),
        {"rid": rebate_id},
    ).mappings().all()
    return [dict(r) for r in rows]


def _fetch_lumps(db: Session, rebate_id: int) -> List[Dict[str, Any]]:
    rows = db.execute(
        text(
            "SELECT id, rebate_id, year, month, amount, currency, note "
            "FROM scenario_rebate_lumps WHERE rebate_id = :rid ORDER BY year, month, id"
        ),
        {"rid": rebate_id},
    ).mappings().all()
    return [dict(r) for r in rows]


def _insert_rebate(db: Session, scenario_id: int, payload: RebateIn) -> int:
    params = {
        "sid": scenario_id,
        "name": payload.name,
        "scope": payload.scope,
        "kind": payload.kind,
        "basis": payload.basis,
        "pid": payload.product_id,
        "vfy": payload.valid_from_year,
        "vfm": payload.valid_from_month,
        "vty": payload.valid_to_year,
        "vtm": payload.valid_to_month,
        "accr": payload.accrual_method,
        "lag": payload.pay_month_lag or 0,
        "active": 1 if payload.is_active else 0,
        "notes": payload.notes,
    }
    db.execute(
        text(
            "INSERT INTO scenario_rebates (scenario_id, name, scope, kind, basis, product_id, "
            "valid_from_year, valid_from_month, valid_to_year, valid_to_month, "
            "accrual_method, pay_month_lag, is_active, notes) "
            "VALUES (:sid, :name, :scope, :kind, :basis, :pid, :vfy, :vfm, :vty, :vtm, :accr, :lag, :active, :notes)"
        ),
        params,
    )
    rid = db.execute(text("SELECT last_insert_rowid() AS id")).scalar_one()
    return int(rid)


def _update_rebate(db: Session, scenario_id: int, rebate_id: int, payload: RebateIn) -> None:
    params = {
        "rid": rebate_id,
        "sid": scenario_id,
        "name": payload.name,
        "scope": payload.scope,
        "kind": payload.kind,
        "basis": payload.basis,
        "pid": payload.product_id,
        "vfy": payload.valid_from_year,
        "vfm": payload.valid_from_month,
        "vty": payload.valid_to_year,
        "vtm": payload.valid_to_month,
        "accr": payload.accrual_method,
        "lag": payload.pay_month_lag or 0,
        "active": 1 if payload.is_active else 0,
        "notes": payload.notes,
    }
    res = db.execute(
        text(
            "UPDATE scenario_rebates SET "
            "name=:name, scope=:scope, kind=:kind, basis=:basis, product_id=:pid, "
            "valid_from_year=:vfy, valid_from_month=:vfm, valid_to_year=:vty, valid_to_month=:vtm, "
            "accrual_method=:accr, pay_month_lag=:lag, is_active=:active, notes=:notes "
            "WHERE id=:rid AND scenario_id=:sid"
        ),
        params,
    )
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Rebate not found")


def _insert_tier(db: Session, rebate_id: int, t: TierIn) -> int:
    params = {
        "rid": rebate_id,
        "minv": t.min_value,
        "maxv": t.max_value,
        "pct": t.percent,
        "amt": t.amount,
        "desc": t.description,
        "ord": t.sort_order,
    }
    db.execute(
        text(
            "INSERT INTO scenario_rebate_tiers (rebate_id, min_value, max_value, percent, amount, description, sort_order) "
            "VALUES (:rid, :minv, :maxv, :pct, :amt, :desc, :ord)"
        ),
        params,
    )
    tid = db.execute(text("SELECT last_insert_rowid() AS id")).scalar_one()
    return int(tid)


def _insert_lump(db: Session, rebate_id: int, l: LumpIn) -> int:
    params = {
        "rid": rebate_id,
        "y": l.year,
        "m": l.month,
        "amt": l.amount,
        "cur": l.currency,
        "note": l.note,
    }
    db.execute(
        text(
            "INSERT INTO scenario_rebate_lumps (rebate_id, year, month, amount, currency, note) "
            "VALUES (:rid, :y, :m, :amt, :cur, :note)"
        ),
        params,
    )
    lid = db.execute(text("SELECT last_insert_rowid() AS id")).scalar_one()
    return int(lid)


# =========================
# Endpoints
# =========================
@router.get("/{scenario_id}/rebates", response_model=List[RebateOutFull])
def list_rebates(
    scenario_id: int,
    include_details: bool = Query(False, description="If true, child 'tiers' and 'lumps' are embedded"),
    active: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ensure_scenario(db, scenario_id)

    sql = (
        "SELECT id, scenario_id, name, scope, kind, basis, product_id, "
        "valid_from_year, valid_from_month, valid_to_year, valid_to_month, "
        "accrual_method, pay_month_lag, is_active, notes "
        "FROM scenario_rebates WHERE scenario_id = :sid"
    )
    params: Dict[str, Any] = {"sid": scenario_id}
    if active is not None:
        sql += " AND is_active = :act"
        params["act"] = 1 if active else 0
    sql += " ORDER BY id DESC"

    rows = db.execute(text(sql), params).mappings().all()
    items = [dict(r) for r in rows]

    if include_details and items:
        ids = [r["id"] for r in items]
        # named bind placeholders
        ph = ", ".join(f":id{i}" for i in range(len(ids)))
        idmap = {f"id{i}": v for i, v in enumerate(ids)}

        # tiers
        trows = db.execute(
            text(
                "SELECT id, rebate_id, min_value, max_value, percent, amount, description, sort_order "
                f"FROM scenario_rebate_tiers WHERE rebate_id IN ({ph}) "
                "ORDER BY sort_order, id"
            ),
            idmap,
        ).mappings().all()
        tiers_by: Dict[int, List[Dict[str, Any]]] = {}
        for tr in trows:
            tiers_by.setdefault(tr["rebate_id"], []).append(dict(tr))

        # lumps
        lrows = db.execute(
            text(
                "SELECT id, rebate_id, year, month, amount, currency, note "
                f"FROM scenario_rebate_lumps WHERE rebate_id IN ({ph}) "
                "ORDER BY year, month, id"
            ),
            idmap,
        ).mappings().all()
        lumps_by: Dict[int, List[Dict[str, Any]]] = {}
        for lr in lrows:
            lumps_by.setdefault(lr["rebate_id"], []).append(dict(lr))

        for r in items:
            r["tiers"] = tiers_by.get(r["id"], [])
            r["lumps"] = lumps_by.get(r["id"], [])

    return items


@router.post("/{scenario_id}/rebates", status_code=status.HTTP_201_CREATED)
def create_rebate(
    scenario_id: int,
    payload: RebateIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ensure_scenario(db, scenario_id)
    if payload.scope == "product" and not payload.product_id:
        raise HTTPException(422, detail="product_id is required when scope='product'")

    rid = _insert_rebate(db, scenario_id, payload)

    # flat percent -> tek tier
    if payload.kind == "percent":
        pct = payload.percent_value
        if pct is None:
            raise HTTPException(422, detail="percent_value is required when kind='percent'")
        _insert_tier(
            db,
            rid,
            TierIn(min_value=Decimal(0), max_value=None, percent=pct, amount=None, description="flat %", sort_order=0),
        )

    # tiered
    if payload.tiers and payload.kind == "tier_percent":
        for t in payload.tiers:
            _insert_tier(db, rid, TierIn(**t))

    # lump sum
    if payload.lumps and payload.kind == "lump_sum":
        for l in payload.lumps:
            _insert_lump(db, rid, LumpIn(**l))

    db.commit()
    return {"id": rid}


@router.put("/{scenario_id}/rebates/{rebate_id}")
def update_rebate(
    scenario_id: int,
    rebate_id: int,
    payload: RebateIn,
    replace_tiers: bool = Query(False, description="If true and kind in ('percent','tier_percent'), replace tiers"),
    replace_lumps: bool = Query(False, description="If true and kind='lump_sum', replace lumps"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ensure_rebate(db, scenario_id, rebate_id)
    if payload.scope == "product" and not payload.product_id:
        raise HTTPException(422, detail="product_id is required when scope='product'")

    _update_rebate(db, scenario_id, rebate_id, payload)

    if payload.kind == "percent":
        if replace_tiers or payload.percent_value is not None:
            db.execute(text("DELETE FROM scenario_rebate_tiers WHERE rebate_id = :rid"), {"rid": rebate_id})
            pct = payload.percent_value
            if pct is None:
                raise HTTPException(422, detail="percent_value is required when replacing kind='percent'")
            _insert_tier(
                db,
                rebate_id,
                TierIn(min_value=Decimal(0), max_value=None, percent=pct, amount=None, description="flat %", sort_order=0),
            )

    if replace_tiers and payload.kind == "tier_percent":
        db.execute(text("DELETE FROM scenario_rebate_tiers WHERE rebate_id = :rid"), {"rid": rebate_id})
        if payload.tiers:
            for t in payload.tiers:
                _insert_tier(db, rebate_id, TierIn(**t))

    if replace_lumps and payload.kind == "lump_sum":
        db.execute(text("DELETE FROM scenario_rebate_lumps WHERE rebate_id = :rid"), {"rid": rebate_id})
        if payload.lumps:
            for l in payload.lumps:
                _insert_lump(db, rebate_id, LumpIn(**l))

    db.commit()
    return {"updated": 1}


@router.delete("/{scenario_id}/rebates/{rebate_id}")
def delete_rebate(
    scenario_id: int,
    rebate_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ensure_rebate(db, scenario_id, rebate_id)
    db.execute(text("DELETE FROM scenario_rebates WHERE id = :rid AND scenario_id = :sid"),
               {"rid": rebate_id, "sid": scenario_id})
    db.commit()
    return {"deleted": True}


# ----- TIERS -----
@router.get("/{scenario_id}/rebates/{rebate_id}/tiers", response_model=List[TierOut])
def list_tiers(
    scenario_id: int,
    rebate_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ensure_rebate(db, scenario_id, rebate_id)
    return _fetch_tiers(db, rebate_id)


@router.post("/{scenario_id}/rebates/{rebate_id}/tiers", status_code=status.HTTP_201_CREATED)
def create_tier(
    scenario_id: int,
    rebate_id: int,
    payload: TierIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ensure_rebate(db, scenario_id, rebate_id)
    tid = _insert_tier(db, rebate_id, payload)
    db.commit()
    return {"id": tid}


@router.put("/{scenario_id}/rebates/{rebate_id}/tiers/{tier_id}")
def update_tier(
    scenario_id: int,
    rebate_id: int,
    tier_id: int,
    payload: TierIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ensure_rebate(db, scenario_id, rebate_id)
    params = {
        "tid": tier_id, "rid": rebate_id,
        "minv": payload.min_value, "maxv": payload.max_value,
        "pct": payload.percent, "amt": payload.amount,
        "desc": payload.description, "ord": payload.sort_order,
    }
    res = db.execute(
        text(
            "UPDATE scenario_rebate_tiers SET "
            "min_value=:minv, max_value=:maxv, percent=:pct, amount=:amt, "
            "description=:desc, sort_order=:ord "
            "WHERE id=:tid AND rebate_id=:rid"
        ),
        params,
    )
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Tier not found")
    db.commit()
    return {"updated": 1}


@router.delete("/{scenario_id}/rebates/{rebate_id}/tiers/{tier_id}")
def delete_tier(
    scenario_id: int,
    rebate_id: int,
    tier_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ensure_rebate(db, scenario_id, rebate_id)
    res = db.execute(
        text("DELETE FROM scenario_rebate_tiers WHERE id=:tid AND rebate_id=:rid"),
        {"tid": tier_id, "rid": rebate_id},
    )
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Tier not found")
    db.commit()
    return {"deleted": True}


# ----- LUMPS -----
@router.get("/{scenario_id}/rebates/{rebate_id}/lumps", response_model=List[LumpOut])
def list_lumps(
    scenario_id: int,
    rebate_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ensure_rebate(db, scenario_id, rebate_id)
    return _fetch_lumps(db, rebate_id)


@router.post("/{scenario_id}/rebates/{rebate_id}/lumps", status_code=status.HTTP_201_CREATED)
def create_lump(
    scenario_id: int,
    rebate_id: int,
    payload: LumpIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ensure_rebate(db, scenario_id, rebate_id)
    lid = _insert_lump(db, rebate_id, payload)
    db.commit()
    return {"id": lid}


@router.put("/{scenario_id}/rebates/{rebate_id}/lumps/{lump_id}")
def update_lump(
    scenario_id: int,
    rebate_id: int,
    lump_id: int,
    payload: LumpIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ensure_rebate(db, scenario_id, rebate_id)
    params = {
        "lid": lump_id, "rid": rebate_id,
        "y": payload.year, "m": payload.month,
        "amt": payload.amount, "cur": payload.currency, "note": payload.note,
    }
    res = db.execute(
        text(
            "UPDATE scenario_rebate_lumps SET "
            "year=:y, month=:m, amount=:amt, currency=:cur, note=:note "
            "WHERE id=:lid AND rebate_id=:rid"
        ),
        params,
    )
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Lump entry not found")
    db.commit()
    return {"updated": 1}


@router.delete("/{scenario_id}/rebates/{rebate_id}/lumps/{lump_id}")
def delete_lump(
    scenario_id: int,
    rebate_id: int,
    lump_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ensure_rebate(db, scenario_id, rebate_id)
    res = db.execute(
        text("DELETE FROM scenario_rebate_lumps WHERE id=:lid AND rebate_id=:rid"),
        {"lid": lump_id, "rid": rebate_id},
    )
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Lump entry not found")
    db.commit()
    return {"deleted": True}
