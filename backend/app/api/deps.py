# app/api/deps.py
from typing import List, Set
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

# SessionLocal core.config'ten gelir
from ..core.config import SessionLocal
from ..models import User, Role
from ..core.security import decode_token

# Swagger'da "Authorize" -> tek Bearer token alanı
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
    tenant_id = payload.get("tenant")
    role_name = payload.get("role")

    if user_id is None or tenant_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    user = (
        db.query(User)
        .filter(User.id == int(user_id), User.tenant_id == int(tenant_id))
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return CurrentUser(id=user.id, tenant_id=user.tenant_id, email=user.email, role_name=role_name or "")


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
        role = (
            db.query(Role)
            .filter(Role.tenant_id == current.tenant_id, Role.name == current.role_name)
            .first()
        )

        perms: Set[str] = set()
        if role and role.permissions:
            # permissions alanı "a:b,c:d,*" gibi virgülle ayrılmış string
            perms = {p.strip() for p in role.permissions.split(",") if p.strip()}

        # admin veya '*' her şeye izin
        if role and (role.name == "admin" or "*" in perms):
            return current

        # gerekli izinlerden herhangi biri varsa geç
        if required_set & perms:
            return current

        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")

    return checker
