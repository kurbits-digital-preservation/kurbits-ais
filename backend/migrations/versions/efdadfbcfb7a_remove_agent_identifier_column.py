"""remove agent identifier column

Revision ID: efdadfbcfb7a
Revises: 3465091ade44
Create Date: 2026-09-26 22:46:17.583108

"""
from alembic import op
import sqlalchemy as sa
from datetime import datetime, timezone

# revision identifiers, used by Alembic.
revision = 'efdadfbcfb7a'
down_revision = '3465091ade44'
branch_labels = None
depends_on = None

_BUILTIN_SCHEMES = {
    'wikidata': ('Wikidata', 'https://www.wikidata.org/wiki/{value}'),
    'viaf':     ('VIAF',     'https://viaf.org/viaf/{value}'),
    'orcid':    ('ORCID',    'https://orcid.org/{value}'),
    'isni':     ('ISNI',     'https://isni.org/isni/{value}'),
    'ark':      ('ARK',      None),
    'doi':      ('DOI',      'https://doi.org/{value}'),
}
_LEGACY_SCHEME_NAME = 'Legacy identifier'

def upgrade():
    conn = op.get_bind()

    agents = conn.execute(sa.text(
        "SELECT id, institution_id, identifier FROM agents "
        "WHERE identifier IS NOT NULL AND identifier != ''"
    )).fetchall()

    scheme_cache: dict[tuple[int, str], int] = {}

    def get_or_create_scheme(institution_id: int, name: str, url_template: str | None) -> int:
        key = (institution_id, name)
        if key in scheme_cache:
            return scheme_cache[key]
        row = conn.execute(sa.text(
            "SELECT id FROM identifier_schemes WHERE institution_id = :inst AND name = :name"
        ), {'inst': institution_id, 'name': name}).fetchone()
        if row:
            scheme_id = row[0]
        else:
            result = conn.execute(sa.text(
                "INSERT INTO identifier_schemes (institution_id, name, url_template, is_active, sort_order) "
                "VALUES (:inst, :name, :url_template, :is_active, :sort_order) RETURNING id"
            ), {'inst': institution_id, 'name': name, 'url_template': url_template,
                'is_active': True, 'sort_order': 0})
            scheme_id = result.fetchone()[0]
        scheme_cache[key] = scheme_id
        return scheme_id

    for agent_id, institution_id, identifier in agents:
        segments = [s.strip() for s in identifier.split('|') if s.strip()]
        for segment in segments:
            prefix, sep, rest = segment.partition(':')
            if sep and prefix.strip().lower() in _BUILTIN_SCHEMES:
                name, url_template = _BUILTIN_SCHEMES[prefix.strip().lower()]
                value = rest.strip()
            else:
                name, url_template = _LEGACY_SCHEME_NAME, None
                value = segment

            if not value:
                continue

            scheme_id = get_or_create_scheme(institution_id, name, url_template)

            clash = conn.execute(sa.text(
                "SELECT 1 FROM agent_identifiers WHERE scheme_id = :sid AND value = :val "
                "UNION SELECT 1 FROM node_identifiers WHERE scheme_id = :sid AND value = :val"
            ), {'sid': scheme_id, 'val': value}).fetchone()
            if clash:
                print(f'  WARNING: skipping identifier "{value}" for agent {agent_id} '
                      f'(scheme {name}) — value already used elsewhere')
                continue

            conn.execute(sa.text(
                "INSERT INTO agent_identifiers (agent_id, scheme_id, value, is_primary, created_at) "
                "VALUES (:aid, :sid, :val, :is_primary, :created_at)"
            ), {'aid': agent_id, 'sid': scheme_id, 'val': value,
                'is_primary': False, 'created_at': datetime.now(timezone.utc)})

    op.drop_column('agents', 'identifier')


def downgrade():
    op.add_column('agents', sa.Column('identifier', sa.String(200), nullable=True))


def downgrade():
    pass
