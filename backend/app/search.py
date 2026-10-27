"""
Full-text search service for Kurbits.

PostgreSQL:  tsvector + GIN index, Swedish/English stemming, weighted columns.
SQLite:      ILIKE fallback across the same fields including metadata_spec cast.

Browse mode: with no query but an agent_id filter, nodes linked to the agent
are listed in reference code order.

Scopes (filters['scope']) limit which text a query is matched against:
  all          everything in search_vector (attachment text only when the
               institution indexes it)
  description  titles, ref codes and descriptive fields   (weights A, B)
  notes        notes                                        (weight C)
  attachments  extracted attachment text — nodes only, always available
"""
from __future__ import annotations
from typing import Optional
import sqlalchemy as sa
from app.extensions import db


MIN_QUERY_LENGTH = 2

SEARCH_SCOPES = ('all', 'description', 'notes', 'attachments')

_PG_TSQUERY = "(plainto_tsquery('swedish', :q) || plainto_tsquery('english', :q))"

# scope -> (vector column, weights to keep or None)
_PG_NODE_SCOPES = {
    'all':         ('n.search_vector', None),
    'description': ('n.search_vector', '{a,b}'),
    'notes':       ('n.search_vector', '{c}'),
    'attachments': ('n.attachment_vector', None),
}
_PG_AGENT_SCOPES = {
    'all':         ('a.search_vector', None),
    'description': ('a.search_vector', '{a,b}'),
    'notes':       ('a.search_vector', '{c}'),
}


def _is_postgres() -> bool:
    return db.engine.dialect.name == 'postgresql'


def _has_query(q: str) -> bool:
    return len(q) >= MIN_QUERY_LENGTH


def search_scope(filters: Optional[dict]) -> str:
    scope = (filters or {}).get('scope') or 'all'
    return scope if scope in SEARCH_SCOPES else 'all'


def _pg_scope_sql(scopes: dict, scope: str) -> tuple[list[str], str]:
    """WHERE clauses and rank expression for a scope. The plain @@ on the
    indexed column narrows candidates; ts_filter then keeps only the weights
    that belong to the scope."""
    column, weights = scopes.get(scope, scopes['all'])
    where = [f"{column} @@ {_PG_TSQUERY}"]
    rank_vector = column
    if weights:
        rank_vector = f"ts_filter({column}, '{weights}')"
        where.append(f"{rank_vector} @@ {_PG_TSQUERY}")
    return where, f"ts_rank({rank_vector}, {_PG_TSQUERY})"


def _node_text_condition(pattern: str, scope: str):
    """ILIKE equivalent of the scopes, for SQLite and facet counts."""
    from app.models.node import Node, NodeNote, NodeAttachment
    description = sa.or_(
        Node.title.ilike(pattern),
        Node.ref_code.ilike(pattern),
        Node.description.ilike(pattern),
        Node.scope_and_content.ilike(pattern),
        Node.arrangement.ilike(pattern),
        sa.cast(Node.metadata_spec, sa.Text).ilike(pattern),
    )
    notes = sa.exists(
        sa.select(NodeNote.id).where(
            NodeNote.node_id == Node.id,
            NodeNote.content.ilike(pattern),
        )
    )
    attachments = sa.exists(
        sa.select(NodeAttachment.id).where(
            NodeAttachment.node_id == Node.id,
            NodeAttachment.extracted_text.ilike(pattern),
        )
    )
    if scope == 'description':
        return description
    if scope == 'notes':
        return notes
    if scope == 'attachments':
        return attachments
    return sa.or_(description, notes)


def _agent_text_condition(pattern: str, scope: str):
    from app.models.agent import Agent, AgentIdentifier, AgentNameForm, AgentNote
    description = sa.or_(
        Agent.name.ilike(pattern),
        Agent.authorized_form.ilike(pattern),
        Agent.description.ilike(pattern),
        sa.exists(
            sa.select(AgentIdentifier.id).where(
                AgentIdentifier.agent_id == Agent.id,
                AgentIdentifier.value.ilike(pattern),
            )
        ),
        sa.exists(
            sa.select(AgentNameForm.id).where(
                AgentNameForm.agent_id == Agent.id,
                AgentNameForm.name.ilike(pattern),
            )
        ),
    )
    notes = sa.exists(
        sa.select(AgentNote.id).where(
            AgentNote.agent_id == Agent.id,
            AgentNote.content.ilike(pattern),
        )
    )
    if scope == 'description':
        return description
    if scope == 'notes':
        return notes
    if scope == 'attachments':
        return sa.false()
    return sa.or_(description, notes)


