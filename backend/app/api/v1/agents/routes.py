from flask import request
from flask_login import login_required, current_user
from app.api.v1 import bp
from app.api.v1.helpers import success, error, require_write, require_institution_admin
from app.api.v1.agents.serializers import (
    serialize_agent_stub, serialize_agent_detail,
    serialize_agent_note, serialize_relation_type, serialize_node_relation_type
)
from app.api.v1.nodes.serializers import serialize_node_stub
from app.extensions import db
from app.models import Agent, AgentType, AgentRelationType, AgentNodeRelationType, AgentNote
from app.models.agent import agent_node_association
import sqlalchemy as sa


def _get_agent_or_404(agent_id: int, institution_id: int):
    return Agent.query.filter_by(id=agent_id, institution_id=institution_id).first()


# ---------------------------------------------------------------------------
# Agents CRUD
# ---------------------------------------------------------------------------

# GET /api/v1/agents
@bp.route('/agents', methods=['GET'])
@login_required
def list_agents():
    if not current_user.active_institution_id:
        return error('No active institution', 400)

    institution_id = current_user.active_institution_id
    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 25, type=int), 100)
    search = request.args.get('q', '').strip()
    type_filter = request.args.get('type')

    query = sa.select(Agent).where(Agent.institution_id == institution_id)

    if search:
        query = query.where(
            sa.or_(
                Agent.name.ilike(f'%{search}%'),
                Agent.authorized_form.ilike(f'%{search}%'),
                Agent.identifier.ilike(f'%{search}%'),
            )
        )
    if type_filter:
        query = query.where(Agent.agent_type == type_filter)

    query = query.order_by(Agent.name)
    paginated = db.paginate(query, page=page, per_page=per_page, error_out=False)

    return success(
        [serialize_agent_stub(a) for a in paginated.items],
        meta={
            'page': paginated.page,
            'per_page': per_page,
            'total': paginated.total,
            'pages': paginated.pages,
        }
    )


# GET /api/v1/agents/<id>
@bp.route('/agents/<int:agent_id>', methods=['GET'])
@login_required
def get_agent(agent_id):
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    agent = _get_agent_or_404(agent_id, current_user.active_institution_id)
    if not agent:
        return error('Agent not found', 404)
    return success(serialize_agent_detail(agent))


# POST /api/v1/agents
@bp.route('/agents', methods=['POST'])
@login_required
@require_write
def create_agent():
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}

    required = ['name', 'agent_type']
    missing = [f for f in required if not data.get(f)]
    if missing:
        return error(f'Missing required fields: {", ".join(missing)}', 400)

    valid_types = [t.value for t in AgentType]
    if data['agent_type'] not in valid_types:
        return error(f'Invalid agent_type. Must be one of: {", ".join(valid_types)}', 400)

    agent = Agent(
        institution_id=institution_id,
        name=data['name'],
        agent_type=AgentType(data['agent_type']),
        authorized_form=data.get('authorized_form'),
        description=data.get('description'),
        date_from=data.get('date_from'),
        date_to=data.get('date_to'),
        identifier=data.get('identifier'),
        website=data.get('website'),
        created_by_id=current_user.id,
    )
    db.session.add(agent)
    db.session.commit()
    return success(serialize_agent_detail(agent), 201)


# PATCH /api/v1/agents/<id>
@bp.route('/agents/<int:agent_id>', methods=['PATCH'])
@login_required
@require_write
def update_agent(agent_id):
    institution_id = current_user.active_institution_id
    agent = _get_agent_or_404(agent_id, institution_id)
    if not agent:
        return error('Agent not found', 404)

    data = request.get_json(silent=True) or {}
    updatable = ['name', 'authorized_form', 'description', 'date_from', 'date_to', 'identifier', 'website']
    for field in updatable:
        if field in data:
            setattr(agent, field, data[field])

    if 'agent_type' in data:
        valid_types = [t.value for t in AgentType]
        if data['agent_type'] not in valid_types:
            return error(f'Invalid agent_type. Must be one of: {", ".join(valid_types)}', 400)
        agent.agent_type = AgentType(data['agent_type'])

    db.session.commit()
    return success(serialize_agent_detail(agent))


