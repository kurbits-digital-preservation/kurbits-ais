from typing import Optional
import sqlalchemy as sa
from app.extensions import db

SEARCH_VECTOR_INDEXES = {'ix_nodes_search_vector', 'ix_agents_search_vector'}


def include_object(obj, name, type_, reflected, compare_to):
    if type_ == 'column' and name == 'search_vector':
        return False
    if type_ == 'index' and name in SEARCH_VECTOR_INDEXES:
        return False
    return True


def reindex_search(institution_id: Optional[int] = None) -> tuple[int, int]:
    if db.engine.dialect.name != 'postgresql':
        return 0, 0
    node_sql = 'UPDATE nodes SET search_vector = NULL'
    agent_sql = 'UPDATE agents SET search_vector = NULL'
    params = {}
    if institution_id is not None:
        node_sql += ' WHERE institution_id = :iid'
        agent_sql += ' WHERE institution_id = :iid'
        params['iid'] = institution_id
    nodes = db.session.execute(sa.text(node_sql), params).rowcount
    agents = db.session.execute(sa.text(agent_sql), params).rowcount
    db.session.commit()
    return nodes, agents