def _enum_variants(enum_cls, raw) -> list[str]:
    if raw is None:
        return []
    for lookup in (lambda v: enum_cls(v), lambda v: enum_cls[v], lambda v: enum_cls[str(v).upper()]):
        try:
            member = lookup(raw)
            return [member.name, member.value]
        except (ValueError, KeyError):
            continue
    return []


def _enum_value(enum_cls, raw):
    if raw is None:
        return None
    if isinstance(raw, enum_cls):
        return raw.value
    try:
        return enum_cls[raw].value
    except KeyError:
        try:
            return enum_cls(raw).value
        except ValueError:
            return raw


def _add_enum_where(where: list, params: dict, column_sql: str, key: str, enum_cls, raw) -> None:
    variants = _enum_variants(enum_cls, raw)
    if not variants:
        where.append('FALSE')
        return
    params[f'{key}_a'], params[f'{key}_b'] = variants
    where.append(f"({column_sql}::text = :{key}_a OR {column_sql}::text = :{key}_b)")


def search_attachment_text(
    q: str,
    institution_id: int,
    filters: Optional[dict] = None,
    limit: int = 50,
) -> list[dict]:
    """
    Search inside extracted attachment text.
    Returns nodes that have attachments containing the query string.
    """
    from app.models.node import NodeStatus
    filters = filters or {}
    pg = _is_postgres()

    if pg:
        params: dict = {
            'institution_id': institution_id,
            'limit': limit,
            'tsquery': q,
            'ilike_pattern': f'%{q}%',
        }
        where = [
            "n.institution_id = :institution_id",
            "na.extracted_text IS NOT NULL",
            "na.extracted_text != ''",
            "(to_tsvector('swedish', na.extracted_text) @@ plainto_tsquery('swedish', :tsquery) "
            "OR to_tsvector('english', na.extracted_text) @@ plainto_tsquery('english', :tsquery) "
            "OR na.extracted_text ILIKE :ilike_pattern)",
        ]

        if filters.get('status'):
            _add_enum_where(where, params, 'n.status', 'status', NodeStatus, filters['status'])
        if filters.get('level'):
            where.append("n.level_of_description = :level")
            params['level'] = filters['level']

        where_sql = ' AND '.join(where)
        sql = sa.text(f"""
            SELECT DISTINCT ON (n.id)
                n.id, n.ref_code, n.title, n.level_of_description,
                n.status, n.date_start, n.date_end,
                na.original_filename as matched_file,
                0.5 AS rank
            FROM nodes n
            JOIN node_attachments na ON na.node_id = n.id
            WHERE {where_sql}
            ORDER BY n.id, n.title
            LIMIT :limit
        """)
        rows = list(db.session.execute(sql, params))
        return [
            {
                'type': 'node', 'id': row.id,
                'ref_code': row.ref_code, 'title': row.title,
                'level': row.level_of_description,
                'status': _enum_value(NodeStatus, row.status),
                'date_start': row.date_start.year if row.date_start else None,
                'date_end': row.date_end.year if row.date_end else None,
                'meta': f'Found in: {row.matched_file}',
                'rank': 0.5,
            }
            for row in rows
        ]

    from app.models.node import Node, NodeAttachment
    pattern = f'%{q}%'
    query = (
        db.session.query(Node, NodeAttachment)
        .join(NodeAttachment, NodeAttachment.node_id == Node.id)
        .filter(
            Node.institution_id == institution_id,
            NodeAttachment.extracted_text.isnot(None),
            NodeAttachment.extracted_text.ilike(pattern),
        )
    )
    if filters.get('status'):
        query = query.filter(Node.status == filters['status'])
    if filters.get('level'):
        query = query.filter(Node.level_of_description == filters['level'])

    return [
        {
            'type': 'node', 'id': n.id,
            'ref_code': n.ref_code, 'title': n.title,
            'level': n.level_of_description, 'status': n.status.value,
            'date_start': n.date_start.year if n.date_start else None,
            'date_end': n.date_end.year if n.date_end else None,
            'meta': f'Found in: {att.original_filename}',
            'rank': 0.5,
        }
        for n, att in query.limit(limit).all()
    ]


# ─── Node search ──────────────────────────────────────────────────────

