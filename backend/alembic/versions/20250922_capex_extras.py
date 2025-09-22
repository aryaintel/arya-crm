"""add capex depreciation fields (method, salvage, partial policy)

Revision ID: 20250922_capex_extras
Revises: REPLACE_WITH_PREV_REVISION
Create Date: 2025-09-22 12:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20250922_capex_extras"
down_revision: Union[str, Sequence[str], None] = "REPLACE_WITH_PREV_REVISION"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("scenario_capex") as batch:
        batch.add_column(sa.Column("depreciation_method", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("salvage_value", sa.Float(), nullable=True))
        batch.add_column(sa.Column("partial_month_policy", sa.String(length=32), nullable=True))
    # TWC tarafında ek kolon yok; overhead tablosunda tutuluyor.


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("scenario_capex") as batch:
        batch.drop_column("partial_month_policy")
        batch.drop_column("salvage_value")
        batch.drop_column("depreciation_method")
