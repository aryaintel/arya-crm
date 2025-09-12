# backend/app/api/auth.py

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from ..models import Tenant, User, Role
from .deps import get_db, get_current_user, CurrentUser
from ..core.security import hash_password, verify_password, create_access_token

router = APIRouter(prefix="/auth", tags=["auth"])


# ---------- Schemas ----------

class SignupIn(BaseModel):
    tenant_name: str
    tenant_slug: str
    admin_email: EmailStr
    admin_password: str


class LoginIn(BaseModel):
    tenant_slug: str
    email: EmailStr
    password: str


class MeOut(BaseModel):
    id: int
    email: EmailStr
    tenant_id: int
    role: str


# ---------- Endpoints ----------

@router.post("/signup")
def signup(body: SignupIn, db: Session = Depends(get_db)):
    """
    Yeni bir tenant + admin kullanıcı oluşturur ve admin için erişim token'ı döner.
    """
    # slug benzersiz olmalı
    if db.query(Tenant).filter(Tenant.slug == body.tenant_slug).first():
        raise HTTPException(status_code=400, detail="Tenant slug already exists")

    try:
        # 1) Tenant
        tenant = Tenant(name=body.tenant_name, slug=body.tenant_slug)
        db.add(tenant)
        db.flush()  # tenant.id artık hazır

        # 2) Admin role (tüm izinler)
        admin_role = Role(tenant_id=tenant.id, name="admin", permissions="*")
        db.add(admin_role)

        # 3) Admin user
        user = User(
            tenant_id=tenant.id,
            email=body.admin_email.lower(),
            password_hash=hash_password(body.admin_password),
            role_name="admin",
            # is_active backend modelinde default True ise ekstra set etmeye gerek yok;
            # değilse burada True verilebilir:
            # is_active=True,
        )
        db.add(user)
        db.flush()  # user.id kesinleşsin

        # 4) Token
        token = create_access_token(
            subject=str(user.id),
            tenant_id=tenant.id,
            role_name="admin",
        )

        db.commit()
        return {"access_token": token, "token_type": "bearer"}

    except IntegrityError:
        db.rollback()
        # Örn. aynı email/slug tekrar girildiyse
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Signup violates a DB constraint",
        )


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    """
    Tenant slug + email + password ile giriş yapar ve erişim token'ı döner.
    """
    tenant = db.query(Tenant).filter(Tenant.slug == body.tenant_slug).first()
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant not found")

    email_lc = body.email.lower()
    user = (
        db.query(User)
        .filter(User.tenant_id == tenant.id, User.email == email_lc)
        .first()
    )
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Aktiflik kontrolü
    if user.is_active is False:
        raise HTTPException(status_code=403, detail="User is inactive")

    token = create_access_token(
        subject=str(user.id),
        tenant_id=tenant.id,
        role_name=user.role_name,
    )
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=MeOut)
def me(current: CurrentUser = Depends(get_current_user)):
    """
    Mevcut kullanıcının temel bilgilerini döner (frontend header/menü için).
    """
    return MeOut(
        id=current.id,
        email=current.email,
        tenant_id=current.tenant_id,
        role=current.role,
    )
