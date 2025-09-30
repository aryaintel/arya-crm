from fastapi import FastAPI, Depends, Request, status
from fastapi.middleware.cors import CORSMiddleware

from .core.config import settings
from .api.deps import get_current_user, CurrentUser

# ---- Routers ----
# Pricing & formulation
from .api import service_pricing, boq_pricing, formulations_api, formulation_links_api
from .api.escalation import router as escalation_router
from app.api.rise_fall_api import router as rise_fall_router  # keep absolute to match pkg layout

# Core modules
from .api import (
    auth,
    accounts,
    contacts,
    deals,
    users,
    roles,
    secure,
    leads,
    business_cases,
    stages,
    scenario_boq as boq,
    twc,
    scenario_capex,
    scenario_services,
    scenario_overheads,
    scenario_fx,
    scenario_tax,
    workflow,
    index_series_api,
    escalations_api,
)

# NEW: Products & Price Books
from .api.products_api import router as products_router

# NEW: Rebates (Scenario-level)
from .api.rebates_api import router as rebates_router


app = FastAPI(title="Arya CRM API")

# ---------------------------
# CORS (frontend dev servers)
# ---------------------------
default_cors_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
allow_origins = getattr(settings, "CORS_ALLOW_ORIGINS", default_cors_origins)

# 1) Standard CORS middleware — must be added BEFORE routers
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2) Safety net: ensure CORS headers on ALL responses (401/404/500 included)
@app.middleware("http")
async def ensure_cors_headers(request: Request, call_next):
    response = await call_next(request)
    origin = request.headers.get("origin")
    if origin and (origin in allow_origins or "*" in allow_origins):
        # Mirror origin when credentials are used
        response.headers.setdefault("Access-Control-Allow-Origin", origin)
        response.headers.setdefault("Vary", "Origin")
        response.headers.setdefault("Access-Control-Allow-Credentials", "true")
    return response


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

# Alias to support older frontends expecting /auth/me
@app.get("/auth/me", tags=["auth"], status_code=status.HTTP_200_OK)
def me_alias(current: CurrentUser = Depends(get_current_user)):
    return {
        "id": current.id,
        "email": current.email,
        "tenant_id": current.tenant_id,
        "role": current.role_name,
    }


# ---------------------------
# Routers
# ---------------------------
# Auth & basic CRM
app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(contacts.router)
app.include_router(deals.router)
app.include_router(users.router)
app.include_router(roles.router)
app.include_router(secure.router)
app.include_router(leads.router)
app.include_router(stages.router)

# Business cases & scenarios
app.include_router(business_cases.router)
app.include_router(boq.router)                 # BOQ
app.include_router(twc.router)                 # TWC
app.include_router(scenario_capex.router)      # CAPEX
app.include_router(scenario_services.router)   # SERVICES (OPEX)
app.include_router(scenario_overheads.router)  # Overheads
app.include_router(scenario_fx.router)         # FX
app.include_router(scenario_tax.router)        # TAX
app.include_router(rebates_router)             # REBATES (NEW)

# Workflow & pricing/escalation
app.include_router(workflow.router)
app.include_router(service_pricing.router)     # PRICE PREVIEW (service)
app.include_router(boq_pricing.router)         # PRICE PREVIEW (boq)
app.include_router(formulations_api.router)    # FORMULATIONS CRUD
app.include_router(formulation_links_api.router)
app.include_router(index_series_api.router)
app.include_router(escalations_api.router)     # ESCALATIONS CRUD
app.include_router(escalation_router)
app.include_router(rise_fall_router)

# Products & Price Books
app.include_router(products_router)
