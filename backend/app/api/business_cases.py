from datetime import date
from typing import List, Optional, Dict, Any, Tuple, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, conint, confloat
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from ..models import (
    BusinessCase,
    Scenario,
    ScenarioProduct,
    ScenarioProductMonth,
    ScenarioOverhead,
    Opportunity,
)
from .deps import get_db, get_current_user, CurrentUser, require_permissions

router = APIRouter(prefix="/business-cases", tags=["business-cases"])

# ---------------------------
# Pydantic Schemas
# ---------------------------

class BusinessCaseCreate(BaseModel):
    opportunity_id: int = Field(..., description="Opportunity ID (1:1 relationship)")
    name: str = Field(..., min_length=1, max_length=255)


class ScenarioCreate(BaseModel):
    business_case_id: int
    name: str = Field(..., min_length=1, max_length=255)
    months: conint(gt=0, le=120) = 36
    start_date: date


class ProductCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    price: confloat(ge=0) = 0.0
    unit_cogs: confloat(ge=0) = 0.0


class ProductUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    price: Optional[confloat(ge=0)] = None
    unit_cogs: Optional[confloat(ge=0)] = None
    is_active: Optional[bool] = None


class MonthQty(BaseModel):
    year: conint(ge=1900, le=2200)
    month: conint(ge=1, le=12)
    quantity: confloat(ge=0) = 0.0


class PLParams(BaseModel):
    # MVP için boş – gelecekte: WACC, discount toggle vs.
    pass


class ScenarioOut(BaseModel):
    id: int
    name: str
    months: int
    start_date: date

    class Config:
        from_attributes = True


class BusinessCaseOut(BaseModel):
    id: int
    opportunity_id: int
    name: str
    scenarios: List[ScenarioOut]

    class Config:
        from_attributes = True


# ---- Scenario Detail Schemas ----
class ProductMonthOut(BaseModel):
    year: int
    month: int
    quantity: float


class ProductWithMonthsOut(BaseModel):
    id: int
    name: str
    price: float
    unit_cogs: float
    is_active: bool
    months: List[ProductMonthOut]


class OverheadOut(BaseModel):
    id: int
    name: str
    type: str
    amount: float


class ScenarioDetailOut(BaseModel):
    id: int
    business_case_id: int
    name: str
    months: int
    start_date: date
    products: List[ProductWithMonthsOut]
    overheads: List[OverheadOut]


# ---- Overhead Create/Update Schemas ----
class OverheadCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    type: Literal["fixed", "%_revenue"]
    amount: confloat(ge=0) = 0.0


class OverheadUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    type: Optional[Literal["fixed", "%_revenue"]] = None
    amount: Optional[confloat(ge=0)] = None


# ---------------------------
# Helpers
# ---------------------------

def _ensure_opportunity_in_tenant(db: Session, tenant_id: int, opportunity_id: int) -> Opportunity:
    opp = (
        db.query(Opportunity)
        .filter(Opportunity.id == opportunity_id, Opportunity.tenant_id == tenant_id)
        .first()
    )
    if not opp:
        raise HTTPException(status_code=404, detail="Opportunity not found for this tenant")
    return opp


def _ensure_business_case_in_tenant(db: Session, tenant_id: int, bc_id: int) -> BusinessCase:
    bc = (
        db.query(BusinessCase)
        .join(Opportunity, BusinessCase.opportunity_id == Opportunity.id)
        .filter(BusinessCase.id == bc_id, Opportunity.tenant_id == tenant_id)
        .first()
    )
    if not bc:
        raise HTTPException(status_code=404, detail="Business case not found")
    return bc


def _ensure_scenario_in_tenant(db: Session, tenant_id: int, scenario_id: int) -> Scenario:
    sc = (
        db.query(Scenario)
        .join(BusinessCase, Scenario.business_case_id == BusinessCase.id)
        .join(Opportunity, BusinessCase.opportunity_id == Opportunity.id)
        .filter(Scenario.id == scenario_id, Opportunity.tenant_id == tenant_id)
        .first()
    )
    if not sc:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return sc


