"""include notes in search vectors

Revision ID: a1e7c3d95b42
Revises: 9d4b1f2a6c80
Create Date: 2026-10-23 14:00:00.000000

"""
from alembic import op


revision = 'a1e7c3d95b42'
down_revision = '9d4b1f2a6c80'
branch_labels = None
depends_on = None

NOTE_TEXT_LIMIT = 100000

NODES_FUNCTION_WITH_NOTES = f"""
CREATE OR REPLACE FUNCTION nodes_search_vector_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    attachment_text text;
    note_text text;
BEGIN
    SELECT left(string_agg(na.extracted_text, ' '), 100000)
      INTO attachment_text
      FROM node_attachments na
      JOIN institutions i ON i.id = NEW.institution_id
     WHERE na.node_id = NEW.id
       AND na.extracted_text IS NOT NULL
       AND lower(coalesce(i.settings ->> 'index_attachment_text', 'false')) IN ('true', '1', 'yes', 'on');

    SELECT left(string_agg(nn.content, ' '), {NOTE_TEXT_LIMIT})
      INTO note_text
      FROM node_notes nn
     WHERE nn.node_id = NEW.id;

    NEW.search_vector :=
        setweight(kurbits_tsv(NEW.title), 'A') ||
        setweight(to_tsvector('simple', coalesce(NEW.ref_code, '')), 'A') ||
        setweight(kurbits_tsv(NEW.description), 'B') ||
        setweight(kurbits_tsv(NEW.scope_and_content), 'B') ||
        setweight(kurbits_tsv(NEW.arrangement), 'C') ||
        setweight(kurbits_tsv(NEW.metadata_spec::text), 'C') ||
        setweight(kurbits_tsv(note_text), 'C') ||
        setweight(kurbits_tsv(attachment_text), 'D');
    RETURN NEW;
END
$$
"""

NODES_FUNCTION_ORIGINAL = """
CREATE OR REPLACE FUNCTION nodes_search_vector_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    attachment_text text;
BEGIN
    SELECT left(string_agg(na.extracted_text, ' '), 100000)
      INTO attachment_text
      FROM node_attachments na
      JOIN institutions i ON i.id = NEW.institution_id
     WHERE na.node_id = NEW.id
       AND na.extracted_text IS NOT NULL
       AND lower(coalesce(i.settings ->> 'index_attachment_text', 'false')) IN ('true', '1', 'yes', 'on');

    NEW.search_vector :=
        setweight(kurbits_tsv(NEW.title), 'A') ||
        setweight(to_tsvector('simple', coalesce(NEW.ref_code, '')), 'A') ||
        setweight(kurbits_tsv(NEW.description), 'B') ||
        setweight(kurbits_tsv(NEW.scope_and_content), 'B') ||
        setweight(kurbits_tsv(NEW.arrangement), 'C') ||
        setweight(kurbits_tsv(NEW.metadata_spec::text), 'C') ||
        setweight(kurbits_tsv(attachment_text), 'D');
    RETURN NEW;
END
$$
"""

AGENTS_FUNCTION_WITH_NOTES = f"""
CREATE OR REPLACE FUNCTION agents_search_vector_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    ident_text text;
    name_form_text text;
    note_text text;
BEGIN
    SELECT string_agg(ai.value, ' ')
      INTO ident_text
      FROM agent_identifiers ai
     WHERE ai.agent_id = NEW.id;

    SELECT string_agg(nf.name, ' ')
      INTO name_form_text
      FROM agent_name_forms nf
     WHERE nf.agent_id = NEW.id;

    SELECT left(string_agg(an.content, ' '), {NOTE_TEXT_LIMIT})
      INTO note_text
      FROM agent_notes an
     WHERE an.agent_id = NEW.id;

    NEW.search_vector :=
        setweight(kurbits_tsv(NEW.name), 'A') ||
        setweight(kurbits_tsv(NEW.authorized_form), 'A') ||
        setweight(kurbits_tsv(name_form_text), 'A') ||
        setweight(to_tsvector('simple', coalesce(name_form_text, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(ident_text, '')), 'B') ||
        setweight(kurbits_tsv(NEW.description), 'C') ||
        setweight(kurbits_tsv(note_text), 'C');
    RETURN NEW;
END
$$
"""

AGENTS_FUNCTION_PREVIOUS = """
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

NODE_NOTES_TOUCH_FUNCTION = """
CREATE OR REPLACE FUNCTION node_notes_touch_node() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        UPDATE nodes SET search_vector = NULL WHERE id = OLD.node_id;
    END IF;
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.node_id IS DISTINCT FROM OLD.node_id) THEN
        UPDATE nodes SET search_vector = NULL WHERE id = NEW.node_id;
    END IF;
    RETURN NULL;
END
$$
"""

NODE_NOTES_TOUCH_TRIGGER = """
CREATE TRIGGER node_notes_search_trg
AFTER INSERT OR DELETE OR UPDATE OF content, node_id ON node_notes
FOR EACH ROW EXECUTE FUNCTION node_notes_touch_node()
"""

AGENT_NOTES_TOUCH_FUNCTION = """
CREATE OR REPLACE FUNCTION agent_notes_touch_agent() RETURNS trigger
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

AGENT_NOTES_TOUCH_TRIGGER = """
CREATE TRIGGER agent_notes_search_trg
AFTER INSERT OR DELETE OR UPDATE OF content, agent_id ON agent_notes
FOR EACH ROW EXECUTE FUNCTION agent_notes_touch_agent()
"""


def upgrade():
    if op.get_bind().dialect.name != 'postgresql':
        return

    op.execute(NODES_FUNCTION_WITH_NOTES)
    op.execute(AGENTS_FUNCTION_WITH_NOTES)

    op.execute(NODE_NOTES_TOUCH_FUNCTION)
    op.execute('DROP TRIGGER IF EXISTS node_notes_search_trg ON node_notes')
    op.execute(NODE_NOTES_TOUCH_TRIGGER)

    op.execute(AGENT_NOTES_TOUCH_FUNCTION)
    op.execute('DROP TRIGGER IF EXISTS agent_notes_search_trg ON agent_notes')
    op.execute(AGENT_NOTES_TOUCH_TRIGGER)

    op.execute(
        'UPDATE nodes SET search_vector = NULL '
        'WHERE id IN (SELECT DISTINCT node_id FROM node_notes)'
    )
    op.execute(
        'UPDATE agents SET search_vector = NULL '
        'WHERE id IN (SELECT DISTINCT agent_id FROM agent_notes)'
    )


def downgrade():
    if op.get_bind().dialect.name != 'postgresql':
        return

    op.execute('DROP TRIGGER IF EXISTS agent_notes_search_trg ON agent_notes')
    op.execute('DROP FUNCTION IF EXISTS agent_notes_touch_agent()')
    op.execute('DROP TRIGGER IF EXISTS node_notes_search_trg ON node_notes')
    op.execute('DROP FUNCTION IF EXISTS node_notes_touch_node()')

    op.execute(NODES_FUNCTION_ORIGINAL)
    op.execute(AGENTS_FUNCTION_PREVIOUS)

    op.execute(
        'UPDATE nodes SET search_vector = NULL '
        'WHERE id IN (SELECT DISTINCT node_id FROM node_notes)'
    )
    op.execute(
        'UPDATE agents SET search_vector = NULL '
        'WHERE id IN (SELECT DISTINCT agent_id FROM agent_notes)'
    )