# DELETE /api/v1/agents/<id>
@bp.route('/agents/<int:agent_id>', methods=['DELETE'])
@login_required
@require_write
def delete_agent(agent_id):
    institution_id = current_user.active_institution_id
    agent = _get_agent_or_404(agent_id, institution_id)
    if not agent:
        return error('Agent not found', 404)

    db.session.delete(agent)
    db.session.commit()
    return success({'message': 'Agent deleted'})


# ---------------------------------------------------------------------------
# Agent ↔ Node associations
# ---------------------------------------------------------------------------

# GET /api/v1/agents/<id>/nodes
@bp.route('/agents/<int:agent_id>/nodes', methods=['GET'])
@login_required
def get_agent_nodes(agent_id):
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    agent = _get_agent_or_404(agent_id, current_user.active_institution_id)
    if not agent:
        return error('Agent not found', 404)

    search = request.args.get('q', '').strip()
    nodes_q = agent.nodes
    if search:
        from app.models import Node
        nodes_q = nodes_q.filter(Node.title.ilike(f'%{search}%'))

    rows = db.session.execute(
        sa.select(agent_node_association.c.node_id, agent_node_association.c.relation_type)
        .where(agent_node_association.c.agent_id == agent_id)
    ).all()

    from app.models import Node
    result = []
    for node_id, rel_type in rows:
        node = Node.query.get(node_id)
        if node:
            stub = serialize_node_stub(node)
            stub['relation_type'] = rel_type
            result.append(stub)

    return success(result)


# POST /api/v1/agents/<id>/nodes
@bp.route('/agents/<int:agent_id>/nodes', methods=['POST'])
@login_required
@require_write
def add_agent_node(agent_id):
    institution_id = current_user.active_institution_id
    agent = _get_agent_or_404(agent_id, institution_id)
    if not agent:
        return error('Agent not found', 404)

    data = request.get_json(silent=True) or {}
    node_id = data.get('node_id')
    relation_type = data.get('relation_type')

    if not node_id or not relation_type:
        return error('node_id and relation_type are required', 400)

    from app.models import Node
    node = Node.query.filter_by(id=node_id, institution_id=institution_id).first()
    if not node:
        return error('Node not found', 404)

    existing = db.session.execute(
        sa.select(agent_node_association).where(
            agent_node_association.c.agent_id == agent_id,
            agent_node_association.c.node_id == node_id,
        )
    ).first()
    if existing:
        return error('Association already exists', 409)

    db.session.execute(
        agent_node_association.insert().values(
            agent_id=agent_id,
            node_id=node_id,
            relation_type=relation_type,
        )
    )
    db.session.commit()
    return success({'message': 'Association added'}, 201)


# DELETE /api/v1/agents/<id>/nodes/<node_id>
@bp.route('/agents/<int:agent_id>/nodes/<int:node_id>', methods=['DELETE'])
@login_required
@require_write
def remove_agent_node(agent_id, node_id):
    institution_id = current_user.active_institution_id
    agent = _get_agent_or_404(agent_id, institution_id)
    if not agent:
        return error('Agent not found', 404)

    db.session.execute(
        agent_node_association.delete().where(
            agent_node_association.c.agent_id == agent_id,
            agent_node_association.c.node_id == node_id,
        )
    )
    db.session.commit()
    return success({'message': 'Association removed'})


# ---------------------------------------------------------------------------
# Agent ↔ Agent relations
# ---------------------------------------------------------------------------

# POST /api/v1/agents/<id>/relations
@bp.route('/agents/<int:agent_id>/relations', methods=['POST'])
@login_required
@require_write
def add_agent_relation(agent_id):
    institution_id = current_user.active_institution_id
    agent = _get_agent_or_404(agent_id, institution_id)
    if not agent:
        return error('Agent not found', 404)

    data = request.get_json(silent=True) or {}
    target_id = data.get('target_id')
    relation_type = data.get('relation_type')

    if not target_id or not relation_type:
        return error('target_id and relation_type are required', 400)

    target = _get_agent_or_404(target_id, institution_id)
    if not target:
        return error('Target agent not found', 404)

    try:
        agent.add_relation(target, relation_type)
        db.session.commit()
    except ValueError as e:
        return error(str(e), 422)

    return success({'message': 'Relation added'}, 201)


