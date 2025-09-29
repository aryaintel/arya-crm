from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware

from .core.config import settings
from .api.deps import get_current_user, CurrentUser

# --- mevcut router importları ---
from .api import service_pricing, boq_pricing, formulations_api
from .api import escalation as escalation_router
from app.api.rise_fall_api import router as rise_fall_router
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
    twc,                  # ONLY TWC router
    scenario_fx, 
    scenario_tax,
    formulation_links_api,
    index_series_api,
    escalations_api,      # ✅ ESCALATIONS router
)

# --- NEW: Products API router (CRUD + price books) ---
from .api.products_api import router as products_router

app = FastAPI(title="Arya CRM API")

# ---------------------------
# CORS (frontend için)
# ---------------------------
default_cors_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
allow_origins = getattr(settings, "CORS_ALLOW_ORIGINS", default_cors_origins)

# 1) Standart CORS middleware — router'lardan ÖNCE
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2) Garantör katman: HER yanıta CORS header'ı ekle (401/404/500 dahil)
@app.middleware("http")
async def ensure_cors_headers(request: Request, call_next):
    resp = await call_next(request)
    origin = request.headers.get("origin")
    if origin and (origin in allow_origins or "*" in allow_origins):
        resp.headers.setdefault("Access-Control-Allow-Origin", origin)
        resp.headers.setdefault("Vary", "Origin")
        resp.headers.setdefault("Access-Control-Allow-Credentials", "true")
        resp.headers.setdefault("Access-Control-Expose-Headers", "*")
    return resp

# ---------------------------
# Health & Current User
# ---------------------------
@app.get("/health", tags=["system"])
def health():
    return {"status": "ok"}

@app.get("/me", tags=["auth"])
def me(current: CurrentUser = Depends(get_current_user)):
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
app.include_router(twc.router)                 # TWC
app.include_router(scenario_capex.router)      # CAPEX
app.include_router(scenario_services.router)   # SERVICES (OPEX)
app.include_router(scenario_overheads.router)  # Overheads
app.include_router(scenario_fx.router)         # FX
app.include_router(scenario_tax.router)        # TAX

# Workflow & pricing/escalation
app.include_router(workflow.router)
app.include_router(service_pricing.router)     # PRICE PREVIEW (service)
app.include_router(boq_pricing.router)         # PRICE PREVIEW (boq)
app.include_router(formulations_api.router)    # FORMULATIONS CRUD
app.include_router(formulation_links_api.router)
app.include_router(index_series_api.router)
app.include_router(escalations_api.router)     # ESCALATIONS CRUD
app.include_router(escalation_router.router)
app.include_router(rise_fall_router)

# --- NEW: Products & Price Books ---
app.include_router(products_router)
