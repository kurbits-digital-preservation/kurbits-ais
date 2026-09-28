from app.models.agent import Agent, AgentNote, AgentRelationType, AgentNodeRelationType


def serialize_agent_stub(agent: Agent) -> dict:
    return {
        'id': agent.id,
        'name': agent.name,
        'agent_type': agent.agent_type.value,
        'authorized_form': agent.authorized_form,
        'date_from': agent.date_from,
        'date_to': agent.date_to,
    }


def serialize_agent_detail(agent: Agent) -> dict:
    return {
        'id': agent.id,
        'institution_id': agent.institution_id,
        'name': agent.name,
        'agent_type': agent.agent_type.value,
        'authorized_form': agent.authorized_form,
        'description': agent.description,
        'date_from': agent.date_from,
        'date_to': agent.date_to,
        'website': agent.website,
        'created_at': agent.created_at.isoformat(),
        'updated_at': agent.updated_at.isoformat(),
        'created_by': agent.created_by.username if agent.created_by else None,
        'notes': [serialize_agent_note(n) for n in agent.notes],
        'relations': agent.get_relations(),
        'node_count': agent.nodes.count(),
    }


def serialize_agent_note(note: AgentNote) -> dict:
    return {
        'id': note.id,
        'note_type': note.note_type,
        'content': note.content,
        'created_at': note.created_at.isoformat(),
        'created_by': note.created_by.username if note.created_by else None,
    }


def serialize_relation_type(rt: AgentRelationType) -> dict:
    return {
        'id': rt.id,
        'name': rt.name,
        'description': rt.description,
        'is_symmetric': rt.is_symmetric,
        'complementary_id': rt.complementary_id,
        'complementary_name': rt.complementary.name if rt.complementary else None,
    }


def serialize_node_relation_type(rt: AgentNodeRelationType) -> dict:
    return {
        'id': rt.id,
        'name': rt.name,
        'description': rt.description,
        'is_symmetric': rt.is_symmetric,
        'complementary_id': rt.complementary_id,
        'complementary_name': rt.complementary.name if rt.complementary else None,
    }