def _pg_node_query(
    q: str, institution_id: int,
    filters: dict, limit: int, offset: int
) -> tuple[list[dict], int]:
    from app.models.node import NodeStatus
    has_q = _has_query(q)
    where = ["n.institution_id = :institution_id"]
    params: dict = {'institution_id': institution_id, 'limit': limit, 'offset': offset}

    rank_sql = "0.0"
    if has_q:
        scope_where, rank_sql = _pg_scope_sql(_PG_NODE_SCOPES, search_scope(filters))
        where.extend(scope_where)
        params['q'] = q

    if filters.get('status'):
        _add_enum_where(where, params, 'n.status', 'status', NodeStatus, filters['status'])
    if filters.get('level'):
        where.append("n.level_of_description = :level")
        params['level'] = filters['level']
    if filters.get('hierarchy_type_id'):
        where.append("n.hierarchy_type_id = :hierarchy_type_id")
        params['hierarchy_type_id'] = int(filters['hierarchy_type_id'])
    if filters.get('classification_id'):
        where.append(
            "EXISTS (SELECT 1 FROM classification_node_association cna "
            "WHERE cna.node_id = n.id AND cna.classification_id = :classification_id)"
        )
        params['classification_id'] = int(filters['classification_id'])
    if filters.get('agent_id'):
        where.append(
            "EXISTS (SELECT 1 FROM agent_node_association ana_f "
            "WHERE ana_f.node_id = n.id AND ana_f.agent_id = :agent_id)"
        )
        params['agent_id'] = int(filters['agent_id'])
    if filters.get('date_from'):
        where.append("n.date_start >= :date_from")
        params['date_from'] = filters['date_from']
    if filters.get('date_to'):
        where.append("n.date_end <= :date_to")
        params['date_to'] = filters['date_to']

    if filters.get('has_scope_note') == 'true':
        where.append("n.scope_and_content IS NOT NULL AND n.scope_and_content != ''")
    if filters.get('has_scope_note') == 'false':
        where.append("(n.scope_and_content IS NULL OR n.scope_and_content = '')")
    if filters.get('has_description') == 'true':
        where.append("n.description IS NOT NULL AND n.description != ''")
    if filters.get('has_description') == 'false':
        where.append("(n.description IS NULL OR n.description = '')")
    if filters.get('no_date') == 'true':
        where.append("n.date_start IS NULL AND n.date_end IS NULL")
    if filters.get('has_agents') == 'true':
        where.append("EXISTS (SELECT 1 FROM agent_node_association ana WHERE ana.node_id = n.id)")
    if filters.get('has_attachments') == 'true':
        where.append("EXISTS (SELECT 1 FROM node_attachments na WHERE na.node_id = n.id)")
    if filters.get('has_attachment_text') == 'true':
        where.append("""EXISTS (
            SELECT 1 FROM node_attachments na
            WHERE na.node_id = n.id
            AND na.extracted_text IS NOT NULL AND na.extracted_text != ''
        )""")
    if filters.get('has_attachment_text') == 'false':
        where.append("""NOT EXISTS (
            SELECT 1 FROM node_attachments na
            WHERE na.node_id = n.id
            AND na.extracted_text IS NOT NULL AND na.extracted_text != ''
        )""")

    if filters.get('tag'):
        where.append("""EXISTS (
            SELECT 1 FROM node_tags nt
            JOIN tags t ON t.id = nt.tag_id
            WHERE nt.node_id = n.id
            AND LOWER(t.name) = LOWER(:tag_name)
        )""")
        params['tag_name'] = filters['tag']

    if filters.get('tag_category'):
        where.append("""EXISTS (
            SELECT 1 FROM node_tags nt
            JOIN tags t ON t.id = nt.tag_id
            WHERE nt.node_id = n.id
            AND LOWER(t.category) = LOWER(:tag_category)
        )""")
        params['tag_category'] = filters['tag_category']

    if filters.get('agent_name'):
        where.append("""EXISTS (
            SELECT 1 FROM agent_node_association ana
            JOIN agents a ON a.id = ana.agent_id
            WHERE ana.node_id = n.id
            AND (a.name ILIKE :agent_name_pattern
                 OR a.authorized_form ILIKE :agent_name_pattern)
        )""")
        params['agent_name_pattern'] = f"%{filters['agent_name']}%"

    if filters.get('has_notes') == 'true':
        where.append("EXISTS (SELECT 1 FROM node_notes nn WHERE nn.node_id = n.id)")
    if filters.get('has_notes') == 'false':
        where.append("NOT EXISTS (SELECT 1 FROM node_notes nn WHERE nn.node_id = n.id)")

    where_sql = ' AND '.join(where)

    order_sql = "rank DESC, n.title" if has_q else "n.ref_code"

    sql = sa.text(f"""
        SELECT
            n.id, n.ref_code, n.title, n.level_of_description,
            n.status, n.date_start, n.date_end, n.hierarchy_type_id,
            {rank_sql} AS rank,
            COUNT(*) OVER() AS total_count
        FROM nodes n
        WHERE {where_sql}
        ORDER BY {order_sql}
        LIMIT :limit OFFSET :offset
    """)

    rows = list(db.session.execute(sql, params))
    total = rows[0].total_count if rows else 0

    return [
        {
            'type': 'node',
            'id': row.id,
            'ref_code': row.ref_code,
            'title': row.title,
            'level': row.level_of_description,
            'status': _enum_value(NodeStatus, row.status),
            'date_start': row.date_start.year if row.date_start else None,
            'date_end': row.date_end.year if row.date_end else None,
            'hierarchy_type_id': row.hierarchy_type_id,
            'rank': float(row.rank),
        }
        for row in rows
    ], int(total)


