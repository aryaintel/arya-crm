# backend/app/api/accounts.py

from typing import Optional, List, Dict, Any
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, constr
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from ..models import Account
from .deps import get_db, get_current_user, CurrentUser, require_permissions


router = APIRouter(prefix="/accounts", tags=["accounts"])


# ---------- Pydantic şemaları ----------

class AccountBase(BaseModel):
    name: constr(strip_whitespace=True, min_length=1) = Field(..., description="Account name")
    industry: Optional[str] = None
    type: Optional[str] = None
    website: Optional[str] = None
    phone: Optional[str] = None
    billing_address: Optional[str] = None
    shipping_address: Optional[str] = None
    owner_id: Optional[int] = Field(
        default=None,
        description="Varsayılan olarak current user id atanır (göndermezseniz)"
    )


class AccountCreate(AccountBase):
    """Create gövdesi — AccountBase ile aynı."""
    pass


class AccountUpdate(BaseModel):
    """Kısmi güncelleme (PATCH). Tüm alanlar opsiyonel."""
    name: Optional[constr(strip_whitespace=True, min_length=1)] = None
    industry: Optional[str] = None
    type: Optional[str] = None
    website: Optional[str] = None
    phone: Optional[str] = None
    billing_address: Optional[str] = None
    shipping_address: Optional[str] = None
    owner_id: Optional[int] = None


class AccountOut(AccountBase):
    id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True  # pydantic v2 (orm_mode karşılığı)


# ---------- Yardımcılar ----------

_ALLOWED_SORTS: Dict[str, Any] = {
    "id": Account.id,
    "name": Account.name,
    "created_at": Account.created_at,
}

def _apply_search(qs, q: Optional[str]):
    """Basit metin arama (name/website/phone/addresses)."""
    if not q:
        return qs
    q_norm = (q or "").strip().lower()
    if not q_norm:
        return qs
    return qs.filter(
        or_(
            func.lower(Account.name).contains(q_norm),
            func.lower(Account.website).contains(q_norm),
            func.lower(Account.phone).contains(q_norm),
            func.lower(Account.billing_address).contains(q_norm),
            func.lower(Account.shipping_address).contains(q_norm),
        )
    )


def _apply_sort(qs, sort: Optional[str]):
    """
    sort param formatı:
      - "created_at" (varsayılan: desc)
      - "created_at:desc"
      - "name:asc" / "name:desc"
      - "id", "id:desc"
    """
    if not sort:
        return qs.order_by(Account.created_at.desc())

    try:
        field, direction = (sort.split(":", 1) + ["asc"])[:2]
        column = _ALLOWED_SORTS.get(field)
        if column is None:
            # bilinmeyen alan -> default
            return qs.order_by(Account.created_at.desc())
        if direction.lower() == "desc":
            return qs.order_by(column.desc())
        else:
            return qs.order_by(column.asc())
    except Exception:
        # hatalı format -> default
        return qs.order_by(Account.created_at.desc())


# ---------- Endpoints ----------

@router.get(
    "/",
    summary="List Accounts (paged, optional search & sort)",
    # NOTE: Üye (member) okuma yapabilsin diye sadece kimlik doğrulama yeterli
)
def list_accounts(
    page: int = Query(1, ge=1, description="1-based page index"),
    size: int = Query(20, ge=1, le=100, description="Page size (max 100)"),
    q: Optional[str] = Query(None, description="Search text (name/website/phone/address)"),
    sort: Optional[str] = Query(
        None,
        description='Sort by "id|name|created_at" + optional ":asc|desc", örn: "name:asc"'
    ),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    base_q = db.query(Account).filter(Account.tenant_id == current.tenant_id)
    base_q = _apply_search(base_q, q)
    total = base_q.count()

    qs = _apply_sort(base_q, sort)
    rows: List[Account] = (
        qs.offset((page - 1) * size)
        .limit(size)
        .all()
    )

    items = [AccountOut.model_validate(r) for r in rows]
    meta = {
        "total": total,
        "page": page,
        "size": size,
        "pages": max(1, (total + size - 1) // size),
    }
    return {"meta": meta, "items": items}


@router.post(
    "/",
    response_model=AccountOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create Account",
    dependencies=[Depends(require_permissions(["accounts:write"]))],
)
def create_account(
    body: AccountCreate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    acc = Account(
        tenant_id=current.tenant_id,
        name=body.name,
        industry=body.industry,
        type=body.type,
        website=body.website,
        phone=body.phone,
        billing_address=body.billing_address,
        shipping_address=body.shipping_address,
        owner_id=body.owner_id or current.id,
    )
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return AccountOut.model_validate(acc)


@router.get(
    "/{account_id}",
    response_model=AccountOut,
    summary="Get Account",
    # NOTE: okuma için yalnız doğrulama yeterli
)
def get_account(
    account_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    acc = (
        db.query(Account)
        .filter(
            Account.id == account_id,
            Account.tenant_id == current.tenant_id,
        )
        .first()
    )
    if not acc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return AccountOut.model_validate(acc)


@router.patch(
    "/{account_id}",
    response_model=AccountOut,
    summary="Update Account (partial)",
    dependencies=[Depends(require_permissions(["accounts:write"]))],
)
def update_account(
    account_id: int,
    body: AccountUpdate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    acc = (
        db.query(Account)
        .filter(
            Account.id == account_id,
            Account.tenant_id == current.tenant_id,
        )
        .first()
    )
    if not acc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(acc, k, v)

    db.commit()
    db.refresh(acc)
    return AccountOut.model_validate(acc)


@router.delete(
    "/{account_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Account",
    dependencies=[Depends(require_permissions(["accounts:write"]))],
)
def delete_account(
    account_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    acc = (
        db.query(Account)
        .filter(
            Account.id == account_id,
            Account.tenant_id == current.tenant_id,
        )
        .first()
    )
    if not acc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    db.delete(acc)
    db.commit()
    return None
