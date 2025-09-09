# backend/app/api/secure.py
from fastapi import APIRouter, Depends, status
from .deps import require_permissions, CurrentUser

router = APIRouter(prefix="/secure", tags=["secure"])


@router.get(
    "/hello",
    summary="Protected hello endpoint",
    status_code=status.HTTP_200_OK,
)
def secure_hello(
    current: CurrentUser = Depends(require_permissions(["read:secure"]))
):
    """
    Basit bir korumalı endpoint.
    Kullanıcı `read:secure` iznine sahip olmalı.
    """
    return {"message": f"Hello {current.email}, you have access!"}
