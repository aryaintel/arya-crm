# app/api/deps.py
from typing import List, Set
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from ..core.config import SessionLocal
from ..models import User, Role
from ..core.security import decode_token  # -> payload: sub, tenant_id, role_name

# Swagger "Authorize" için Bearer alanı
auth_scheme = HTTPBearer(auto_error=True)


# ---------------------------
# DB Session Dependency
# ---------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------
# Current User DTO
# ---------------------------
class CurrentUser:
    def __init__(self, id: int, tenant_id: int, email: str, role_name: str):
        self.id = id
        self.tenant_id = tenant_id
        self.email = email
        self.role_name = role_name


# Member için güvenli varsayılanlar (Role tablosu boşsa/eksikse)
MEMBER_DEFAULT_PERMS: Set[str] = {
    "accounts:read",
    "contacts:read",
    "deals:read",
}


# ---------------------------
# AuthN: Token → CurrentUser
# ---------------------------
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(auth_scheme),
    db: Session = Depends(get_db),
) -> CurrentUser:
    token = credentials.credentials
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )

    user_id = payload.get("sub")
    tenant_id = payload.get("tenant_id")
    role_from_token = payload.get("role_name")

    if user_id is None or tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    user = (
        db.query(User)
        .filter(User.id == int(user_id), User.tenant_id == int(tenant_id))
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    # DB'deki rol öncelikli; yoksa token'daki
    role_name = (getattr(user, "role_name", None) or role_from_token or "").strip()

    return CurrentUser(
        id=user.id,
        tenant_id=user.tenant_id,
        email=user.email,
        role_name=role_name,
    )


# ---------------------------
# AuthZ: Permission Check
# ---------------------------
def require_permissions(required: List[str]):
    """
    Kullanım:
      dependencies=[Depends(require_permissions(["accounts:read"]))]
    """
    required_set: Set[str] = set(required)

    def checker(
        current: CurrentUser = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> CurrentUser:
        # admin her şeye yetkili
        if current.role_name.lower() == "admin":
            return current

        # Role tablosundan izinleri oku
        perms: Set[str] = set()
        role = None
        if current.role_name:
            role = (
                db.query(Role)
                .filter(Role.tenant_id == current.tenant_id, Role.name == current.role_name)
                .first()
            )
        if role and role.permissions:
            raw = role.permissions.strip()
            if raw == "*":
                return current  # global izin
            perms = {p.strip() for p in raw.split(",") if p.strip()}

        # member için fallback (Role kaydı yoksa veya izinler boşsa)
        if current.role_name.lower() == "member":
            perms |= MEMBER_DEFAULT_PERMS

        # Gerekli izinlerin TAMAMI mevcut mu?
        if required_set.issubset(perms):
            return current

        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")

    return checker
