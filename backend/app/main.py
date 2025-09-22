# backend/app/main.py
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from .core.config import settings
from .api.deps import get_current_user, CurrentUser

# Router imports (relative)
from .api import (
    auth,
    accounts,
    contacts,
    deals,
    users,
    roles,
    secure,
    leads,
    business_cases,       # Business Case & Scenario API
    scenario_overheads,   # Overheads router
    scenario_capex,       # CAPEX router
    scenario_services,    # SERVICES (OPEX) router
    boq,                  # BOQ router
    workflow,             # Workflow router
    twc,                  # <-- ONLY TWC router (scenario_twc KALDIRILDI)
    scenario_fx, 
    scenario_tax,         # FX Rates router (NEW)
)

app = FastAPI(title="Arya CRM API")

# ---------------------------
# CORS (frontend için)
# ---------------------------
allow_origins = getattr(
    settings,
    "CORS_ALLOW_ORIGINS",
    ["http://localhost:5173", "http://127.0.0.1:5173"],
)
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
app.include_router(accounts.router)
app.include_router(contacts.router)
app.include_router(deals.router)
app.include_router(users.router)
app.include_router(roles.router)
app.include_router(secure.router)
app.include_router(leads.router)

app.include_router(business_cases.router)

# Inputs
app.include_router(boq.router)                 # BOQ
app.include_router(twc.router)                 # TWC (only this)
app.include_router(scenario_capex.router)      # CAPEX
app.include_router(scenario_services.router)   # SERVICES (OPEX)
app.include_router(scenario_overheads.router)  # Overheads
app.include_router(scenario_fx.router)         # FX (NEW)
app.include_router(scenario_tax.router)
# Workflow
app.include_router(workflow.router)