# DELETE /api/v1/agents/<id>/relations/<target_id>
@bp.route('/agents/<int:agent_id>/relations/<int:target_id>', methods=['DELETE'])
@login_required
@require_write
def remove_agent_relation(agent_id, target_id):
    institution_id = current_user.active_institution_id
    agent = _get_agent_or_404(agent_id, institution_id)
    if not agent:
        return error('Agent not found', 404)

    target = _get_agent_or_404(target_id, institution_id)
    if not target:
        return error('Target agent not found', 404)

    agent.remove_relation(target)
    db.session.commit()
    return success({'message': 'Relation removed'})


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------

# POST /api/v1/agents/<id>/notes
@bp.route('/agents/<int:agent_id>/notes', methods=['POST'])
@login_required
@require_write
def add_agent_note(agent_id):
    institution_id = current_user.active_institution_id
    agent = _get_agent_or_404(agent_id, institution_id)
    if not agent:
        return error('Agent not found', 404)

    data = request.get_json(silent=True) or {}
    if not data.get('content'):
        return error('content is required', 400)

    note = AgentNote(
        agent_id=agent_id,
        note_type=data.get('note_type', 'general'),
        content=data['content'],
        created_by_id=current_user.id,
    )
    db.session.add(note)
    db.session.commit()
    return success(serialize_agent_note(note), 201)


# DELETE /api/v1/agents/<id>/notes/<note_id>
@bp.route('/agents/<int:agent_id>/notes/<int:note_id>', methods=['DELETE'])
@login_required
@require_write
def delete_agent_note(agent_id, note_id):
    institution_id = current_user.active_institution_id
    agent = _get_agent_or_404(agent_id, institution_id)
    if not agent:
        return error('Agent not found', 404)

    note = AgentNote.query.filter_by(id=note_id, agent_id=agent_id).first()
    if not note:
        return error('Note not found', 404)

    db.session.delete(note)
    db.session.commit()
    return success({'message': 'Note deleted'})


# ---------------------------------------------------------------------------
# Relation type admin
# ---------------------------------------------------------------------------

# GET /api/v1/agents/relation-types
@bp.route('/agents/relation-types', methods=['GET'])
@login_required
def list_relation_types():
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    types = AgentRelationType.query.filter_by(
        institution_id=current_user.active_institution_id
    ).order_by(AgentRelationType.name).all()
    return success([serialize_relation_type(t) for t in types])


# POST /api/v1/agents/relation-types
@bp.route('/agents/relation-types', methods=['POST'])
@login_required
@require_institution_admin
def create_relation_type():
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}

    if not data.get('name'):
        return error('name is required', 400)

    is_symmetric = data.get('is_symmetric', True)

    rt = AgentRelationType(
        institution_id=institution_id,
        name=data['name'],
        description=data.get('description'),
        is_symmetric=is_symmetric,
    )
    db.session.add(rt)
    db.session.flush()

    if not is_symmetric and data.get('complementary_name'):
        complement = AgentRelationType(
            institution_id=institution_id,
            name=data['complementary_name'],
            description=data.get('complementary_description'),
            is_symmetric=False,
            complementary_id=rt.id,
        )
        db.session.add(complement)
        db.session.flush()
        rt.complementary_id = complement.id

    db.session.commit()
    return success(serialize_relation_type(rt), 201)


# DELETE /api/v1/agents/relation-types/<id>
@bp.route('/agents/relation-types/<int:type_id>', methods=['DELETE'])
@login_required
@require_institution_admin
def delete_relation_type(type_id):
    institution_id = current_user.active_institution_id
    rt = AgentRelationType.query.filter_by(id=type_id, institution_id=institution_id).first()
    if not rt:
        return error('Relation type not found', 404)

    if rt.complementary:
        db.session.delete(rt.complementary)
    db.session.delete(rt)
    db.session.commit()
    return success({'message': 'Relation type deleted'})


# GET /api/v1/agents/node-relation-types
@bp.route('/agents/node-relation-types', methods=['GET'])
@login_required
def list_node_relation_types():
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    types = AgentNodeRelationType.query.filter_by(
        institution_id=current_user.active_institution_id
    ).order_by(AgentNodeRelationType.name).all()
    return success([serialize_node_relation_type(t) for t in types])


