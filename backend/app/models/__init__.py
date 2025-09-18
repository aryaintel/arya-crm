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
    func,
    Numeric,
    Boolean,
    Enum,  # BOQ category enum
)
from sqlalchemy.orm import declarative_base, relationship
from ..core.config import engine

# SQLAlchemy Base
Base = declarative_base()


# --------- Core Tables ---------
class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String, unique=True, nullable=False)   # arya, demo vs.
    name = Column(String, nullable=False)                # Arya Demo, Şirket Adı vs.


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)

    email = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)

    # Basit rol modeli: kullanıcı üzerinde rol adı tutuluyor (admin, sales, vs.)
    role_name = Column(String, nullable=False, default="user")

    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        # Aynı tenant içinde e-posta tekil olsun
        UniqueConstraint("tenant_id", "email", name="uix_user_tenant_email"),
    )


class Role(Base):
    """
    İsteğe bağlı rol tablosu (permissions string'i virgül ile ayrılmış listedir)
    Örn: "accounts:read,accounts:write,contacts:read"
    Admin için ayrıca '*' verilerek her şeye izin tanımlanabilir.
    """
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)

    name = Column(String, nullable=False)        # admin, sales, support ...
    permissions = Column(Text, nullable=True)    # "accounts:read,accounts:write,*" gibi

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uix_role_tenant_name"),
    )


# --------- Business Tables: Accounts / Contacts ---------
class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)

    name = Column(String, nullable=False)
    industry = Column(String, nullable=True)
    type = Column(String, nullable=True)
    website = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    billing_address = Column(Text, nullable=True)
    shipping_address = Column(Text, nullable=True)

    # --- Yeni (Salesforce benzeri) alanlar ---
    account_number = Column(String(50), nullable=True)
    employees = Column(Integer, nullable=True)
    annual_revenue = Column(Integer, nullable=True)
    rating = Column(String(20), nullable=True)        # Hot | Warm | Cold
    ownership = Column(String(20), nullable=True)     # Public | Private | Other
    description = Column(Text, nullable=True)

    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    created_at = Column(DateTime, server_default=func.now())

    # relationships (isteğe bağlı)
    owner = relationship("User", lazy="selectin")


class Contact(Base):
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)

    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    owner_id   = Column(Integer, ForeignKey("users.id"), nullable=False)

    name  = Column(String, nullable=False)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    title = Column(String, nullable=True)
    notes = Column(Text,   nullable=True)

    created_at = Column(DateTime, server_default=func.now())

    # relationships (isteğe bağlı)
    account = relationship("Account", lazy="selectin")
    owner   = relationship("User", lazy="selectin")


# --------- NEW: Leads ---------
class Lead(Base):
    """
    Basit Lead modeli (Salesforce yaklaşımı):
      - henüz Account/Contact/Opportunity'ye dönüşmemiş adaylar
      - Convert sonrası referans id’leri saklanır (soft link)
    """
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    owner_id  = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Kim bu lead?
    name   = Column(String, nullable=False)       # kişi adı veya temas adı
    company = Column(String, nullable=True)
    email  = Column(String, nullable=True)
    phone  = Column(String, nullable=True)
    title  = Column(String, nullable=True)

    # Satış nitelikleri
    status = Column(String, nullable=True)        # New, Working, Nurturing, Unqualified, Converted
    source = Column(String, nullable=True)        # Referral, Web, Event...
    rating = Column(String, nullable=True)        # Hot, Warm, Cold
    notes  = Column(Text,   nullable=True)

    # Convert meta
    converted_account_id     = Column(Integer, ForeignKey("accounts.id"), nullable=True)
    converted_opportunity_id = Column(Integer, ForeignKey("opportunities.id"), nullable=True)
    converted_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # ilişkiler
    owner = relationship("User", lazy="selectin")
    converted_account = relationship("Account", lazy="selectin", foreign_keys=[converted_account_id])
    converted_opportunity = relationship("Opportunity", lazy="selectin", foreign_keys=[converted_opportunity_id])


