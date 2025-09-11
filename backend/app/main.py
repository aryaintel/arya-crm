from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from .core.config import settings
from .api.deps import get_current_user, CurrentUser
from .api import auth, secure, accounts, contacts, deals, users  # ← users eklendi

app = FastAPI(title="Arya CRM API")


# ---------------------------
# CORS (frontend için)
# ---------------------------
# settings.py içinde CORS_ALLOW_ORIGINS tanımlı değilse varsayılan olarak "*"
allow_origins = getattr(settings, "CORS_ALLOW_ORIGINS", ["*"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------
# Health & Current User
# ---------------------------
@app.get("/health", tags=["system"])
def health():
    """Kubernetes/liveness probe için basit health check"""
    return {"status": "ok"}


@app.get("/me", tags=["auth"])
def me(current: CurrentUser = Depends(get_current_user)):
    """Token doğrulandıktan sonra mevcut kullanıcı bilgilerini döner"""
    return {
        "id": current.id,
        "email": current.email,
        "tenant_id": current.tenant_id,
        "role": current.role_name,
    }


# ---------------------------
# Routers
# ---------------------------
app.include_router(auth.router)
app.include_router(secure.router)
app.include_router(accounts.router)
app.include_router(contacts.router)
app.include_router(deals.router)
app.include_router(users.router)  # ← users router burada bağlandı
