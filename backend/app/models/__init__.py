# backend/app/models/__init__.py
from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
    Date,
    ForeignKey,
    UniqueConstraint,
    Index,
    CheckConstraint,
    func,
    Numeric,
    Boolean,
)
from sqlalchemy.orm import declarative_base, relationship
from ..core.config import engine

Base = declarative_base()

# =========================
# Core (Tenant / User / Role)
# =========================
class Tenant(Base):
    __tablename__ = "tenants"
    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String, unique=True, nullable=False)  # arya, demo
    name = Column(String, nullable=False)               # Arya Demo, Şirket Adı


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)

    email = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    role_name = Column(String, nullable=False, default="user")

    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("tenant_id", "email", name="uix_user_tenant_email"),
    )


# =========================
# Scenario TWC (i.WC)
# =========================
class ScenarioTWC(Base):
    __tablename__ = "scenario_twc"

    id = Column(Integer, primary_key=True, index=True)
    scenario_id = Column(Integer, ForeignKey("scenarios.id", ondelete="CASCADE"), nullable=False)

    dso_days = Column(Integer, nullable=False, default=45)   # 0..365
    dpo_days = Column(Integer, nullable=False, default=30)   # 0..365
    inventory_days = Column(Integer, nullable=True)          # NULL | 0..365
    notes = Column(Text, nullable=True)

    scenario = relationship("Scenario", back_populates="twc", lazy="selectin")

    __table_args__ = (
        UniqueConstraint("scenario_id", name="uix_twc_scenario_unique"),
        Index("ix_twc_scenario", "scenario_id"),
        CheckConstraint("dso_days >= 0 AND dso_days <= 365", name="ck_twc_dso_days"),
        CheckConstraint("dpo_days >= 0 AND dpo_days <= 365", name="ck_twc_dpo_days"),
        CheckConstraint(
            "(inventory_days IS NULL) OR (inventory_days >= 0 AND inventory_days <= 365)",
            name="ck_twc_inventory_days",
        ),
    )


class Role(Base):
    """
    Basit rol modeli; permissions virgül ayrımlı string:
    Örn: "accounts:read,accounts:write,contacts:read" veya admin için "*"
    """
    __tablename__ = "roles"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)     # admin, sales, support ...
    permissions = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uix_role_tenant_name"),
    )


# =========================
# Accounts / Contacts
# =========================
class Account(Base):
    __tablename__ = "accounts"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)

    name = Column(String, nullable=False)
    industry = Column(String, nullable=True)
    type = Column(String, nullable=True)
    website = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    billing_address = Column(Text, nullable=True)
    shipping_address = Column(Text, nullable=True)

    account_number = Column(String(50), nullable=True)
    employees = Column(Integer, nullable=True)
    annual_revenue = Column(Integer, nullable=True)
    rating = Column(String(20), nullable=True)     # Hot | Warm | Cold
    ownership = Column(String(20), nullable=True)  # Public | Private | Other
    description = Column(Text, nullable=True)

    owner_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    owner = relationship("User", lazy="selectin")


class Contact(Base):
    __tablename__ = "contacts"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)

    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    owner_id   = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=False)

    name  = Column(String, nullable=False)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    title = Column(String, nullable=True)
    notes = Column(Text,   nullable=True)

    created_at = Column(DateTime, server_default=func.now())

    account = relationship("Account", lazy="selectin")
    owner   = relationship("User", lazy="selectin")