# POST /api/v1/agents/node-relation-types
@bp.route('/agents/node-relation-types', methods=['POST'])
@login_required
@require_institution_admin
def create_node_relation_type():
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}

    if not data.get('name'):
        return error('name is required', 400)

    rt = AgentNodeRelationType(
        institution_id=institution_id,
        name=data['name'],
        description=data.get('description'),
    )
    db.session.add(rt)
    db.session.commit()
    return success(serialize_node_relation_type(rt), 201)


# PATCH /api/v1/agents/relation-types/<id>
@bp.route('/agents/relation-types/<int:type_id>', methods=['PATCH'])
@login_required
@require_institution_admin
def update_relation_type(type_id):
    institution_id = current_user.active_institution_id
    rt = AgentRelationType.query.filter_by(id=type_id, institution_id=institution_id).first()
    if not rt:
        return error('Relation type not found', 404)
    data = request.get_json(silent=True) or {}
    if 'name' in data:
        rt.name = data['name']
    if 'description' in data:
        rt.description = data['description']
    if 'is_symmetric' in data:
        rt.is_symmetric = data['is_symmetric']
    if 'complementary_name' in data and data['complementary_name']:
        if rt.complementary:
            rt.complementary.name = data['complementary_name']
        else:
            from app.models import AgentRelationType as ART
            comp = ART(
                institution_id=rt.institution_id,
                name=data['complementary_name'],
                is_symmetric=False,
                complementary_id=rt.id,
            )
            db.session.add(comp)
            db.session.flush()
            rt.complementary_id = comp.id
    db.session.commit()
    return success(serialize_relation_type(rt))


# PATCH /api/v1/agents/node-relation-types/<id>
@bp.route('/agents/node-relation-types/<int:type_id>', methods=['PATCH'])
@login_required
@require_institution_admin
def update_node_relation_type(type_id):
    institution_id = current_user.active_institution_id
    rt = AgentNodeRelationType.query.filter_by(id=type_id, institution_id=institution_id).first()
    if not rt:
        return error('Relation type not found', 404)
    data = request.get_json(silent=True) or {}
    if 'name' in data:
        rt.name = data['name']
    if 'description' in data:
        rt.description = data['description']
    if 'is_symmetric' in data:
        rt.is_symmetric = data['is_symmetric']
    if 'complementary_name' in data and data['complementary_name']:
        if rt.complementary:
            rt.complementary.name = data['complementary_name']
        else:
            comp = AgentNodeRelationType(
                institution_id=institution_id,
                name=data['complementary_name'],
                is_symmetric=False,
                complementary_id=rt.id,
            )
            db.session.add(comp)
            db.session.flush()
            rt.complementary_id = comp.id
    db.session.commit()
    return success(serialize_node_relation_type(rt))


# DELETE /api/v1/agents/node-relation-types/<id>
@bp.route('/agents/node-relation-types/<int:type_id>', methods=['DELETE'])
@login_required
@require_institution_admin
def delete_node_relation_type(type_id):
    institution_id = current_user.active_institution_id
    rt = AgentNodeRelationType.query.filter_by(id=type_id, institution_id=institution_id).first()
    if not rt:
        return error('Relation type not found', 404)
    db.session.delete(rt)
    db.session.commit()
    return success({'message': 'Deleted'})


# POST /api/v1/agents/import/eaccpf
@bp.route('/agents/import/eaccpf', methods=['POST'])
@login_required
@require_write
def import_eaccpf():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    if 'file' not in request.files:
        return error('No file uploaded', 400)

    f = request.files['file']
    if not f.filename or not f.filename.lower().endswith('.xml'):
        return error('File must be an XML file (.xml)', 400)

    update_existing = request.form.get('update_existing', 'false').lower() == 'true'

    from app.eaccpf.parser import parse_file
    from app.eaccpf.importer import agents_from_eaccpf

    try:
        parse_result = parse_file(f.read())
    except Exception as e:
        return error(f'Failed to parse EAC-CPF file: {e}', 400)

    if not parse_result.agents and parse_result.warnings:
        return error(f'No agents found. {parse_result.warnings[0]}', 422)

    try:
        import_result = agents_from_eaccpf(
            parse_result=parse_result,
            institution_id=institution_id,
            created_by_id=current_user.id,
            update_existing=update_existing,
        )
    except Exception as e:
        return error(f'Import failed: {e}', 500)

    return success(import_result.to_dict(), 201)