def _sqlite_node_query(
    q: str, institution_id: int,
    filters: dict, limit: int, offset: int
) -> tuple[list[dict], int]:
    from app.models.node import Node, NodeAttachment, NodeNote
    has_q = _has_query(q)
    pattern = f'%{q}%'

    query = Node.query.filter(Node.institution_id == institution_id)
    if has_q:
        query = query.filter(_node_text_condition(pattern, search_scope(filters)))

    if filters.get('status'):
        query = query.filter(Node.status == filters['status'])
    if filters.get('level'):
        query = query.filter(Node.level_of_description == filters['level'])
    if filters.get('hierarchy_type_id'):
        query = query.filter(Node.hierarchy_type_id == int(filters['hierarchy_type_id']))
    if filters.get('classification_id'):
        from app.models.classification import classification_node_association as _cna
        query = query.filter(
            Node.id.in_(
                sa.select(_cna.c.node_id).where(
                    _cna.c.classification_id == int(filters['classification_id'])
                )
            )
        )
    if filters.get('agent_id'):
        from app.models.agent import agent_node_association as _ana
        query = query.filter(
            Node.id.in_(
                sa.select(_ana.c.node_id).where(_ana.c.agent_id == int(filters['agent_id']))
            )
        )
    if filters.get('date_from'):
        query = query.filter(Node.date_start >= filters['date_from'])
    if filters.get('date_to'):
        query = query.filter(Node.date_end <= filters['date_to'])

    if filters.get('has_scope_note') == 'true':
        query = query.filter(Node.scope_and_content.isnot(None), Node.scope_and_content != '')
    if filters.get('has_scope_note') == 'false':
        query = query.filter(
            sa.or_(Node.scope_and_content.is_(None), Node.scope_and_content == '')
        )
    if filters.get('has_description') == 'true':
        query = query.filter(Node.description.isnot(None), Node.description != '')
    if filters.get('has_description') == 'false':
        query = query.filter(
            sa.or_(Node.description.is_(None), Node.description == '')
        )
    if filters.get('no_date') == 'true':
        query = query.filter(Node.date_start.is_(None), Node.date_end.is_(None))

    if filters.get('has_attachments') == 'true':
        query = query.filter(
            sa.exists(sa.select(NodeAttachment.id).where(NodeAttachment.node_id == Node.id))
        )
    if filters.get('has_attachment_text') == 'true':
        query = query.filter(
            sa.exists(
                sa.select(NodeAttachment.id).where(
                    NodeAttachment.node_id == Node.id,
                    NodeAttachment.extracted_text.isnot(None),
                    NodeAttachment.extracted_text != '',
                )
            )
        )
    if filters.get('has_attachment_text') == 'false':
        query = query.filter(
            ~sa.exists(
                sa.select(NodeAttachment.id).where(
                    NodeAttachment.node_id == Node.id,
                    NodeAttachment.extracted_text.isnot(None),
                    NodeAttachment.extracted_text != '',
                )
            )
        )

    if filters.get('has_notes') == 'true':
        query = query.filter(
            sa.exists(sa.select(NodeNote.id).where(NodeNote.node_id == Node.id))
        )
    if filters.get('has_notes') == 'false':
        query = query.filter(
            ~sa.exists(sa.select(NodeNote.id).where(NodeNote.node_id == Node.id))
        )

    if filters.get('tag') or filters.get('tag_category'):
        from app.models.geo import Tag, node_tags_table
        if filters.get('tag'):
            query = query.filter(
                sa.exists(
                    sa.select(node_tags_table.c.node_id)
                    .join(Tag, Tag.id == node_tags_table.c.tag_id)
                    .where(
                        node_tags_table.c.node_id == Node.id,
                        sa.func.lower(Tag.name) == filters['tag'].lower(),
                    )
                )
            )
        if filters.get('tag_category'):
            query = query.filter(
                sa.exists(
                    sa.select(node_tags_table.c.node_id)
                    .join(Tag, Tag.id == node_tags_table.c.tag_id)
                    .where(
                        node_tags_table.c.node_id == Node.id,
                        sa.func.lower(Tag.category) == filters['tag_category'].lower(),
                    )
                )
            )

    if filters.get('agent_name'):
        from app.models.agent import Agent, agent_node_association
        agent_pattern = f"%{filters['agent_name']}%"
        query = query.filter(
            sa.exists(
                sa.select(agent_node_association.c.node_id)
                .join(Agent, Agent.id == agent_node_association.c.agent_id)
                .where(
                    agent_node_association.c.node_id == Node.id,
                    sa.or_(
                        Agent.name.ilike(agent_pattern),
                        Agent.authorized_form.ilike(agent_pattern),
                    )
                )
            )
        )

    if filters.get('has_agents') == 'true':
        from app.models.agent import agent_node_association
        query = query.filter(
            sa.exists(
                sa.select(agent_node_association.c.node_id).where(
                    agent_node_association.c.node_id == Node.id
                )
            )
        )

    total = query.count()
    if has_q:
        query = query.order_by(
            sa.case(
                (Node.title.ilike(pattern), 1),
                (Node.ref_code.ilike(pattern), 2),
                else_=3,
            ),
            Node.title,
        )
    else:
        query = query.order_by(Node.ref_code)
    nodes = query.limit(limit).offset(offset).all()

    return [
        {
            'type': 'node',
            'id': n.id,
            'ref_code': n.ref_code,
            'title': n.title,
            'level': n.level_of_description,
            'status': n.status.value,
            'date_start': n.date_start.year if n.date_start else None,
            'date_end': n.date_end.year if n.date_end else None,
            'hierarchy_type_id': n.hierarchy_type_id,
            'rank': 1.0 if has_q else 0.0,
        }
        for n in nodes
    ], total


