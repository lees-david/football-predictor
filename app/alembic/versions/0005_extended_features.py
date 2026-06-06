"""
0005_extended_features.py

Revision ID: 0005
Down revision: 0004
Create Date: 2026-05-29

Adds `can_manage_tournaments` to users (default false), changes default of
`can_invite_users` to true, adds `logo_url` to leagues (nullable), and creates
the `settings` table with seeded key `site_address` = `'worldcup.leeshomeserver.com'`.
"""
from alembic import op
import sqlalchemy as sa

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create settings table
    op.create_table(
        'settings',
        sa.Column('key', sa.String(length=100), nullable=False),
        sa.Column('value', sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint('key')
    )
    
    # Seed default site_address
    op.execute(
        "INSERT INTO settings (key, value) VALUES ('site_address', 'worldcup.leeshomeserver.com')"
    )
    
    # 1b. Add api_league_id and api_season to tournaments
    op.add_column(
        'tournaments',
        sa.Column('api_league_id', sa.Integer(), nullable=True)
    )
    op.add_column(
        'tournaments',
        sa.Column('api_season', sa.Integer(), nullable=True)
    )
    
    # Seed default tournament (ID=1) with league=1, season=2026
    op.execute(
        "UPDATE tournaments SET api_league_id = 1, api_season = 2026 WHERE id = 1"
    )
    
    # 2. Add can_manage_tournaments to users
    op.add_column(
        'users',
        sa.Column('can_manage_tournaments', sa.Boolean(), server_default='false', nullable=False)
    )
    
    # 3. Change default of can_invite_users on users table to true
    op.alter_column(
        'users',
        'can_invite_users',
        server_default='true'
    )
    
    # Update existing users to have can_invite_users set to True (since that's the new default)
    op.execute(
        "UPDATE users SET can_invite_users = true WHERE can_invite_users IS NULL OR role = 'player'"
    )
    
    # 4. Add logo_url to leagues
    op.add_column(
        'leagues',
        sa.Column('logo_url', sa.String(length=255), nullable=True)
    )


def downgrade() -> None:
    # 1. Drop logo_url from leagues
    op.drop_column('leagues', 'logo_url')
    
    # Drop api columns from tournaments
    op.drop_column('tournaments', 'api_season')
    op.drop_column('tournaments', 'api_league_id')
    
    # 2. Revert can_invite_users default
    op.alter_column(
        'users',
        'can_invite_users',
        server_default='false'
    )
    
    # 3. Drop can_manage_tournaments from users
    op.drop_column('users', 'can_manage_tournaments')
    
    # 4. Drop settings table
    op.drop_table('settings')
