"""
Full-text search service for Kurbits.

PostgreSQL:  tsvector + GIN index, Swedish/English stemming, weighted columns.
             metadata_spec JSONB cast to text is included in the vector.
SQLite:      ILIKE fallback across the same fields including metadata_spec cast.

Supports filters: types, status, level, hierarchy_type_id, date_from, date_to
Supports pagination: page, per_page
"""
from __future__ import annotations
from typing import Optional
import sqlalchemy as sa
from app.extensions import db


def _is_postgres() -> bool:
    return db.engine.dialect.name == 'postgresql'


# ── PostgreSQL queries ─────────────────────────────────────────────────

def _pg_node_query(
    q: str, institution_id: int,
    filters: dict, limit: int, offset: int
) -> tuple[list[dict], int]:
    where = [
        "n.institution_id = :institution_id",
        "n.search_vector @@ (plainto_tsquery('swedish', :q) || plainto_tsquery('english', :q))",
    ]
    params: dict = {'q': q, 'institution_id': institution_id,
                    'limit': limit, 'offset': offset}

    if filters.get('status'):
        where.append("n.status = :status")
        params['status'] = filters['status']
    if filters.get('level'):
        where.append("n.level_of_description = :level")
        params['level'] = filters['level']
    if filters.get('hierarchy_type_id'):
        where.append("n.hierarchy_type_id = :hierarchy_type_id")
        params['hierarchy_type_id'] = filters['hierarchy_type_id']
    if filters.get('date_from'):
        where.append("n.date_start >= :date_from")
        params['date_from'] = filters['date_from']
    if filters.get('date_to'):
        where.append("n.date_end <= :date_to")
        params['date_to'] = filters['date_to']

    where_sql = ' AND '.join(where)

    sql = sa.text(f"""
        SELECT
            n.id, n.ref_code, n.title, n.level_of_description,
            n.status, n.date_start, n.date_end, n.hierarchy_type_id,
            ts_rank(
                n.search_vector,
                plainto_tsquery('swedish', :q) || plainto_tsquery('english', :q)
            ) AS rank,
            COUNT(*) OVER() AS total_count
        FROM nodes n
        WHERE {where_sql}
        ORDER BY rank DESC, n.title
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
            'status': row.status,
            'date_start': row.date_start.year if row.date_start else None,
            'date_end': row.date_end.year if row.date_end else None,
            'hierarchy_type_id': row.hierarchy_type_id,
            'rank': float(row.rank),
        }
        for row in rows
    ], int(total)


def _pg_agent_query(
    q: str, institution_id: int,
    filters: dict, limit: int, offset: int
) -> tuple[list[dict], int]:
    where = [
        "a.institution_id = :institution_id",
        "a.search_vector @@ (plainto_tsquery('swedish', :q) || plainto_tsquery('english', :q))",
    ]
    params: dict = {'q': q, 'institution_id': institution_id,
                    'limit': limit, 'offset': offset}

    if filters.get('agent_type'):
        where.append("a.agent_type = :agent_type")
        params['agent_type'] = filters['agent_type']

    where_sql = ' AND '.join(where)

    sql = sa.text(f"""
        SELECT
            a.id, a.name, a.agent_type, a.authorized_form, a.date_from, a.date_to,
            ts_rank(
                a.search_vector,
                plainto_tsquery('swedish', :q) || plainto_tsquery('english', :q)
            ) AS rank,
            COUNT(*) OVER() AS total_count
        FROM agents a
        WHERE {where_sql}
        ORDER BY rank DESC, a.name
        LIMIT :limit OFFSET :offset
    """)

    rows = list(db.session.execute(sql, params))
    total = rows[0].total_count if rows else 0

    return [
        {
            'type': 'agent',
            'id': row.id,
            'name': row.name,
            'agent_type': row.agent_type,
            'authorized_form': row.authorized_form,
            'date_from': row.date_from,
            'date_to': row.date_to,
            'rank': float(row.rank),
        }
        for row in rows
    ], int(total)


# ── SQLite fallback queries ────────────────────────────────────────────

def _sqlite_node_query(
    q: str, institution_id: int,
    filters: dict, limit: int, offset: int
) -> tuple[list[dict], int]:
    from app.models.node import Node
    pattern = f'%{q}%'

    query = Node.query.filter(
        Node.institution_id == institution_id,
        sa.or_(
            Node.title.ilike(pattern),
            Node.ref_code.ilike(pattern),
            Node.description.ilike(pattern),
            Node.scope_and_content.ilike(pattern),
            Node.arrangement.ilike(pattern),
            sa.cast(Node.metadata_spec, sa.Text).ilike(pattern),
        )
    )

    if filters.get('status'):
        query = query.filter(Node.status == filters['status'])
    if filters.get('level'):
        query = query.filter(Node.level_of_description == filters['level'])
    if filters.get('hierarchy_type_id'):
        query = query.filter(Node.hierarchy_type_id == filters['hierarchy_type_id'])
    if filters.get('date_from'):
        query = query.filter(Node.date_start >= filters['date_from'])
    if filters.get('date_to'):
        query = query.filter(Node.date_end <= filters['date_to'])

    total = query.count()
    nodes = query.order_by(
        sa.case((Node.title.ilike(pattern), 1), (Node.ref_code.ilike(pattern), 2), else_=3)
    ).limit(limit).offset(offset).all()

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
            'rank': 1.0,
        }
        for n in nodes
    ], total


def _sqlite_agent_query(
    q: str, institution_id: int,
    filters: dict, limit: int, offset: int
) -> tuple[list[dict], int]:
    from app.models.agent import Agent
    pattern = f'%{q}%'

    query = Agent.query.filter(
        Agent.institution_id == institution_id,
        sa.or_(
            Agent.name.ilike(pattern),
            Agent.authorized_form.ilike(pattern),
            Agent.description.ilike(pattern),
            Agent.identifier.ilike(pattern),
        )
    )

    if filters.get('agent_type'):
        query = query.filter(Agent.agent_type == filters['agent_type'])

    total = query.count()
    agents = query.order_by(
        sa.case((Agent.name.ilike(pattern), 1), (Agent.authorized_form.ilike(pattern), 2), else_=3)
    ).limit(limit).offset(offset).all()

    return [
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
    ], total


# ── Public API ─────────────────────────────────────────────────────────

def search(
    q: str,
    institution_id: int,
    types: Optional[list[str]] = None,
    filters: Optional[dict] = None,
    limit: int = 20,
    page: int = 1,
) -> dict:
    """
    Full-text search with filters and pagination.

    filters keys: status, level, hierarchy_type_id, date_from, date_to, agent_type
    """
    q = q.strip()
    if not q or len(q) < 2:
        return {
            'nodes': [], 'agents': [], 'total': 0,
            'query': q, 'engine': 'none', 'page': page, 'per_page': limit,
        }

    types = types or ['nodes', 'agents']
    filters = filters or {}
    pg = _is_postgres()
    engine_name = 'postgresql' if pg else 'sqlite'
    offset = (page - 1) * limit

    node_results, node_total = [], 0
    agent_results, agent_total = [], 0

    if 'nodes' in types:
        fn = _pg_node_query if pg else _sqlite_node_query
        node_results, node_total = fn(q, institution_id, filters, limit, offset)

    if 'agents' in types:
        fn = _pg_agent_query if pg else _sqlite_agent_query
        agent_results, agent_total = fn(q, institution_id, filters, limit, offset)

    # Merge and sort by rank when both types requested
    if 'nodes' in types and 'agents' in types:
        all_results = sorted(
            node_results + agent_results,
            key=lambda r: r['rank'], reverse=True
        )
        total = node_total + agent_total
    elif 'nodes' in types:
        all_results = node_results
        total = node_total
    else:
        all_results = agent_results
        total = agent_total

    return {
        'results': all_results,
        'nodes': node_results,
        'agents': agent_results,
        'total': total,
        'node_total': node_total,
        'agent_total': agent_total,
        'query': q,
        'engine': engine_name,
        'page': page,
        'per_page': limit,
        'pages': max(1, (total + limit - 1) // limit),
    }