# ─── Agent search ─────────────────────────────────────────────────────

OTHER_NAMES_IN_RESULT = 3


def _attach_other_names(results: list[dict]) -> list[dict]:
    from app.models.agent import AgentNameForm
    ids = [r['id'] for r in results]
    names: dict[int, list[str]] = {}
    if ids:
        rows = db.session.execute(
            sa.select(AgentNameForm.agent_id, AgentNameForm.name)
            .where(AgentNameForm.agent_id.in_(ids))
            .order_by(AgentNameForm.agent_id, AgentNameForm.id)
        ).all()
        for agent_id, name in rows:
            names.setdefault(agent_id, []).append(name)
    for r in results:
        all_names = names.get(r['id'], [])
        r['other_names'] = all_names[:OTHER_NAMES_IN_RESULT]
        r['other_names_total'] = len(all_names)
    return results

def _pg_agent_query(
    q: str, institution_id: int,
    filters: dict, limit: int, offset: int
) -> tuple[list[dict], int]:
    from app.models.agent import AgentType
    scope_where, rank_sql = _pg_scope_sql(_PG_AGENT_SCOPES, search_scope(filters))
    where = ["a.institution_id = :institution_id", *scope_where]
    params: dict = {'q': q, 'institution_id': institution_id,
                    'limit': limit, 'offset': offset}

    if filters.get('agent_type'):
        _add_enum_where(where, params, 'a.agent_type', 'agent_type', AgentType, filters['agent_type'])

    where_sql = ' AND '.join(where)

    sql = sa.text(f"""
        SELECT
            a.id, a.name, a.agent_type, a.authorized_form, a.date_from, a.date_to,
            {rank_sql} AS rank,
            COUNT(*) OVER() AS total_count
        FROM agents a
        WHERE {where_sql}
        ORDER BY rank DESC, a.name
        LIMIT :limit OFFSET :offset
    """)

    rows = list(db.session.execute(sql, params))
    total = rows[0].total_count if rows else 0

    return _attach_other_names([
        {
            'type': 'agent',
            'id': row.id,
            'name': row.name,
            'agent_type': _enum_value(AgentType, row.agent_type),
            'authorized_form': row.authorized_form,
            'date_from': row.date_from,
            'date_to': row.date_to,
            'rank': float(row.rank),
        }
        for row in rows
    ]), int(total)


