"""agent name forms with type vocabulary

Revision ID: 9d4b1f2a6c80
Revises: 7c2e9a41d5b3
Create Date: 2026-10-23 10:00:00.000000

"""
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = '9d4b1f2a6c80'
down_revision = '7c2e9a41d5b3'
branch_labels = None
depends_on = None

DEFAULT_TYPES = {
    'en': [
        ('abbreviation', 'Abbreviated form of the name'),
        ('former name', 'Name used before the current one'),
        ('later name', 'Name used after this form'),
        ('parallel name', 'The name in another language or script'),
        ('variant form', 'Other variant of the name'),
    ],
    'sv': [
        ('förkortning', 'Förkortad form av namnet'),
        ('tidigare namn', 'Namn som användes före det nuvarande'),
        ('senare namn', 'Namn som användes efter denna form'),
        ('parallellnamn', 'Namnet på ett annat språk eller i en annan skrift'),
        ('variantform', 'Annan variant av namnet'),
    ],
}

SWEDISH_MARKER = 'är associerad med'

AGENT_TRIGGER_WITH_NAME_FORMS = """
CREATE OR REPLACE FUNCTION agents_search_vector_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    ident_text text;
    name_form_text text;
BEGIN
    SELECT string_agg(ai.value, ' ')
      INTO ident_text
      FROM agent_identifiers ai
     WHERE ai.agent_id = NEW.id;

    SELECT string_agg(nf.name, ' ')
      INTO name_form_text
      FROM agent_name_forms nf
     WHERE nf.agent_id = NEW.id;

    NEW.search_vector :=
        setweight(kurbits_tsv(NEW.name), 'A') ||
        setweight(kurbits_tsv(NEW.authorized_form), 'A') ||
        setweight(kurbits_tsv(name_form_text), 'A') ||
        setweight(to_tsvector('simple', coalesce(name_form_text, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(ident_text, '')), 'B') ||
        setweight(kurbits_tsv(NEW.description), 'C');
    RETURN NEW;
END
$$
"""

AGENT_TRIGGER_ORIGINAL = """
CREATE OR REPLACE FUNCTION agents_search_vector_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    ident_text text;
BEGIN
    SELECT string_agg(ai.value, ' ')
      INTO ident_text
      FROM agent_identifiers ai
     WHERE ai.agent_id = NEW.id;

    NEW.search_vector :=
        setweight(kurbits_tsv(NEW.name), 'A') ||
        setweight(kurbits_tsv(NEW.authorized_form), 'A') ||
        setweight(to_tsvector('simple', coalesce(ident_text, '')), 'B') ||
        setweight(kurbits_tsv(NEW.description), 'C');
    RETURN NEW;
END
$$
"""

NAME_FORM_TOUCH_FUNCTION = """
CREATE OR REPLACE FUNCTION agent_name_forms_touch_agent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        UPDATE agents SET search_vector = NULL WHERE id = OLD.agent_id;
    END IF;
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.agent_id IS DISTINCT FROM OLD.agent_id) THEN
        UPDATE agents SET search_vector = NULL WHERE id = NEW.agent_id;
    END IF;
    RETURN NULL;
END
$$
"""

NAME_FORM_TOUCH_TRIGGER = """
CREATE TRIGGER agent_name_forms_search_trg
AFTER INSERT OR DELETE OR UPDATE OF name, agent_id ON agent_name_forms
FOR EACH ROW EXECUTE FUNCTION agent_name_forms_touch_agent()
"""


def _seed_default_types(bind) -> None:
    institutions = bind.execute(sa.text('SELECT id FROM institutions')).scalars().all()
    now = datetime.now(timezone.utc)
    for institution_id in institutions:
        is_swedish = bind.execute(
            sa.text(
                'SELECT 1 FROM agent_relation_types '
                'WHERE institution_id = :iid AND name = :marker LIMIT 1'
            ),
            {'iid': institution_id, 'marker': SWEDISH_MARKER},
        ).first() is not None
        for name, description in DEFAULT_TYPES['sv' if is_swedish else 'en']:
            bind.execute(
                sa.text(
                    'INSERT INTO agent_name_form_types (institution_id, name, description, created_at) '
                    'VALUES (:iid, :name, :description, :created_at)'
                ),
                {'iid': institution_id, 'name': name, 'description': description, 'created_at': now},
            )


def upgrade():
    bind = op.get_bind()
    is_pg = bind.dialect.name == 'postgresql'

    op.create_table(
        'agent_name_form_types',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('institution_id', sa.Integer(),
                  sa.ForeignKey('institutions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('description', sa.String(300), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('institution_id', 'name', name='uq_agent_name_form_type_per_institution'),
    )

    op.create_table(
        'agent_name_forms',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('agent_id', sa.Integer(),
                  sa.ForeignKey('agents.id', ondelete='CASCADE'), nullable=False),
        sa.Column('type_id', sa.Integer(),
                  sa.ForeignKey('agent_name_form_types.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('name', sa.String(500), nullable=False),
        sa.Column('date_from', sa.String(50), nullable=True),
        sa.Column('date_to', sa.String(50), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('created_by_id', sa.Integer(),
                  sa.ForeignKey('users.id', name='fk_agent_name_form_created_by'), nullable=True),
    )
    op.create_index('ix_agent_name_forms_agent', 'agent_name_forms', ['agent_id'])
    op.create_index('ix_agent_name_forms_type', 'agent_name_forms', ['type_id'])

    _seed_default_types(bind)

    if is_pg:
        op.execute(AGENT_TRIGGER_WITH_NAME_FORMS)
        op.execute(NAME_FORM_TOUCH_FUNCTION)
        op.execute('DROP TRIGGER IF EXISTS agent_name_forms_search_trg ON agent_name_forms')
        op.execute(NAME_FORM_TOUCH_TRIGGER)
        op.execute('UPDATE agents SET search_vector = NULL')


def downgrade():
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.execute('DROP TRIGGER IF EXISTS agent_name_forms_search_trg ON agent_name_forms')
        op.execute('DROP FUNCTION IF EXISTS agent_name_forms_touch_agent()')
        op.execute(AGENT_TRIGGER_ORIGINAL)

    op.drop_index('ix_agent_name_forms_type', table_name='agent_name_forms')
    op.drop_index('ix_agent_name_forms_agent', table_name='agent_name_forms')
    op.drop_table('agent_name_forms')
    op.drop_table('agent_name_form_types')

    if bind.dialect.name == 'postgresql':
        op.execute('UPDATE agents SET search_vector = NULL')
