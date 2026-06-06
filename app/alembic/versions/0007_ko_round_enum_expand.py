"""
0007_ko_round_enum_expand.py

Revision ID: 0007
Down revision: 0006
Create Date: 2026-05-30

Adds 'round_32' and 'third_place' values to the ko_round postgres enum,
allowing bracket KO picks for the Round of 32 and the 3rd-place playoff.
"""
from alembic import op

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL requires ALTER TYPE ... ADD VALUE outside of a transaction
    # for enum changes.  Alembic wraps migrations in BEGIN/COMMIT by default,
    # so we explicitly commit before issuing the ALTER TYPE statements.
    op.execute("COMMIT")
    op.execute("ALTER TYPE ko_round ADD VALUE IF NOT EXISTS 'round_32'")
    op.execute("ALTER TYPE ko_round ADD VALUE IF NOT EXISTS 'third_place'")
    op.execute("BEGIN")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values — downgrade is a no-op.
    pass
