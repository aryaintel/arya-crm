from typing import List, Set, Optional
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

    user_id: Optional[int] = payload.get("sub")
    tenant_id: Optional[int] = payload.get("tenant")
    role_name: str = payload.get("role") or ""

    if user_id is None or tenant_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    user = (
        db.query(User)
        .filter(User.id == int(user_id), User.tenant_id == int(tenant_id))
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return CurrentUser(id=user.id, tenant_id=user.tenant_id, email=user.email, role_name=role_name)


# ---------------------------
# AuthZ: Permission Check
# ---------------------------

# Rol bazlı varsayılan izinler (DB'de boş olsa dahi uygulanır)
# İstersen burada kapsamı genişletebilirsin.
DEFAULT_ROLE_PERMS = {
    "admin": {"*"},  # her şey
    "member": {
        # read-only izinler
        "accounts:read",
        "contacts:read",
        "deals:read",
        # gerekiyorsa başka okuma izinlerini de ekle
    },
}


def _resolve_permissions(db_perms_raw: Optional[str], role_name: str) -> Set[str]:
    """
    DB'deki virgüllü izinleri parse eder ve DEFAULT_ROLE_PERMS ile birleştirir.
    """
    perms: Set[str] = set()

    # DB'den gelen izinler (ör: "accounts:read,accounts:write")
    if db_perms_raw:
        perms |= {p.strip() for p in db_perms_raw.split(",") if p.strip()}

    # Rolün varsayılan izinleri
    perms |= DEFAULT_ROLE_PERMS.get(role_name or "", set())

    return perms


def require_permissions(required: List[str]):
    """
    Kullanım:
      dependencies=[Depends(require_permissions(["accounts:read"]))]

    Mantık:
      - admin veya '*' → her şeye izin
      - required set'i ile kullanıcı izinlerinin KESİŞİMİ doluysa → izin ver
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

        # Rol bulunamazsa dahi varsayılan role-izin eşlemesini uygula
        role_name = role.name if role else current.role_name
        perms = _resolve_permissions(role.permissions if role else None, role_name)

        # admin veya '*' her şeye izin
        if role_name == "admin" or "*" in perms:
            return current

        # gerekli izinlerden herhangi biri varsa geç
        if required_set & perms:
            return current

        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")

    return checker
