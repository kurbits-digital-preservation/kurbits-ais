"""search vectors

Revision ID: 44554b9c4656
Revises: 00c356ba4436
Create Date: 2026-10-22 16:37:17.642415

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '44554b9c4656'
down_revision = '00c356ba4436'
branch_labels = None
depends_on = None

UPGRADE_SQL = [
    """
    CREATE OR REPLACE FUNCTION kurbits_tsv(t text) RETURNS tsvector
    LANGUAGE sql IMMUTABLE AS $$
        SELECT to_tsvector('swedish', coalesce(t, '')) || to_tsvector('english', coalesce(t, ''))
    $$
    """,

    "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS search_vector tsvector",
    "ALTER TABLE agents ADD COLUMN IF NOT EXISTS search_vector tsvector",

    """
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
    """,
    "DROP TRIGGER IF EXISTS nodes_search_vector_trg ON nodes",
    """
    CREATE TRIGGER nodes_search_vector_trg
    BEFORE INSERT OR UPDATE ON nodes
    FOR EACH ROW EXECUTE FUNCTION nodes_search_vector_update()
    """,

    """
    CREATE OR REPLACE FUNCTION node_attachments_touch_node() RETURNS trigger
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
    """,
    "DROP TRIGGER IF EXISTS node_attachments_search_trg ON node_attachments",
    """
    CREATE TRIGGER node_attachments_search_trg
    AFTER INSERT OR DELETE OR UPDATE OF extracted_text, node_id ON node_attachments
    FOR EACH ROW EXECUTE FUNCTION node_attachments_touch_node()
    """,

    """
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
    """,
    "DROP TRIGGER IF EXISTS agents_search_vector_trg ON agents",
    """
    CREATE TRIGGER agents_search_vector_trg
    BEFORE INSERT OR UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION agents_search_vector_update()
    """,

    """
    CREATE OR REPLACE FUNCTION agent_identifiers_touch_agent() RETURNS trigger
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
    """,
    "DROP TRIGGER IF EXISTS agent_identifiers_search_trg ON agent_identifiers",
    """
    CREATE TRIGGER agent_identifiers_search_trg
    AFTER INSERT OR DELETE OR UPDATE OF value, agent_id ON agent_identifiers
    FOR EACH ROW EXECUTE FUNCTION agent_identifiers_touch_agent()
    """,

    "CREATE INDEX IF NOT EXISTS ix_nodes_search_vector ON nodes USING gin (search_vector)",
    "CREATE INDEX IF NOT EXISTS ix_agents_search_vector ON agents USING gin (search_vector)",

    "UPDATE nodes SET search_vector = NULL",
    "UPDATE agents SET search_vector = NULL",
]

DOWNGRADE_SQL = [
    "DROP TRIGGER IF EXISTS agent_identifiers_search_trg ON agent_identifiers",
    "DROP TRIGGER IF EXISTS agents_search_vector_trg ON agents",
    "DROP TRIGGER IF EXISTS node_attachments_search_trg ON node_attachments",
    "DROP TRIGGER IF EXISTS nodes_search_vector_trg ON nodes",
    "DROP FUNCTION IF EXISTS agent_identifiers_touch_agent()",
    "DROP FUNCTION IF EXISTS agents_search_vector_update()",
    "DROP FUNCTION IF EXISTS node_attachments_touch_node()",
    "DROP FUNCTION IF EXISTS nodes_search_vector_update()",
    "DROP INDEX IF EXISTS ix_agents_search_vector",
    "DROP INDEX IF EXISTS ix_nodes_search_vector",
    "ALTER TABLE agents DROP COLUMN IF EXISTS search_vector",
    "ALTER TABLE nodes DROP COLUMN IF EXISTS search_vector",
    "DROP FUNCTION IF EXISTS kurbits_tsv(text)",
]


def upgrade():
    if op.get_bind().dialect.name != 'postgresql':
        return
    for statement in UPGRADE_SQL:
        op.execute(statement)


def downgrade():
    if op.get_bind().dialect.name != 'postgresql':
        return
    for statement in DOWNGRADE_SQL:
        op.execute(statement)

