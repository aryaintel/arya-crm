# backend/app/api/contacts.py

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from datetime import datetime

from .deps import get_db, get_current_user, CurrentUser, require_permissions
from app.models import Contact, Account

router = APIRouter(prefix="/contacts", tags=["contacts"])


# ---------------------------
# Pydantic Schemas
# ---------------------------

class ContactCreate(BaseModel):
    name: str = Field(..., min_length=1)
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    title: Optional[str] = None
    notes: Optional[str] = None
    account_id: int


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    title: Optional[str] = None
    notes: Optional[str] = None
    account_id: Optional[int] = None


class ContactOut(BaseModel):
    id: int
    tenant_id: int
    account_id: int
    name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    title: Optional[str] = None
    notes: Optional[str] = None
    owner_id: Optional[int] = None
    created_at: Optional[datetime] = None   # <-- str yerine datetime
    # updated_at: Optional[datetime] = None # modelde yoksa kaldır

    class Config:
        from_attributes = True


class PageMeta(BaseModel):
    total: int
    page: int
    size: int
    pages: int


class ContactsListOut(BaseModel):
    meta: PageMeta
    items: List[ContactOut]


# ---------------------------
# Helpers
# ---------------------------

def _ensure_account_in_tenant(db: Session, tenant_id: int, account_id: int) -> Account:
    acc = (
        db.query(Account)
        .filter(Account.id == account_id, Account.tenant_id == tenant_id)
        .first()
    )
    if not acc:
        raise HTTPException(status_code=400, detail="Account not found in your tenant")
    return acc


# ---------------------------
# Endpoints
# ---------------------------

@router.get(
    "/",
    response_model=ContactsListOut,
    dependencies=[Depends(require_permissions(["contacts:read"]))],
)
def list_contacts(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
    search: Optional[str] = Query(None, description="Search in name/email/phone"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
):
    q = db.query(Contact).filter(Contact.tenant_id == current.tenant_id)

    if search:
        like = f"%{search}%"
        q = q.filter(
            or_(Contact.name.ilike(like), Contact.email.ilike(like), Contact.phone.ilike(like))
        )

    total = q.count()
    items = (
        q.order_by(Contact.id.desc())
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )

    pages = (total + size - 1) // size if size else 1

    return ContactsListOut(
        meta=PageMeta(total=total, page=page, size=size, pages=pages),
        items=items,
    )


@router.post(
    "/",
    response_model=ContactOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(["contacts:create"]))],
)
def create_contact(
    body: ContactCreate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    # account tenant kontrolü
    _ensure_account_in_tenant(db, current.tenant_id, body.account_id)

    contact = Contact(
        tenant_id=current.tenant_id,
        account_id=body.account_id,
        name=body.name,
        email=body.email,
        phone=body.phone,
        title=body.title,
        notes=body.notes,
        owner_id=current.id,  # NOT NULL / FK hatalarını önler
    )

    try:
        db.add(contact)
        db.commit()
        db.refresh(contact)
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail="Contact violates a DB constraint") from e

    return contact


@router.get(
    "/{contact_id}",
    response_model=ContactOut,
    dependencies=[Depends(require_permissions(["contacts:read"]))],
)
def get_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    contact = (
        db.query(Contact)
        .filter(Contact.id == contact_id, Contact.tenant_id == current.tenant_id)
        .first()
    )
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


@router.patch(
    "/{contact_id}",
    response_model=ContactOut,
    dependencies=[Depends(require_permissions(["contacts:write"]))],
)
def update_contact(
    contact_id: int,
    body: ContactUpdate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    contact = (
        db.query(Contact)
        .filter(Contact.id == contact_id, Contact.tenant_id == current.tenant_id)
        .first()
    )
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    # Eğer account_id gönderildiyse, aynı tenant'ta mı kontrol et
    if body.account_id is not None:
        _ensure_account_in_tenant(db, current.tenant_id, body.account_id)

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(contact, field, value)

    try:
        db.commit()
        db.refresh(contact)
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail="Contact violates a DB constraint") from e

    return contact


@router.delete(
    "/{contact_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permissions(["contacts:write"]))],
)
def delete_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    contact = (
        db.query(Contact)
        .filter(Contact.id == contact_id, Contact.tenant_id == current.tenant_id)
        .first()
    )
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    db.delete(contact)
    db.commit()
    # 204 No Content