# --------- Business Tables: Deals (Pipeline / Stage / Opportunity) ---------
class Pipeline(Base):
    __tablename__ = "pipelines"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class Stage(Base):
    __tablename__ = "stages"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    pipeline_id = Column(Integer, ForeignKey("pipelines.id"), nullable=False)

    name = Column(String, nullable=False)
    # Uygulama tarafında kullanılan isim 'order_index' olduğu için bu kolon adı seçildi
    order_index = Column(Integer, nullable=False, default=1)
    win_probability = Column(Integer, nullable=True)

    created_at = Column(DateTime, server_default=func.now())


class Opportunity(Base):
    __tablename__ = "opportunities"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    name = Column(String, nullable=False)
    amount = Column(Integer, nullable=True)
    currency = Column(String, nullable=True)

    stage_id = Column(Integer, ForeignKey("stages.id"), nullable=False)

    expected_close_date = Column(Date, nullable=True)
    source = Column(String, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # (isteğe bağlı) ilişkiler:
    account = relationship("Account", lazy="selectin")
    owner   = relationship("User", lazy="selectin")

    # 1:1 ilişki (BusinessCase tarafında UNIQUE kısıtı var)
    business_case = relationship("BusinessCase", uselist=False, back_populates="opportunity", lazy="selectin")


# --------- NEW: Business Case / Scenario Modelleme ---------
class BusinessCase(Base):
    __tablename__ = "business_cases"

    id = Column(Integer, primary_key=True, index=True)
    opportunity_id = Column(Integer, ForeignKey("opportunities.id"), nullable=False)
    name = Column(String(255), nullable=False)

    # ilişkiler
    opportunity = relationship("Opportunity", back_populates="business_case", lazy="selectin")
    scenarios = relationship(
        "Scenario", back_populates="business_case",
        cascade="all, delete-orphan", lazy="selectin"
    )


class Scenario(Base):
    __tablename__ = "scenarios"

    id = Column(Integer, primary_key=True, index=True)
    business_case_id = Column(Integer, ForeignKey("business_cases.id"), nullable=False)
    name = Column(String(255), nullable=False)
    months = Column(Integer, nullable=False, default=36)
    start_date = Column(Date, nullable=False)

    # --- WORKFLOW (Excel sırası: BOQ -> TWC -> CAPEX -> P&L) ---
    is_boq_ready   = Column(Boolean, nullable=False, default=False)
    is_twc_ready   = Column(Boolean, nullable=False, default=False)
    is_capex_ready = Column(Boolean, nullable=False, default=False)
    workflow_state = Column(String, nullable=False, default="draft")  # 'draft'|'boq'|'twc'|'capex'|'ready'

    # ilişkiler
    business_case = relationship("BusinessCase", back_populates="scenarios", lazy="selectin")
    products = relationship(
        "ScenarioProduct", back_populates="scenario",
        cascade="all, delete-orphan", lazy="selectin"
    )
    overheads = relationship(
        "ScenarioOverhead", back_populates="scenario",
        cascade="all, delete-orphan", lazy="selectin"
    )
    # NEW: BOQ items
    boq_items = relationship(
        "ScenarioBOQItem", back_populates="scenario",
        cascade="all, delete-orphan", lazy="selectin"
    )


class ScenarioProduct(Base):
    __tablename__ = "scenario_products"

    id = Column(Integer, primary_key=True, index=True)
    scenario_id = Column(Integer, ForeignKey("scenarios.id"), nullable=False)
    name = Column(String(255), nullable=False)
    price = Column(Numeric(18, 4), nullable=False, default=0)
    unit_cogs = Column(Numeric(18, 4), nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)

    # ilişkiler
    scenario = relationship("Scenario", back_populates="products", lazy="selectin")
    months = relationship(
        "ScenarioProductMonth", back_populates="product",
        cascade="all, delete-orphan", lazy="selectin"
    )


class ScenarioProductMonth(Base):
    __tablename__ = "scenario_product_months"

    id = Column(Integer, primary_key=True, index=True)
    scenario_product_id = Column(Integer, ForeignKey("scenario_products.id"), nullable=False)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)  # 1..12
    quantity = Column(Numeric(18, 4), nullable=False, default=0)

    # ilişkiler
    product = relationship("ScenarioProduct", back_populates="months", lazy="selectin")