def _sqlite_agent_query(
    q: str, institution_id: int,
    filters: dict, limit: int, offset: int
) -> tuple[list[dict], int]:
    from app.models.agent import Agent
    pattern = f'%{q}%'

    query = Agent.query.filter(
        Agent.institution_id == institution_id,
        _agent_text_condition(pattern, search_scope(filters)),
    )

    if filters.get('agent_type'):
        query = query.filter(Agent.agent_type == filters['agent_type'])

    total = query.count()
    agents = query.order_by(
        sa.case((Agent.name.ilike(pattern), 1), (Agent.authorized_form.ilike(pattern), 2), else_=3),
        Agent.name,
    ).limit(limit).offset(offset).all()

    return _attach_other_names([
        {
            'type': 'agent',
            'id': a.id,
            'name': a.name,
            'agent_type': a.agent_type.value,
            'authorized_form': a.authorized_form,
            'date_from': a.date_from,
            'date_to': a.date_to,
            'rank': 1.0,
        }
        for a in agents
    ]), total


# ─── Facets ───────────────────────────────────────────────────────────

AGENT_FACET_LIMIT = 15


def compute_facets(q: str, institution_id: int, filters: dict) -> dict:
    """Facet counts for a search, respecting the query and all OTHER active filters."""
    from app.models.node import Node
    from app.models.agent import Agent, agent_node_association as ANA
    from app.models.hierarchy import HierarchyType
    from app.models.classification import Classification, classification_node_association as CNA

    q = (q or '').strip()
    has_q = _has_query(q)
    scope = search_scope(filters)
    pattern = f'%{q}%'
    facets: dict = {'agent': [], 'agent_type': [], 'classification': [], 'hierarchy_type': [],
                    'level': [], 'status': []}
    if not has_q and not filters.get('agent_id'):
        return facets

    def _node_base(exclude: str = ''):
        query = db.session.query(Node.id).filter(Node.institution_id == institution_id)
        if has_q:
            query = query.filter(_node_text_condition(pattern, scope))
        if exclude != 'status' and filters.get('status'):
            query = query.filter(Node.status == filters['status'])
        if exclude != 'level' and filters.get('level'):
            query = query.filter(Node.level_of_description == filters['level'])
        if exclude != 'hierarchy_type' and filters.get('hierarchy_type_id'):
            query = query.filter(Node.hierarchy_type_id == int(filters['hierarchy_type_id']))
        if exclude != 'classification' and filters.get('classification_id'):
            query = query.filter(
                Node.id.in_(
                    sa.select(CNA.c.node_id).where(
                        CNA.c.classification_id == int(filters['classification_id'])
                    )
                )
            )
        if exclude != 'agent' and filters.get('agent_id'):
            query = query.filter(
                Node.id.in_(
                    sa.select(ANA.c.node_id).where(ANA.c.agent_id == int(filters['agent_id']))
                )
            )
        if filters.get('date_from'):
            query = query.filter(Node.date_start >= filters['date_from'])
        if filters.get('date_to'):
            query = query.filter(Node.date_end <= filters['date_to'])
        return query

    for level, count in (
        db.session.query(Node.level_of_description, sa.func.count())
        .filter(Node.id.in_(_node_base('level').subquery().select()))
        .group_by(Node.level_of_description).all()
    ):
        if level:
            facets['level'].append({'value': level, 'count': count})
    facets['level'].sort(key=lambda x: -x['count'])

    for status, count in (
        db.session.query(Node.status, sa.func.count())
        .filter(Node.id.in_(_node_base('status').subquery().select()))
        .group_by(Node.status).all()
    ):
        if status:
            val = status.value if hasattr(status, 'value') else status
            facets['status'].append({'value': val, 'count': count})
    facets['status'].sort(key=lambda x: -x['count'])

    for ht_id, name, count in (
        db.session.query(HierarchyType.id, HierarchyType.name, sa.func.count(Node.id))
        .join(Node, Node.hierarchy_type_id == HierarchyType.id)
        .filter(Node.id.in_(_node_base('hierarchy_type').subquery().select()))
        .group_by(HierarchyType.id, HierarchyType.name).all()
    ):
        facets['hierarchy_type'].append({'value': str(ht_id), 'label': name, 'count': count})
    facets['hierarchy_type'].sort(key=lambda x: -x['count'])

    base_ids = _node_base('classification').subquery().select()
    rows = (
        db.session.query(Classification.id, Classification.name, Classification.code, sa.func.count(CNA.c.node_id))
        .join(CNA, CNA.c.classification_id == Classification.id)
        .filter(CNA.c.node_id.in_(base_ids))
        .group_by(Classification.id, Classification.name, Classification.code)
        .all()
    )
    facets['classification'] = sorted(
        [{'value': str(cid), 'label': f'{name}', 'code': code, 'count': cnt}
         for cid, name, code, cnt in rows],
        key=lambda x: -x['count']
    )[:30]

    agent_count = sa.func.count(ANA.c.node_id)
    agent_query = (
        db.session.query(Agent.id, Agent.name, agent_count)
        .join(ANA, ANA.c.agent_id == Agent.id)
        .filter(Agent.institution_id == institution_id)
        .group_by(Agent.id, Agent.name)
    )
    if has_q:
        agent_query = agent_query.filter(
            ANA.c.node_id.in_(_node_base('agent').subquery().select())
        )
        facets['agent'] = [
            {'value': str(aid), 'label': name, 'count': cnt}
            for aid, name, cnt in agent_query.order_by(agent_count.desc(), Agent.name)
            .limit(AGENT_FACET_LIMIT).all()
        ]

    active_agent = filters.get('agent_id')
    if active_agent and str(active_agent) not in {f['value'] for f in facets['agent']}:
        active_query = (
            db.session.query(Agent.id, Agent.name, agent_count)
            .join(ANA, ANA.c.agent_id == Agent.id)
            .filter(
                Agent.id == int(active_agent),
                Agent.institution_id == institution_id,
                ANA.c.node_id.in_(_node_base().subquery().select()),
            )
            .group_by(Agent.id, Agent.name)
        )
        row = active_query.first()
        if row:
            facets['agent'].insert(0, {'value': str(row[0]), 'label': row[1], 'count': row[2]})
        else:
            agent = db.session.get(Agent, int(active_agent))
            if agent and agent.institution_id == institution_id:
                facets['agent'].insert(0, {'value': str(agent.id), 'label': agent.name, 'count': 0})

    if has_q and scope != 'attachments':
        agent_base = db.session.query(Agent.id).filter(
            Agent.institution_id == institution_id,
            _agent_text_condition(pattern, scope),
        )
        for atype, count in (
            db.session.query(Agent.agent_type, sa.func.count())
            .filter(Agent.id.in_(agent_base.subquery().select()))
            .group_by(Agent.agent_type).all()
        ):
            if atype:
                val = atype.value if hasattr(atype, 'value') else atype
                facets['agent_type'].append({'value': val, 'count': count})
        facets['agent_type'].sort(key=lambda x: -x['count'])

    return facets


