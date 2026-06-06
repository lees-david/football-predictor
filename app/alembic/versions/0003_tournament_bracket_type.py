"""tournament bracket type

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-29 17:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0003'
down_revision: Union[str, None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # 1. Add has_bracket column with default False
    op.execute("ALTER TABLE tournaments ADD COLUMN has_bracket BOOLEAN NOT NULL DEFAULT FALSE;")
    
    # 2. Update default tournament (World Cup 2026) to have bracket enabled
    op.execute("UPDATE tournaments SET has_bracket = TRUE WHERE id = 1;")

def downgrade() -> None:
    op.execute("ALTER TABLE tournaments DROP COLUMN has_bracket;")