def _ensure_product_in_tenant(db: Session, tenant_id: int, product_id: int) -> ScenarioProduct:
    prod = (
        db.query(ScenarioProduct)
        .join(Scenario, ScenarioProduct.scenario_id == Scenario.id)
        .join(BusinessCase, Scenario.business_case_id == BusinessCase.id)
        .join(Opportunity, BusinessCase.opportunity_id == Opportunity.id)
        .filter(ScenarioProduct.id == product_id, Opportunity.tenant_id == tenant_id)
        .first()
    )
    if not prod:
        raise HTTPException(status_code=404, detail="Scenario product not found")
    return prod


def _ensure_overhead_in_tenant(db: Session, tenant_id: int, overhead_id: int) -> ScenarioOverhead:
    ovh = (
        db.query(ScenarioOverhead)
        .join(Scenario, ScenarioOverhead.scenario_id == Scenario.id)
        .join(BusinessCase, Scenario.business_case_id == BusinessCase.id)
        .join(Opportunity, BusinessCase.opportunity_id == Opportunity.id)
        .filter(ScenarioOverhead.id == overhead_id, Opportunity.tenant_id == tenant_id)
        .first()
    )
    if not ovh:
        raise HTTPException(status_code=404, detail="Scenario overhead not found")
    return ovh


# ---------------------------
# Endpoints
# ---------------------------

