"""node_status

Revision ID: 7936df950d8e
Revises: cb05020e9192
Create Date: 2026-11-08 20:27:30.709861

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7936df950d8e'
down_revision = 'cb05020e9192'
branch_labels = None
depends_on = None


_STATUS = "UPPER(CAST(status AS VARCHAR(20)))"


def upgrade():
    with op.batch_alter_table('nodes') as batch_op:
        batch_op.add_column(sa.Column('description_status', sa.String(20), nullable=False, server_default='draft'))
        batch_op.add_column(sa.Column('portal_published', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('portal_published_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('access_status', sa.String(20), nullable=False, server_default='open'))
        batch_op.add_column(sa.Column('access_basis', sa.String(300), nullable=True))
        batch_op.add_column(sa.Column('access_restricted_until', sa.Date(), nullable=True))

    op.execute(
        f"UPDATE nodes SET description_status = 'final', portal_published = TRUE, "
        f"portal_published_at = updated_at WHERE {_STATUS} = 'PUBLISHED'"
    )
    op.execute(
        f"UPDATE nodes SET description_status = 'final', access_status = 'restricted' "
        f"WHERE {_STATUS} = 'RESTRICTED'"
    )

    with op.batch_alter_table('nodes') as batch_op:
        batch_op.drop_column('status')

    if op.get_bind().dialect.name == 'postgresql':
        op.execute('DROP TYPE IF EXISTS nodestatus')


def downgrade():
    status_enum = sa.Enum('DRAFT', 'PUBLISHED', 'RESTRICTED', name='nodestatus')
    status_enum.create(op.get_bind(), checkfirst=True)
    with op.batch_alter_table('nodes') as batch_op:
        batch_op.add_column(sa.Column('status', status_enum, nullable=False, server_default='DRAFT'))

    op.execute("UPDATE nodes SET status = 'RESTRICTED' WHERE access_status <> 'open'")
    op.execute("UPDATE nodes SET status = 'PUBLISHED' WHERE portal_published = TRUE")

    with op.batch_alter_table('nodes') as batch_op:
        batch_op.drop_column('access_restricted_until')
        batch_op.drop_column('access_basis')
        batch_op.drop_column('access_status')
        batch_op.drop_column('portal_published_at')
        batch_op.drop_column('portal_published')
        batch_op.drop_column('description_status')