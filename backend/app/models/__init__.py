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

    # Varsayılanı "member" yapalım
    role_name = Column(String, nullable=False, default="member")

    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
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


# --------- Create Tables (if not exist) ---------
# Bu satır, uygulama ilk çalıştığında tabloları oluşturur (varsa dokunmaz).
Base.metadata.create_all(bind=engine)