# ── Places ─────────────────────────────────────────────────────────────

def _get_agent(agent_id: int) -> 'Agent | None':
    return Agent.query.filter_by(
        id=agent_id, institution_id=current_user.active_institution_id
    ).first()


@bp.route('/agents/<int:agent_id>/places', methods=['GET'])
@login_required
def get_agent_places(agent_id):
    agent = _get_agent(agent_id)
    if not agent:
        return error('Agent not found', 404)
    return success([p.to_dict() for p in agent.places])


@bp.route('/agents/<int:agent_id>/places', methods=['POST'])
@login_required
@require_write
def add_agent_place(agent_id):
    agent = _get_agent(agent_id)
    if not agent:
        return error('Agent not found', 404)
    data = request.get_json(silent=True) or {}
    if not data.get('name') or not data.get('place_type'):
        return error('name and place_type are required', 400)
    from app.models.geo import AgentPlace
    place = AgentPlace(
        agent_id=agent_id,
        place_type=data['place_type'],
        name=data['name'],
        wikidata_id=data.get('wikidata_id'),
        lat=data.get('lat'),
        lon=data.get('lon'),
        note=data.get('note'),
        date_from=data.get('date_from'),
        date_to=data.get('date_to'),
        sort_order=data.get('sort_order', 0),
    )
    db.session.add(place)
    db.session.commit()
    return success(place.to_dict(), 201)


@bp.route('/agents/<int:agent_id>/places/<int:place_id>', methods=['PATCH'])
@login_required
@require_write
def update_agent_place(agent_id, place_id):
    from app.models.geo import AgentPlace
    place = AgentPlace.query.filter_by(id=place_id, agent_id=agent_id).first()
    if not place:
        return error('Place not found', 404)
    data = request.get_json(silent=True) or {}
    for field in ('place_type', 'name', 'wikidata_id', 'lat', 'lon', 'note', 'date_from', 'date_to', 'sort_order'):
        if field in data:
            setattr(place, field, data[field])
    db.session.commit()
    return success(place.to_dict())


@bp.route('/agents/<int:agent_id>/places/<int:place_id>', methods=['DELETE'])
@login_required
@require_write
def delete_agent_place(agent_id, place_id):
    from app.models.geo import AgentPlace
    place = AgentPlace.query.filter_by(id=place_id, agent_id=agent_id).first()
    if not place:
        return error('Place not found', 404)
    db.session.delete(place)
    db.session.commit()
    return success({'message': 'Deleted'})


# ── Tags ───────────────────────────────────────────────────────────────

@bp.route('/agents/<int:agent_id>/tags', methods=['GET'])
@login_required
def get_agent_tags(agent_id):
    agent = _get_agent(agent_id)
    if not agent:
        return error('Agent not found', 404)
    return success([t.to_dict() for t in agent.tags])


@bp.route('/agents/<int:agent_id>/tags', methods=['POST'])
@login_required
@require_write
def add_agent_tag(agent_id):
    institution_id = current_user.active_institution_id
    agent = _get_agent(agent_id)
    if not agent:
        return error('Agent not found', 404)
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return error('name is required', 400)
    from app.models.geo import Tag
    import sqlalchemy as sa
    tag = Tag.query.filter(
        Tag.institution_id == institution_id,
        sa.func.lower(Tag.name) == name.lower()
    ).first()
    if not tag:
        tag = Tag(institution_id=institution_id, name=name, category=data.get('category'))
        db.session.add(tag)
        db.session.flush()
    if tag not in agent.tags:
        agent.tags.append(tag)
    db.session.commit()
    return success(tag.to_dict(), 201)


@bp.route('/agents/<int:agent_id>/tags/<int:tag_id>', methods=['DELETE'])
@login_required
@require_write
def remove_agent_tag(agent_id, tag_id):
    institution_id = current_user.active_institution_id
    agent = _get_agent(agent_id)
    if not agent:
        return error('Agent not found', 404)
    from app.models.geo import Tag
    tag = Tag.query.filter_by(id=tag_id, institution_id=institution_id).first()
    if tag and tag in agent.tags:
        agent.tags.remove(tag)
        db.session.commit()
    return success({'message': 'Removed'})