@router.post(
    "/",
    response_model=BusinessCaseOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create Business Case (1:1 with Opportunity)",
    dependencies=[Depends(require_permissions(["cases:write"]))],
)
def create_business_case(
    body: BusinessCaseCreate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    _ensure_opportunity_in_tenant(db, current.tenant_id, body.opportunity_id)

    # Enforce 1:1 – aynı opportunity için mevcut BC var mı?
    exists = (
        db.query(BusinessCase.id)
        .filter(BusinessCase.opportunity_id == body.opportunity_id)
        .first()
    )
    if exists:
        raise HTTPException(status_code=409, detail="This opportunity already has a business case")

    bc = BusinessCase(opportunity_id=body.opportunity_id, name=body.name)
    db.add(bc)
    db.commit()
    db.refresh(bc)

    return BusinessCaseOut.model_validate(
        {"id": bc.id, "opportunity_id": bc.opportunity_id, "name": bc.name, "scenarios": []}
    )


@router.get(
    "/{business_case_id}",
    response_model=BusinessCaseOut,
    summary="Get Business Case (includes scenarios)",
    dependencies=[Depends(require_permissions(["cases:read"]))],
)
def get_business_case(
    business_case_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    bc = _ensure_business_case_in_tenant(db, current.tenant_id, business_case_id)

    scenarios = (
        db.query(Scenario)
        .filter(Scenario.business_case_id == bc.id)
        .order_by(Scenario.id.asc())
        .all()
    )
    return BusinessCaseOut.model_validate(
        {
            "id": bc.id,
            "opportunity_id": bc.opportunity_id,
            "name": bc.name,
            "scenarios": scenarios,
        }
    )


# ---------- NEW: Get Business Case by Opportunity (includes scenarios) ----------
@router.get(
    "/by-opportunity/{opportunity_id}",
    response_model=BusinessCaseOut,
    summary="Get Business Case by Opportunity (includes scenarios)",
    dependencies=[Depends(require_permissions(["cases:read"]))],
)
def get_business_case_by_opportunity(
    opportunity_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    # Önce tenant doğrulaması
    _ensure_opportunity_in_tenant(db, current.tenant_id, opportunity_id)

    bc = (
        db.query(BusinessCase)
        .filter(BusinessCase.opportunity_id == opportunity_id)
        .first()
    )
    if not bc:
        raise HTTPException(status_code=404, detail="Business case not found for this opportunity")

    scenarios = (
        db.query(Scenario)
        .filter(Scenario.business_case_id == bc.id)
        .order_by(Scenario.id.asc())
        .all()
    )
    return BusinessCaseOut.model_validate(
        {
            "id": bc.id,
            "opportunity_id": bc.opportunity_id,
            "name": bc.name,
            "scenarios": scenarios,
        }
    )


# -------- Scenarios --------

scenarios_router = APIRouter(prefix="/scenarios", tags=["scenarios"])


@scenarios_router.post(
    "",
    response_model=ScenarioOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create Scenario under Business Case",
    dependencies=[Depends(require_permissions(["cases:write"]))],
)
def create_scenario(
    body: ScenarioCreate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    _ = _ensure_business_case_in_tenant(db, current.tenant_id, body.business_case_id)

    sc = Scenario(
        business_case_id=body.business_case_id,
        name=body.name,
        months=body.months,
        start_date=body.start_date,
    )
    db.add(sc)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=409, detail="Scenario name must be unique per business case")
    db.refresh(sc)
    return sc


@scenarios_router.get(
    "/{scenario_id}",
    response_model=ScenarioDetailOut,
    summary="Get Scenario detail with products, monthly quantities and overheads",
    dependencies=[Depends(require_permissions(["cases:read"]))],
)
def get_scenario_detail(
    scenario_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    sc = _ensure_scenario_in_tenant(db, current.tenant_id, scenario_id)

    # Products
    products: List[ScenarioProduct] = (
        db.query(ScenarioProduct)
        .filter(ScenarioProduct.scenario_id == sc.id)
        .order_by(ScenarioProduct.id.asc())
        .all()
    )
    product_ids = [p.id for p in products]

    # Months for products
    months_rows: List[ScenarioProductMonth] = []
    if product_ids:
        months_rows = (
            db.query(ScenarioProductMonth)
            .filter(ScenarioProductMonth.scenario_product_id.in_(product_ids))
            .order_by(
                ScenarioProductMonth.scenario_product_id.asc(),
                ScenarioProductMonth.year.asc(),
                ScenarioProductMonth.month.asc(),
            )
            .all()
        )

    months_by_prod: Dict[int, List[ProductMonthOut]] = {}
    for r in months_rows:
        months_by_prod.setdefault(r.scenario_product_id, []).append(
            ProductMonthOut(year=int(r.year), month=int(r.month), quantity=float(r.quantity or 0.0))
        )

    products_out: List[ProductWithMonthsOut] = []
    for p in products:
        products_out.append(
            ProductWithMonthsOut(
                id=p.id,
                name=p.name,
                price=float(p.price or 0.0),
                unit_cogs=float(p.unit_cogs or 0.0),
                is_active=bool(p.is_active),
                months=months_by_prod.get(p.id, []),
            )
        )

    # Overheads
    overheads = (
        db.query(ScenarioOverhead)
        .filter(ScenarioOverhead.scenario_id == sc.id)
        .order_by(ScenarioOverhead.id.asc())
        .all()
    )
    overheads_out = [
        OverheadOut(id=h.id, name=h.name, type=h.type, amount=float(h.amount or 0.0)) for h in overheads
    ]

    return ScenarioDetailOut(
        id=sc.id,
        business_case_id=sc.business_case_id,
        name=sc.name,
        months=sc.months,
        start_date=sc.start_date,
        products=products_out,
        overheads=overheads_out,
    )


@scenarios_router.post(
    "/{scenario_id}/products",
    response_model=Dict[str, Any],
    status_code=status.HTTP_201_CREATED,
    summary="Create Product under Scenario",
    dependencies=[Depends(require_permissions(["cases:write"]))],
)
def add_product_to_scenario(
    scenario_id: int,
    body: ProductCreate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    sc = _ensure_scenario_in_tenant(db, current.tenant_id, scenario_id)

    prod = ScenarioProduct(
        scenario_id=sc.id,
        name=body.name,
        price=body.price,
        unit_cogs=body.unit_cogs,
        is_active=True,
    )
    db.add(prod)
    db.commit()
    db.refresh(prod)

    return {
        "id": prod.id,
        "scenario_id": prod.scenario_id,
        "name": prod.name,
        "price": float(prod.price or 0),
        "unit_cogs": float(prod.unit_cogs or 0),
        "is_active": prod.is_active,
    }


@scenarios_router.patch(
    "/products/{product_id}",
    response_model=Dict[str, Any],
    summary="Update Scenario Product (partial)",
    dependencies=[Depends(require_permissions(["cases:write"]))],
)
def update_product(
    product_id: int,
    body: ProductUpdate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    prod = _ensure_product_in_tenant(db, current.tenant_id, product_id)
    data = body.model_dump(exclude_unset=True)

    for k, v in data.items():
        setattr(prod, k, v)

    db.commit()
    db.refresh(prod)

    return {
        "id": prod.id,
        "scenario_id": prod.scenario_id,
        "name": prod.name,
        "price": float(prod.price or 0),
        "unit_cogs": float(prod.unit_cogs or 0),
        "is_active": prod.is_active,
    }


@scenarios_router.delete(
    "/products/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Scenario Product",
    dependencies=[Depends(require_permissions(["cases:write"]))],
)
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    prod = _ensure_product_in_tenant(db, current.tenant_id, product_id)
    db.delete(prod)
    db.commit()
    return None


@scenarios_router.put(
    "/products/{product_id}/months",
    response_model=Dict[str, Any],
    summary="Bulk upsert monthly quantities for a product",
    dependencies=[Depends(require_permissions(["cases:write"]))],
)
def upsert_product_months(
    product_id: int,
    items: List[MonthQty],
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    prod = _ensure_product_in_tenant(db, current.tenant_id, product_id)

    stmt = text(
        """
        INSERT INTO scenario_product_months (scenario_product_id, year, month, quantity)
        VALUES (:pid, :year, :month, :quantity)
        ON CONFLICT(scenario_product_id, year, month)
        DO UPDATE SET quantity = excluded.quantity
        """
    )

    payload = [{"pid": prod.id, "year": it.year, "month": it.month, "quantity": it.quantity} for it in items]
    if payload:
        db.execute(stmt, payload)
    db.commit()

    return {"updated": len(payload), "product_id": prod.id}


# ---- Overheads CRUD ----

@scenarios_router.post(
    "/{scenario_id}/overheads",
    response_model=OverheadOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create Overhead under Scenario",
    dependencies=[Depends(require_permissions(["cases:write"]))],
)
def create_overhead(
    scenario_id: int,
    body: OverheadCreate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    sc = _ensure_scenario_in_tenant(db, current.tenant_id, scenario_id)

    ovh = ScenarioOverhead(
        scenario_id=sc.id,
        name=body.name,
        type=body.type,
        amount=body.amount,
    )
    db.add(ovh)
    db.commit()
    db.refresh(ovh)

    return OverheadOut(id=ovh.id, name=ovh.name, type=ovh.type, amount=float(ovh.amount or 0))


@scenarios_router.patch(
    "/overheads/{overhead_id}",
    response_model=OverheadOut,
    summary="Update Overhead (partial)",
    dependencies=[Depends(require_permissions(["cases:write"]))],
)
def update_overhead(
    overhead_id: int,
    body: OverheadUpdate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    ovh = _ensure_overhead_in_tenant(db, current.tenant_id, overhead_id)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(ovh, k, v)

    db.commit()
    db.refresh(ovh)
    return OverheadOut(id=ovh.id, name=ovh.name, type=ovh.type, amount=float(ovh.amount or 0))


@scenarios_router.delete(
    "/overheads/{overhead_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Overhead",
    dependencies=[Depends(require_permissions(["cases:write"]))],
)
def delete_overhead(
    overhead_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    ovh = _ensure_overhead_in_tenant(db, current.tenant_id, overhead_id)
    db.delete(ovh)
    db.commit()
    return None


# ---- Compute ----

@scenarios_router.post(
    "/{scenario_id}/compute",
    response_model=Dict[str, Any],
    summary="Compute monthly P&L for a scenario (MVP)",
    dependencies=[Depends(require_permissions(["cases:read"]))],
)
def compute_scenario_pl(
    scenario_id: int,
    _: PLParams = None,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    sc = _ensure_scenario_in_tenant(db, current.tenant_id, scenario_id)

    overheads = (
        db.query(ScenarioOverhead)
        .filter(ScenarioOverhead.scenario_id == sc.id)
        .all()
    )
    fixed_sum = sum(float(h.amount or 0) for h in overheads if h.type == "fixed")
    pct_sum = sum(float(h.amount or 0) for h in overheads if h.type == "%_revenue")

    rows = (
        db.query(
            ScenarioProductMonth.year.label("y"),
            ScenarioProductMonth.month.label("m"),
            func.sum(ScenarioProduct.price * ScenarioProductMonth.quantity).label("revenue"),
            func.sum(ScenarioProduct.unit_cogs * ScenarioProductMonth.quantity).label("cogs"),
        )
        .join(ScenarioProduct, ScenarioProduct.id == ScenarioProductMonth.scenario_product_id)
        .join(Scenario, Scenario.id == ScenarioProduct.scenario_id)
        .filter(Scenario.id == sc.id)
        .group_by(ScenarioProductMonth.year, ScenarioProductMonth.month)
        .all()
    )

    rev_cogs: Dict[Tuple[int, int], Tuple[float, float]] = {}
    for r in rows:
        rev_cogs[(int(r.y), int(r.m))] = (float(r.revenue or 0), float(r.cogs or 0))

    months_out: List[Dict[str, Any]] = []
    y = sc.start_date.year
    m = sc.start_date.month
    for _i in range(sc.months):
        key = (y, m)
        revenue, cogs = rev_cogs.get(key, (0.0, 0.0))
        gross_margin = revenue - cogs
        overhead_var = revenue * (pct_sum / 100.0)
        overhead_total = fixed_sum + overhead_var
        ebit = gross_margin - overhead_total

        months_out.append(
            {
                "year": y,
                "month": m,
                "revenue": round(revenue, 4),
                "cogs": round(cogs, 4),
                "gross_margin": round(gross_margin, 4),
                "overhead_fixed": round(fixed_sum, 4),
                "overhead_var_pct": pct_sum,
                "overhead_var_amount": round(overhead_var, 4),
                "overhead_total": round(overhead_total, 4),
                "ebit": round(ebit, 4),
                "net_income": round(ebit, 4),
            }
        )

        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1

    totals = {
        "revenue": round(sum(x["revenue"] for x in months_out), 4),
        "cogs": round(sum(x["cogs"] for x in months_out), 4),
        "gross_margin": round(sum(x["gross_margin"] for x in months_out), 4),
        "overhead_fixed_total": round(fixed_sum * len(months_out), 4),
        "overhead_var_total": round(sum(x["overhead_var_amount"] for x in months_out), 4),
        "overhead_total": round(sum(x["overhead_total"] for x in months_out), 4),
        "ebit": round(sum(x["ebit"] for x in months_out), 4),
        "net_income": round(sum(x["net_income"] for x in months_out), 4),
    }

    return {
        "scenario": {
            "id": sc.id,
            "business_case_id": sc.business_case_id,
            "name": sc.name,
            "months": sc.months,
            "start_date": sc.start_date,
            "overheads": {
                "fixed_sum": round(fixed_sum, 4),
                "pct_sum": pct_sum,
            },
        },
        "months": months_out,
        "totals": totals,
    }


# Register scenarios sub-router under main
router.include_router(scenarios_router)
