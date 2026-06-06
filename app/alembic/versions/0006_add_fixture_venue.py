"""
0006_add_fixture_venue.py

Revision ID: 0006
Down revision: 0005
Create Date: 2026-05-30

Adds the `venue` column to the `fixtures` table to store stadium and location details.
"""
from alembic import op
import sqlalchemy as sa

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('fixtures', sa.Column('venue', sa.String(length=150), nullable=True))


def downgrade() -> None:
    op.drop_column('fixtures', 'venue')