class ScenarioOverhead(Base):
    __tablename__ = "scenario_overheads"

    id = Column(Integer, primary_key=True, index=True)
    scenario_id = Column(Integer, ForeignKey("scenarios.id"), nullable=False)
    name = Column(String(255), nullable=False)
    type = Column(String(20), nullable=False)          # 'fixed' | '%_revenue'
    amount = Column(Numeric(18, 4), nullable=False, default=0)

    # ilişkiler
    scenario = relationship("Scenario", back_populates="overheads", lazy="selectin")


# --------- NEW: CAPEX (scenario_capex) ---------
class ScenarioCapex(Base):
    __tablename__ = "scenario_capex"

    id = Column(Integer, primary_key=True, index=True)
    scenario_id = Column(Integer, ForeignKey("scenarios.id"), nullable=False)

    # Zaman & tutar
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)  # 1..12
    amount = Column(Numeric(18, 2), nullable=False, default=0)
    notes = Column(Text, nullable=True)

    # V2 alanları
    asset_name = Column(String, nullable=True)
    category = Column(String, nullable=True)
    service_start_year = Column(Integer, nullable=True)
    service_start_month = Column(Integer, nullable=True)
    useful_life_months = Column(Integer, nullable=True)
    depr_method = Column(String, nullable=True, default="straight_line")
    salvage_value = Column(Numeric(18, 2), nullable=True, default=0)
    is_active = Column(Boolean, nullable=True, default=True)

    # V3 ek alanlar
    disposal_year = Column(Integer, nullable=True)
    disposal_month = Column(Integer, nullable=True)
    disposal_proceeds = Column(Numeric(18, 2), nullable=True, default=0)
    replace_at_end = Column(Boolean, nullable=True, default=False)
    per_unit_cost = Column(Numeric(18, 2), nullable=True)
    quantity = Column(Integer, nullable=True)
    contingency_pct = Column(Numeric(5, 2), nullable=True, default=0)
    partial_month_policy = Column(String, nullable=True, default="full_month")

    # ilişkiler
    scenario = relationship("Scenario", backref="capex_items", lazy="selectin")


# --------- NEW: BOQ (Bill of Quantities) ---------
class ScenarioBOQItem(Base):
    __tablename__ = "scenario_boq_items"

    id = Column(Integer, primary_key=True, index=True)
    scenario_id = Column(Integer, ForeignKey("scenarios.id"), nullable=False)

    section = Column(String(50), nullable=True)          # örn. "AN", "EM"
    item_name = Column(String(255), nullable=False)
    unit = Column(String(50), nullable=False)            # ton, m3, adet...
    quantity = Column(Numeric(18, 4), nullable=False, default=0)
    unit_price = Column(Numeric(18, 4), nullable=False, default=0)
    unit_cogs = Column(Numeric(18, 4), nullable=True)    # opsiyonel

    frequency = Column(String(20), nullable=False, default="once")  # once|monthly|per_shipment|per_tonne
    start_year = Column(Integer, nullable=True)
    start_month = Column(Integer, nullable=True)         # 1..12
    months = Column(Integer, nullable=True)              # monthly ise kaç ay

    is_active = Column(Boolean, nullable=False, default=True)
    notes = Column(Text, nullable=True)

    # NEW: Category (ENUM)
    category = Column(
        Enum(
            "bulk_with_freight",
            "bulk_ex_freight",
            "freight",
            name="boq_category",
        ),
        nullable=True,
    )

    # ilişkiler
    scenario = relationship("Scenario", back_populates="boq_items", lazy="selectin")


# --------- Create Tables (if not exist) ---------
# Bu satır, uygulama ilk çalıştığında tabloları oluşturur (varsa dokunmaz).
Base.metadata.create_all(bind=engine)