# ─── File search ──────────────────────────────────────────────────────

def _file_query(q, institution_id, filters, limit, offset):
    """Search node attachments by filename and technical metadata, grouped by node."""
    from app.models.node import Node, NodeAttachment

    pattern = f'%{q}%'

    base = (
        db.session.query(NodeAttachment)
        .join(Node, NodeAttachment.node_id == Node.id)
        .filter(Node.institution_id == institution_id)
        .filter(
            sa.or_(
                NodeAttachment.original_filename.ilike(pattern),
                NodeAttachment.filename.ilike(pattern),
            )
        )
    )

    if filters.get('file_mime'):
        base = base.filter(NodeAttachment.mime_type == filters['file_mime'])
    if filters.get('file_pronom'):
        base = base.filter(NodeAttachment.pronom_id == filters['file_pronom'])
    if filters.get('file_min_size'):
        base = base.filter(NodeAttachment.file_size >= int(filters['file_min_size']))
    if filters.get('file_max_size'):
        base = base.filter(NodeAttachment.file_size <= int(filters['file_max_size']))
    if str(filters.get('file_has_checksum', '')).lower() == 'true':
        base = base.filter(NodeAttachment.checksum_sha256.isnot(None))
    if filters.get('file_min_width'):
        base = base.filter(NodeAttachment.image_width >= int(filters['file_min_width']))
    if filters.get('file_min_height'):
        base = base.filter(NodeAttachment.image_height >= int(filters['file_min_height']))

    node_id_rows = base.with_entities(NodeAttachment.node_id).distinct().all()
    total_nodes = len(node_id_rows)

    page_node_ids = sorted(r[0] for r in node_id_rows)[offset:offset + limit]
    if not page_node_ids:
        return [], total_nodes

    files = (
        base.filter(NodeAttachment.node_id.in_(page_node_ids))
        .order_by(NodeAttachment.node_id, NodeAttachment.original_filename)
        .all()
    )

    nodes = {n.id: n for n in Node.query.filter(Node.id.in_(page_node_ids)).all()}
    grouped: dict = {}
    for f in files:
        grouped.setdefault(f.node_id, []).append(f)

    results = []
    for node_id in page_node_ids:
        node = nodes.get(node_id)
        if not node:
            continue
        matched = grouped.get(node_id, [])
        results.append({
            'type': 'file_group',
            'id': node.id,
            'node_id': node.id,
            'title': node.title,
            'ref_code': node.ref_code,
            'level': node.level_of_description,
            'match_count': len(matched),
            'files': [
                {
                    'id': f.id,
                    'filename': f.original_filename,
                    'mime_type': f.mime_type,
                    'pronom_id': f.pronom_id,
                    'file_size': f.file_size,
                    'image_width': f.image_width,
                    'image_height': f.image_height,
                    'has_checksum': f.checksum_sha256 is not None,
                }
                for f in matched
            ],
            'rank': float(len(matched)),
        })

    return results, total_nodes