# =========================
# Leads
# =========================
class Lead(Base):
    """
    Lead → henüz Account/Contact/Opportunity'ye dönmemiş aday.
    Convert sonrası referans id’leri (soft link) saklanır.
    """
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    owner_id  = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=False)

    # Profil
    name    = Column(String, nullable=False)
    company = Column(String, nullable=True)
    email   = Column(String, nullable=True)
    phone   = Column(String, nullable=True)
    title   = Column(String, nullable=True)

    # Satış niteliği
    status  = Column(String, nullable=True)   # New, Working, Nurturing, Unqualified, Converted
    source  = Column(String, nullable=True)   # Referral, Web, Event...
    rating  = Column(String, nullable=True)   # Hot, Warm, Cold
    notes   = Column(Text,   nullable=True)

    # Convert meta (soft link)
    converted_account_id     = Column(Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    converted_opportunity_id = Column(Integer, ForeignKey("opportunities.id", ondelete="SET NULL"), nullable=True)
    converted_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    owner = relationship("User", lazy="selectin")
    converted_account = relationship("Account", lazy="selectin", foreign_keys=[converted_account_id])
    converted_opportunity = relationship("Opportunity", lazy="selectin", foreign_keys=[converted_opportunity_id])


# =========================
# Pipeline / Stage / Opportunity
# =========================
class Pipeline(Base):
    __tablename__ = "pipelines"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class Stage(Base):
    __tablename__ = "stages"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("pipelines.id", ondelete="CASCADE"), nullable=False)
    pipeline_id = Column(Integer, ForeignKey("pipelines.id", ondelete="CASCADE"), nullable=False)

    name = Column(String, nullable=False)
    order_index = Column(Integer, nullable=False, default=1)  # UI bu adı kullanıyor
    win_probability = Column(Integer, nullable=True)

    created_at = Column(DateTime, server_default=func.now())


