"""search scopes: separate attachment vector and one text kind per weight

Revision ID: c3a8e6f1d204
Revises: a1e7c3d95b42
Create Date: 2026-10-23 16:00:00.000000

Weights after this revision:
  nodes   A title, ref code · B descriptive fields · C notes · D attachment text (when enabled)
  agents  A names, name forms · B identifiers, description · C notes
nodes.attachment_vector always holds the attachment text, whatever the
institution's index_attachment_text setting says.
"""
from alembic import op


revision = 'c3a8e6f1d204'
down_revision = 'a1e7c3d95b42'
branch_labels = None
depends_on = None

TEXT_LIMIT = 100000

NODES_FUNCTION_SCOPED = f"""
CREATE OR REPLACE FUNCTION nodes_search_vector_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    attachment_text text;
    note_text text;
    include_attachments boolean;
BEGIN
    SELECT left(string_agg(na.extracted_text, ' '), {TEXT_LIMIT})
      INTO attachment_text
      FROM node_attachments na
     WHERE na.node_id = NEW.id
       AND na.extracted_text IS NOT NULL;

    SELECT left(string_agg(nn.content, ' '), {TEXT_LIMIT})
      INTO note_text
      FROM node_notes nn
     WHERE nn.node_id = NEW.id;

    SELECT lower(coalesce(i.settings ->> 'index_attachment_text', 'false')) IN ('true', '1', 'yes', 'on')
      INTO include_attachments
      FROM institutions i
     WHERE i.id = NEW.institution_id;

    NEW.attachment_vector := kurbits_tsv(attachment_text);

    NEW.search_vector :=
        setweight(kurbits_tsv(NEW.title), 'A') ||
        setweight(to_tsvector('simple', coalesce(NEW.ref_code, '')), 'A') ||
        setweight(kurbits_tsv(NEW.description), 'B') ||
        setweight(kurbits_tsv(NEW.scope_and_content), 'B') ||
        setweight(kurbits_tsv(NEW.arrangement), 'B') ||
        setweight(kurbits_tsv(NEW.metadata_spec::text), 'B') ||
        setweight(kurbits_tsv(note_text), 'C') ||
        CASE WHEN coalesce(include_attachments, false)
             THEN setweight(NEW.attachment_vector, 'D')
             ELSE ''::tsvector
        END;
    RETURN NEW;
END
$$
"""

AGENTS_FUNCTION_SCOPED = f"""
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

    SELECT left(string_agg(an.content, ' '), {TEXT_LIMIT})
      INTO note_text
      FROM agent_notes an
     WHERE an.agent_id = NEW.id;

    NEW.search_vector :=
        setweight(kurbits_tsv(NEW.name), 'A') ||
        setweight(kurbits_tsv(NEW.authorized_form), 'A') ||
        setweight(kurbits_tsv(name_form_text), 'A') ||
        setweight(to_tsvector('simple', coalesce(name_form_text, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(ident_text, '')), 'B') ||
        setweight(kurbits_tsv(NEW.description), 'B') ||
        setweight(kurbits_tsv(note_text), 'C');
    RETURN NEW;
END
$$
"""

NODES_FUNCTION_PREVIOUS = f"""
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

    SELECT left(string_agg(nn.content, ' '), {TEXT_LIMIT})
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

AGENTS_FUNCTION_PREVIOUS = f"""
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

    SELECT left(string_agg(an.content, ' '), {TEXT_LIMIT})
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


def upgrade():
    if op.get_bind().dialect.name != 'postgresql':
        return

    op.execute('ALTER TABLE nodes ADD COLUMN IF NOT EXISTS attachment_vector tsvector')
    op.execute(
        'CREATE INDEX IF NOT EXISTS ix_nodes_attachment_vector '
        'ON nodes USING gin (attachment_vector)'
    )

    op.execute(NODES_FUNCTION_SCOPED)
    op.execute(AGENTS_FUNCTION_SCOPED)

    op.execute('UPDATE nodes SET search_vector = NULL')
    op.execute('UPDATE agents SET search_vector = NULL')


def downgrade():
    if op.get_bind().dialect.name != 'postgresql':
        return

    op.execute(NODES_FUNCTION_PREVIOUS)
    op.execute(AGENTS_FUNCTION_PREVIOUS)

    op.execute('DROP INDEX IF EXISTS ix_nodes_attachment_vector')
    op.execute('ALTER TABLE nodes DROP COLUMN IF EXISTS attachment_vector')

    op.execute('UPDATE nodes SET search_vector = NULL')
    op.execute('UPDATE agents SET search_vector = NULL')
