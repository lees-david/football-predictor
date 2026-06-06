"""cascade delete league_members and historical_rankings on league delete

Revision ID: 0013
Revises: 0012
Create Date: 2026-05-31
"""
import sqlalchemy as sa
from alembic import op

revision = '0013'
down_revision = '0012'
branch_labels = None
depends_on = None


def upgrade():
    # Drop existing FK constraints and re-create with ON DELETE CASCADE
    op.drop_constraint('league_members_league_id_fkey', 'league_members', type_='foreignkey')
    op.create_foreign_key(
        'league_members_league_id_fkey',
        'league_members', 'leagues',
        ['league_id'], ['id'],
        ondelete='CASCADE'
    )

    op.drop_constraint('historical_rankings_league_id_fkey', 'historical_rankings', type_='foreignkey')
    op.create_foreign_key(
        'historical_rankings_league_id_fkey',
        'historical_rankings', 'leagues',
        ['league_id'], ['id'],
        ondelete='CASCADE'
    )


def downgrade():
    op.drop_constraint('league_members_league_id_fkey', 'league_members', type_='foreignkey')
    op.create_foreign_key(
        'league_members_league_id_fkey',
        'league_members', 'leagues',
        ['league_id'], ['id']
    )

    op.drop_constraint('historical_rankings_league_id_fkey', 'historical_rankings', type_='foreignkey')
    op.create_foreign_key(
        'historical_rankings_league_id_fkey',
        'historical_rankings', 'leagues',
        ['league_id'], ['id']
    )
