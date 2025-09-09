# backend/app/api/deals.py

from typing import Optional, List
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, asc

from .deps import get_db, get_current_user, CurrentUser, require_permissions
from app.models import Account, Pipeline, Stage, Opportunity

router = APIRouter(prefix="/deals", tags=["deals"])


# ---------------------------
# Pydantic Şemalar
# ---------------------------

class DealCreate(BaseModel):
    account_id: int
    name: str
    amount: Optional[int] = None
    currency: Optional[str] = None
    expected_close_date: Optional[date] = None
    source: Optional[str] = None
    stage_id: Optional[int] = None  # verilmezse default pipeline'ın ilk stage'i atanır


class DealUpdate(BaseModel):
    name: Optional[str] = None
    amount: Optional[int] = None
    currency: Optional[str] = None
    expected_close_date: Optional[date] = None
    source: Optional[str] = None
    stage_id: Optional[int] = None


class MoveStage(BaseModel):
    stage_id: int


# ---------------------------
# Yardımcılar
# ---------------------------

def ensure_default_pipeline(db: Session, tenant_id: int) -> Pipeline:
    """
    Tenant için 'Sales' isimli default pipeline yoksa oluşturur
    ve temel aşamaları ekler.
    """
    p = db.query(Pipeline).filter_by(tenant_id=tenant_id, name="Sales").first()
    if not p:
        p = Pipeline(tenant_id=tenant_id, name="Sales")
        db.add(p)
        db.flush()  # p.id gerekli

        defaults = [
            ("New",        1, 10),
            ("Qualified",  2, 30),
            ("Proposal",   3, 60),
            ("Won",        4, 100),
        ]
        for n, order_idx, prob in defaults:
            db.add(
                Stage(
                    tenant_id=tenant_id,
                    pipeline_id=p.id,
                    name=n,
                    order_index=order_idx,
                    win_probability=prob,
                )
            )
        db.commit()
    return p


def resolve_stage_id(db: Session, tenant_id: int, stage_id: Optional[int]) -> int:
    """
    Verilen stage_id geçerliyse onu doğrular; verilmemişse
    default pipeline'ın ilk aşamasını döndürür.
    """
    if stage_id:
        st = (
            db.query(Stage)
            .join(Pipeline, Pipeline.id == Stage.pipeline_id)
            .filter(Stage.id == stage_id, Pipeline.tenant_id == tenant_id)
            .first()
        )
        if not st:
            raise HTTPException(status_code=400, detail="Invalid stage_id")
        return st.id

    p = ensure_default_pipeline(db, tenant_id)
    st = (
        db.query(Stage)
        .filter_by(pipeline_id=p.id)
        .order_by(asc(Stage.order_index))
        .first()
    )
    if not st:
        raise HTTPException(status_code=500, detail="No stages found for default pipeline")
    return st.id


# ---------------------------
# Endpoints
# ---------------------------

@router.get(
    "/",
    summary="List Deals",
    dependencies=[Depends(require_permissions(["deals:read"]))],
)
def list_deals(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    q: Optional[str] = None,
    stage_id: Optional[int] = None,
    account_id: Optional[int] = None,
):
    qs = db.query(Opportunity).filter(Opportunity.tenant_id == current.tenant_id)
    if q:
        qs = qs.filter(Opportunity.name.ilike(f"%{q}%"))
    if stage_id:
        qs = qs.filter(Opportunity.stage_id == stage_id)
    if account_id:
        qs = qs.filter(Opportunity.account_id == account_id)

    total = qs.count()
    items: List[Opportunity] = (
        qs.order_by(Opportunity.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"total": total, "page": page, "page_size": page_size, "items": items}


@router.post(
    "/",
    summary="Create Deal",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(["deals:write"]))],
)
def create_deal(
    body: DealCreate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    # Hesap tenant'a mı ait?
    acc = (
        db.query(Account)
        .filter(Account.id == body.account_id, Account.tenant_id == current.tenant_id)
        .first()
    )
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    st_id = resolve_stage_id(db, current.tenant_id, body.stage_id)

    deal = Opportunity(
        tenant_id=current.tenant_id,
        account_id=body.account_id,
        owner_id=current.id,
        name=body.name,
        amount=body.amount,
        currency=body.currency or "USD",
        stage_id=st_id,
        expected_close_date=body.expected_close_date,
        source=body.source,
    )
    db.add(deal)
    db.commit()
    db.refresh(deal)
    return deal


@router.get(
    "/{deal_id}",
    summary="Get Deal",
    dependencies=[Depends(require_permissions(["deals:read"]))],
)
def get_deal(
    deal_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    d = (
        db.query(Opportunity)
        .filter(Opportunity.id == deal_id, Opportunity.tenant_id == current.tenant_id)
        .first()
    )
    if not d:
        raise HTTPException(status_code=404, detail="Deal not found")
    return d


@router.patch(
    "/{deal_id}",
    summary="Update Deal",
    dependencies=[Depends(require_permissions(["deals:write"]))],
)
def update_deal(
    deal_id: int,
    body: DealUpdate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    d = (
        db.query(Opportunity)
        .filter(Opportunity.id == deal_id, Opportunity.tenant_id == current.tenant_id)
        .first()
    )
    if not d:
        raise HTTPException(status_code=404, detail="Deal not found")

    data = body.model_dump(exclude_unset=True)
    if "stage_id" in data:
        data["stage_id"] = resolve_stage_id(db, current.tenant_id, data["stage_id"])

    for k, v in data.items():
        setattr(d, k, v)

    db.commit()
    db.refresh(d)
    return d


@router.post(
    "/{deal_id}/move_stage",
    summary="Move Deal to another stage",
    dependencies=[Depends(require_permissions(["deals:write"]))],
)
def move_stage(
    deal_id: int,
    body: MoveStage,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    d = (
        db.query(Opportunity)
        .filter(Opportunity.id == deal_id, Opportunity.tenant_id == current.tenant_id)
        .first()
    )
    if not d:
        raise HTTPException(status_code=404, detail="Deal not found")

    d.stage_id = resolve_stage_id(db, current.tenant_id, body.stage_id)
    db.commit()
    db.refresh(d)
    return d


@router.delete(
    "/{deal_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Deal",
    dependencies=[Depends(require_permissions(["deals:write"]))],
)
def delete_deal(
    deal_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    d = (
        db.query(Opportunity)
        .filter(Opportunity.id == deal_id, Opportunity.tenant_id == current.tenant_id)
        .first()
    )
    if not d:
        raise HTTPException(status_code=404, detail="Deal not found")

    db.delete(d)
    db.commit()
    # 204 No Content