def _file_match_count(q, institution_id):
    """COUNT of distinct nodes with a filename-matching file, for the 'N files also match' hint."""
    from app.models.node import Node, NodeAttachment

    pattern = f'%{q}%'
    count = (
        db.session.query(sa.func.count(sa.distinct(NodeAttachment.node_id)))
        .join(Node, NodeAttachment.node_id == Node.id)
        .filter(
            Node.institution_id == institution_id,
            sa.or_(
                NodeAttachment.original_filename.ilike(pattern),
                NodeAttachment.filename.ilike(pattern),
            ),
        )
        .scalar()
    )
    return int(count or 0)


# ─── Entry point ──────────────────────────────────────────────────────

def search(
    q: str,
    institution_id: int,
    types: Optional[list[str]] = None,
    filters: Optional[dict] = None,
    limit: int = 20,
    page: int = 1,
) -> dict:
    q = q.strip()
    filters = filters or {}
    has_q = _has_query(q)
    browse = not has_q and bool(filters.get('agent_id'))

    if not has_q and not browse:
        return {
            'nodes': [], 'agents': [], 'files': [], 'total': 0,
            'query': q, 'engine': 'none', 'page': page, 'per_page': limit,
        }

    types = types or ['nodes', 'agents']
    if browse:
        types = ['nodes']
    elif search_scope(filters) == 'attachments' and 'agents' in types:
        types = [t for t in types if t != 'agents'] or ['nodes']

    pg = _is_postgres()
    engine_name = 'postgresql' if pg else 'sqlite'
    offset = (page - 1) * limit

    node_results, node_total = [], 0
    agent_results, agent_total = [], 0
    file_results, file_total = [], 0

    if 'nodes' in types:
        fn = _pg_node_query if pg else _sqlite_node_query
        node_results, node_total = fn(q, institution_id, filters, limit, offset)

    if 'agents' in types:
        fn = _pg_agent_query if pg else _sqlite_agent_query
        agent_results, agent_total = fn(q, institution_id, filters, limit, offset)

    file_match_hint = 0
    if 'files' in types:
        file_results, file_total = _file_query(q, institution_id, filters, limit, offset)
    elif has_q:
        file_match_hint = _file_match_count(q, institution_id)

    text_types = [t for t in types if t in ('nodes', 'agents')]
    if len(text_types) > 1:
        all_results = sorted(
            node_results + agent_results,
            key=lambda r: r['rank'], reverse=True
        )
    elif 'nodes' in text_types:
        all_results = node_results
    elif 'agents' in text_types:
        all_results = agent_results
    else:
        all_results = file_results

    total = node_total + agent_total + file_total

    return {
        'results': all_results,
        'nodes': node_results,
        'agents': agent_results,
        'files': file_results,
        'total': total,
        'node_total': node_total,
        'agent_total': agent_total,
        'file_total': file_total,
        'file_match_hint': file_match_hint,
        'query': q,
        'engine': engine_name,
        'page': page,
        'per_page': limit,
        'pages': max(1, (total + limit - 1) // limit),
        'facets': compute_facets(q, institution_id, filters),
    }