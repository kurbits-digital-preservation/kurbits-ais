"""natural sort key and manual child order

Revision ID: 7c2e9a41d5b3
Revises: 44554b9c4656
Create Date: 2026-10-22 18:00:00.000000

"""
import re

from alembic import op
import sqlalchemy as sa


revision = '7c2e9a41d5b3'
down_revision = '44554b9c4656'
branch_labels = None
depends_on = None

_DIGITS = re.compile(r'(\d+)', re.ASCII)
_PAD = 12
_BATCH = 2000


def _natural_sort_key(value):
    if not value:
        return ''
    parts = _DIGITS.split(value.strip().lower())
    return ''.join(p.zfill(_PAD) if i % 2 else p for i, p in enumerate(parts))


def upgrade():
    bind = op.get_bind()
    is_pg = bind.dialect.name == 'postgresql'

    with op.batch_alter_table('nodes') as batch_op:
        batch_op.add_column(sa.Column('local_ref_sort', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('sort_order', sa.Integer(), nullable=True))

    if is_pg:
        op.execute('ALTER TABLE nodes DISABLE TRIGGER nodes_search_vector_trg')

    nodes = sa.table(
        'nodes',
        sa.column('id', sa.Integer),
        sa.column('local_ref', sa.String),
        sa.column('local_ref_sort', sa.Text),
    )
    rows = bind.execute(sa.select(nodes.c.id, nodes.c.local_ref)).all()
    stmt = (
        nodes.update()
        .where(nodes.c.id == sa.bindparam('_id'))
        .values(local_ref_sort=sa.bindparam('_sort'))
    )
    for start in range(0, len(rows), _BATCH):
        chunk = rows[start:start + _BATCH]
        bind.execute(stmt, [{'_id': r.id, '_sort': _natural_sort_key(r.local_ref)} for r in chunk])

    if is_pg:
        op.execute('ALTER TABLE nodes ENABLE TRIGGER nodes_search_vector_trg')

    with op.batch_alter_table('nodes') as batch_op:
        batch_op.alter_column('local_ref_sort', existing_type=sa.Text(), nullable=False)

    op.drop_index('ix_nodes_parent_local_ref', table_name='nodes', if_exists=True)
    op.create_index('ix_nodes_parent_sort', 'nodes', ['parent_id', 'sort_order', 'local_ref_sort'])


def downgrade():
    op.drop_index('ix_nodes_parent_sort', table_name='nodes', if_exists=True)
    op.create_index('ix_nodes_parent_local_ref', 'nodes', ['parent_id', 'local_ref'])

    with op.batch_alter_table('nodes') as batch_op:
        batch_op.drop_column('sort_order')
        batch_op.drop_column('local_ref_sort')