class Opportunity(Base):
    __tablename__ = "opportunities"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=False)

    name = Column(String, nullable=False)
    amount = Column(Integer, nullable=True)
    currency = Column(String, nullable=True)
    stage_id = Column(Integer, ForeignKey("stages.id", ondelete="SET NULL"), nullable=False)

    expected_close_date = Column(Date, nullable=True)
    source = Column(String, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    account = relationship("Account", lazy="selectin")
    owner   = relationship("User", lazy="selectin")

    business_case = relationship("BusinessCase", uselist=False, back_populates="opportunity", lazy="selectin")


# =========================
# Business Case / Scenario
# =========================
class BusinessCase(Base):
    __tablename__ = "business_cases"
    id = Column(Integer, primary_key=True, index=True)
    opportunity_id = Column(Integer, ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)

    opportunity = relationship("Opportunity", back_populates="business_case", lazy="selectin")
    scenarios = relationship("Scenario", back_populates="business_case", cascade="all, delete-orphan", lazy="selectin")

    __table_args__ = (
        UniqueConstraint("opportunity_id", name="uix_business_case_opportunity_1to1"),
    )


class Scenario(Base):
    __tablename__ = "scenarios"
    id = Column(Integer, primary_key=True, index=True)
    business_case_id = Column(Integer, ForeignKey("business_cases.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    months = Column(Integer, nullable=False, default=36)
    start_date = Column(Date, nullable=False)

    # Excel sırası (Input tabları): BOQ -> TWC -> CAPEX -> SERVICES -> (Calc) -> P&L
    is_boq_ready       = Column(Boolean, nullable=False, default=False, server_default="0")
    is_twc_ready       = Column(Boolean, nullable=False, default=False, server_default="0")
    is_capex_ready     = Column(Boolean, nullable=False, default=False, server_default="0")
    is_services_ready  = Column(Boolean, nullable=False, default=False, server_default="0")
    workflow_state     = Column(String,  nullable=False, default="draft", server_default="draft")

    business_case = relationship("BusinessCase", back_populates="scenarios", lazy="selectin")
    products   = relationship("ScenarioProduct", back_populates="scenario", cascade="all, delete-orphan", lazy="selectin")
    overheads  = relationship("ScenarioOverhead", back_populates="scenario", cascade="all, delete-orphan", lazy="selectin")
    boq_items  = relationship("ScenarioBOQItem", back_populates="scenario", cascade="all, delete-orphan", lazy="selectin")
    capex_items= relationship("ScenarioCapex", backref="scenario", cascade="all, delete-orphan", lazy="selectin")
    services   = relationship("ScenarioService", back_populates="scenario", cascade="all, delete-orphan", lazy="selectin")
    # 1:1 TWC
    twc        = relationship("ScenarioTWC", uselist=False, back_populates="scenario", cascade="all, delete-orphan", lazy="selectin")
    # 1:N TAX RULES  ← YENİ
    taxes      = relationship("ScenarioTaxRule", back_populates="scenario", cascade="all, delete-orphan", lazy="selectin")

    __table_args__ = (Index("ix_scenarios_bc", "business_case_id"),)


# =========================
# Scenario: Revenues (Products) & Overheads
# =========================
class ScenarioProduct(Base):
    __tablename__ = "scenario_products"
    id = Column(Integer, primary_key=True, index=True)
    scenario_id = Column(Integer, ForeignKey("scenarios.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    price = Column(Numeric(18, 4), nullable=False, default=0)
    unit_cogs = Column(Numeric(18, 4), nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True, server_default="1")

    scenario = relationship("Scenario", back_populates="products", lazy="selectin")
    months = relationship("ScenarioProductMonth", back_populates="product", cascade="all, delete-orphan", lazy="selectin")


class ScenarioProductMonth(Base):
    __tablename__ = "scenario_product_months"
    id = Column(Integer, primary_key=True, index=True)
    scenario_product_id = Column(Integer, ForeignKey("scenario_products.id", ondelete="CASCADE"), nullable=False)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)  # 1..12
    quantity = Column(Numeric(18, 4), nullable=False, default=0)

    product = relationship("ScenarioProduct", back_populates="months", lazy="selectin")


class ScenarioOverhead(Base):
    __tablename__ = "scenario_overheads"
    id = Column(Integer, primary_key=True, index=True)
    scenario_id = Column(Integer, ForeignKey("scenarios.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    type = Column(String(20), nullable=False)          # 'fixed' | '%_revenue'
    amount = Column(Numeric(18, 4), nullable=False, default=0)

    scenario = relationship("Scenario", back_populates="overheads", lazy="selectin")


# =========================
# Scenario: CAPEX
# =========================
class ScenarioCapex(Base):
    __tablename__ = "scenario_capex"

    id = Column(Integer, primary_key=True, index=True)
    scenario_id = Column(Integer, ForeignKey("scenarios.id", ondelete="CASCADE"), nullable=False)

    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)  # 1..12
    amount = Column(Numeric(18, 2), nullable=False, default=0)
    notes = Column(Text, nullable=True)

    # V2
    asset_name = Column(String, nullable=True)
    category = Column(String, nullable=True)
    service_start_year = Column(Integer, nullable=True)
    service_start_month = Column(Integer, nullable=True)
    useful_life_months = Column(Integer, nullable=True)
    depr_method = Column(String, nullable=True, default="straight_line")
    salvage_value = Column(Numeric(18, 2), nullable=True, default=0)
    is_active = Column(Boolean, nullable=True, default=True)

    # V3
    disposal_year = Column(Integer, nullable=True)
    disposal_month = Column(Integer, nullable=True)
    disposal_proceeds = Column(Numeric(18, 2), nullable=True, default=0)
    replace_at_end = Column(Boolean, nullable=True, default=False)
    per_unit_cost = Column(Numeric(18, 2), nullable=True)
    quantity = Column(Integer, nullable=True)
    contingency_pct = Column(Numeric(5, 2), nullable=True, default=0)
    partial_month_policy = Column(String, nullable=True, default="full_month")


# =========================
# Scenario: BOQ (Bill of Quantities)
# =========================
class ScenarioBOQItem(Base):
    __tablename__ = "scenario_boq_items"

    id = Column(Integer, primary_key=True, index=True)
    scenario_id = Column(Integer, ForeignKey("scenarios.id", ondelete="CASCADE"), nullable=False)

    section = Column(String(50), nullable=True)          # Örn: "AN", "EM"
    item_name = Column(String(255), nullable=False)
    unit = Column(String(50), nullable=False)            # ton, m3, adet...
    quantity = Column(Numeric(18, 4), nullable=False, default=0)
    unit_price = Column(Numeric(18, 4), nullable=False, default=0)
    unit_cogs = Column(Numeric(18, 4), nullable=True)

    frequency = Column(String(20), nullable=False, default="once")  # once|monthly|per_shipment|per_tonne
    start_year = Column(Integer, nullable=True)
    start_month = Column(Integer, nullable=True)         # 1..12
    months = Column(Integer, nullable=True)              # monthly ise kaç ay

    is_active = Column(Boolean, nullable=False, default=True, server_default="1")
    notes = Column(Text, nullable=True)

    category = Column(String, nullable=True)

    scenario = relationship("Scenario", back_populates="boq_items", lazy="selectin")

    __table_args__ = (
        CheckConstraint(
            "category IN ('bulk_with_freight','bulk_ex_freight','freight')",
            name="ck_boq_category",
        ),
        Index("ix_boq_scenario", "scenario_id"),
    )


# =========================
# Scenario: SERVICES (OPEX)
# =========================
class ScenarioService(Base):
    __tablename__ = "scenario_services"

    id = Column(Integer, primary_key=True, index=True)
    scenario_id = Column(Integer, ForeignKey("scenarios.id", ondelete="CASCADE"), nullable=False)

    # Temel bilgiler
    service_name = Column(String, nullable=False)
    category = Column(String, nullable=True)
    vendor = Column(String, nullable=True)
    unit = Column(String, nullable=True)

    # Fiyat / miktar
    quantity = Column(Numeric(18, 4), nullable=False, default=1)
    unit_cost = Column(Numeric(18, 4), nullable=False, default=0)
    currency = Column(String(3), nullable=False, default="TRY")

    # Zamanlama
    start_year = Column(Integer, nullable=False)
    start_month = Column(Integer, nullable=False)
    duration_months = Column(Integer, nullable=True)
    end_year = Column(Integer, nullable=True)
    end_month = Column(Integer, nullable=True)

    # Ödeme & Nakit
    payment_term = Column(String, nullable=False, default="monthly")  # 'monthly' | 'annual_prepaid' | 'one_time'
    cash_out_month_policy = Column(String, nullable=False, default="service_month")  # 'service_month' | 'start_month' | 'contract_anniversary'

    # Endeks / Artış
    escalation_pct = Column(Numeric(8, 4), nullable=False, default=0)
    escalation_freq = Column(String, nullable=False, default="none")  # 'annual' | 'none'

    # Vergi
    tax_rate = Column(Numeric(8, 4), nullable=False, default=0)
    expense_includes_tax = Column(Boolean, nullable=False, default=False, server_default="0")

    # Diğer
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="1")

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    scenario = relationship("Scenario", back_populates="services", lazy="selectin")
    months = relationship("ScenarioServiceMonth", back_populates="service", cascade="all, delete-orphan", lazy="selectin")

    __table_args__ = (
        CheckConstraint("payment_term IN ('monthly','annual_prepaid','one_time')", name="ck_services_payment_term"),
        CheckConstraint(
            "cash_out_month_policy IN ('service_month','start_month','contract_anniversary')",
            name="ck_services_cash_out_policy",
        ),
        CheckConstraint("escalation_freq IN ('annual','none')", name="ck_services_escalation_freq"),
        Index("ix_services_scenario", "scenario_id"),
        Index("ix_services_active", "is_active"),
    )


class ScenarioServiceMonth(Base):
    __tablename__ = "scenario_service_month"

    id = Column(Integer, primary_key=True, index=True)
    service_id = Column(Integer, ForeignKey("scenario_services.id", ondelete="CASCADE"), nullable=False)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)
    expense_amount = Column(Numeric(18, 2), nullable=False, default=0)
    cash_out = Column(Numeric(18, 2), nullable=False, default=0)
    tax_amount = Column(Numeric(18, 2), nullable=False, default=0)

    service = relationship("ScenarioService", back_populates="months", lazy="selectin")

    __table_args__ = (
        UniqueConstraint("service_id", "year", "month", name="uix_service_month_unique"),
        Index("ix_service_month_sid", "service_id"),
        Index("ix_service_month_ym", "year", "month"),
    )


# =========================
# NEW: Scenario FX Rates
# =========================
class ScenarioFXRate(Base):
    __tablename__ = "scenario_fx_rates"

    id = Column(Integer, primary_key=True, index=True)
    scenario_id = Column(Integer, ForeignKey("scenarios.id", ondelete="CASCADE"), nullable=False)

    currency = Column(String(3), nullable=False)  # ISO-4217, örn: USD, EUR
    rate_to_base = Column(Numeric(18, 6), nullable=False, default=1)  # Base currency’e oran

    start_year = Column(Integer, nullable=False)
    start_month = Column(Integer, nullable=False)  # 1..12
    end_year = Column(Integer, nullable=True)
    end_month = Column(Integer, nullable=True)

    source = Column(String(50), nullable=True)  # manual | cbrt | ecb | oanda ...
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="1")

    scenario = relationship("Scenario", lazy="selectin")

    __table_args__ = (
        CheckConstraint("start_month >= 1 AND start_month <= 12", name="ck_fx_start_month"),
        CheckConstraint("(end_month IS NULL) OR (end_month >= 1 AND end_month <= 12)", name="ck_fx_end_month"),
        UniqueConstraint("scenario_id", "currency", "start_year", "start_month", name="uix_fx_period_unique"),
        Index("ix_fx_scenario", "scenario_id"),
        Index("ix_fx_currency", "currency"),
    )


# =========================
# NEW: Scenario Tax Rules
# =========================
class ScenarioTaxRule(Base):
    __tablename__ = "scenario_tax_rules"

    id = Column(Integer, primary_key=True, index=True)
    scenario_id = Column(Integer, ForeignKey("scenarios.id", ondelete="CASCADE"), nullable=False)

    name = Column(String(100), nullable=False)  # örn: KDV, Stopaj, Kurumlar Vergisi
    tax_type = Column(String(20), nullable=False, default="custom")  # vat|withholding|corp|custom
    applies_to = Column(String(20), nullable=False, default="all")   # revenue|services|capex|profit|all

    rate_pct = Column(Numeric(8, 4), nullable=False, default=0)  # yüzde
    start_year = Column(Integer, nullable=False)
    start_month = Column(Integer, nullable=False)
    end_year = Column(Integer, nullable=True)
    end_month = Column(Integer, nullable=True)

    is_inclusive = Column(Boolean, nullable=False, default=False, server_default="0")  # fiyatlara dahil mi
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="1")

    # ← back_populates ile Scenario.taxes’e bağladık
    scenario = relationship("Scenario", back_populates="taxes", lazy="selectin")

    __table_args__ = (
        CheckConstraint("tax_type IN ('vat','withholding','corp','custom')", name="ck_tax_type"),
        CheckConstraint("applies_to IN ('revenue','services','capex','profit','all')", name="ck_tax_applies_to"),
        CheckConstraint("start_month >= 1 AND start_month <= 12", name="ck_tax_start_month"),
        CheckConstraint("(end_month IS NULL) OR (end_month >= 1 AND end_month <= 12)", name="ck_tax_end_month"),
        Index("ix_tax_scenario", "scenario_id"),
        Index("ix_tax_active", "is_active"),
    )


# =========================
# Create all (idempotent)
# =========================
Base.metadata.create_all(bind=engine)
