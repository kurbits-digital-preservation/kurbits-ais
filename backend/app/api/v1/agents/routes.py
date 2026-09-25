import os
import uuid

import sqlalchemy as sa
from flask import request, current_app, send_from_directory, Response
from flask_login import login_required, current_user
from werkzeug.utils import secure_filename

from app.api.v1 import bp
from app.api.v1.helpers import success, error, require_write, require_institution_admin
from app.api.v1.agents.serializers import (
    serialize_agent_stub, serialize_agent_detail,
    serialize_agent_note, serialize_relation_type, serialize_node_relation_type
)
from app.api.v1.nodes.serializers import serialize_node_stub
from app.api.v1.nodes.routes import MIME_MAP, _allowed_file
from app.extensions import db
from app.models import Agent, AgentType, AgentRelationType, AgentNodeRelationType, AgentNote
from app.models.agent import agent_node_association, AgentIdentifier, AgentAttachment
from app.models.node import IdentifierScheme, NodeIdentifier, Node
from app.eaccpf.exporter import export_agent_eac


def _get_agent_or_404(agent_id: int, institution_id: int):
    return Agent.query.filter_by(id=agent_id, institution_id=institution_id).first()


@bp.route('/agents', methods=['GET'])
@login_required
def list_agents():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 25, type=int), 200)
    search = request.args.get('q', '').strip()
    type_filter = request.args.get('type')
    has_website = request.args.get('has_website')
    has_identifier = request.args.get('has_identifier')
    has_description = request.args.get('has_description')
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')

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
    if has_website == 'true':
        query = query.where(Agent.website.isnot(None), Agent.website != '')
    if has_website == 'false':
        query = query.where(sa.or_(Agent.website.is_(None), Agent.website == ''))
    if has_identifier == 'true':
        query = query.where(Agent.identifier.isnot(None), Agent.identifier != '')
    if has_identifier == 'false':
        query = query.where(sa.or_(Agent.identifier.is_(None), Agent.identifier == ''))
    if has_description == 'true':
        query = query.where(Agent.description.isnot(None), Agent.description != '')
    if has_description == 'false':
        query = query.where(sa.or_(Agent.description.is_(None), Agent.description == ''))
    if date_from:
        query = query.where(Agent.date_from >= date_from)
    if date_to:
        query = query.where(sa.or_(Agent.date_to <= date_to, Agent.date_to.is_(None)))

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


@bp.route('/agents/<int:agent_id>', methods=['GET'])
@login_required
def get_agent(agent_id):
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    agent = _get_agent_or_404(agent_id, current_user.active_institution_id)
    if not agent:
        return error('Agent not found', 404)
    return success(serialize_agent_detail(agent))


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
        nodes_q = nodes_q.filter(Node.title.ilike(f'%{search}%'))

    rows = db.session.execute(
        sa.select(agent_node_association.c.node_id, agent_node_association.c.relation_type)
        .where(agent_node_association.c.agent_id == agent_id)
    ).all()

    result = []
    for node_id, rel_type in rows:
        node = Node.query.get(node_id)
        if node:
            stub = serialize_node_stub(node)
            stub['relation_type'] = rel_type
            result.append(stub)

    return success(result)


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


@bp.route('/agents/relation-types', methods=['GET'])
@login_required
def list_relation_types():
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    types = AgentRelationType.query.filter_by(
        institution_id=current_user.active_institution_id
    ).order_by(AgentRelationType.name).all()
    return success([serialize_relation_type(t) for t in types])


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
            comp = AgentRelationType(
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


@bp.route('/agents/node-relation-types', methods=['GET'])
@login_required
def list_node_relation_types():
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    types = AgentNodeRelationType.query.filter_by(
        institution_id=current_user.active_institution_id
    ).order_by(AgentNodeRelationType.name).all()
    return success([serialize_node_relation_type(t) for t in types])


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


@bp.route('/agents/<int:agent_id>/export/eac', methods=['GET'])
@login_required
def export_agent_eaccpf(agent_id):
    institution_id = current_user.active_institution_id
    agent = Agent.query.filter_by(id=agent_id, institution_id=institution_id).first()
    if not agent:
        return error('Agent not found', 404)

    rows = db.session.execute(
        sa.select(agent_node_association.c.node_id, agent_node_association.c.relation_type)
        .where(agent_node_association.c.agent_id == agent_id)
    ).all()
    resource_links = []
    for node_id, relation_type in rows:
        node = Node.query.get(node_id)
        if node:
            resource_links.append({
                'ref_code': node.ref_code or node.local_ref,
                'title': node.title,
                'relation_type': relation_type,
            })
    agent.resource_links = resource_links

    institution = agent.institution if hasattr(agent, 'institution') else None
    xml = export_agent_eac(agent, institution)

    safe_name = (agent.authorized_form or agent.name or f'agent-{agent_id}')
    safe_name = ''.join(c if c.isalnum() or c in '-_ ' else '_' for c in safe_name).strip()[:80]

    return Response(
        xml,
        mimetype='application/xml',
        headers={
            'Content-Disposition': f'attachment; filename="{safe_name or f"agent-{agent_id}"}.eac.xml"'
        },
    )


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


@bp.route('/agents/<int:agent_id>/identifiers', methods=['GET'])
@login_required
def list_agent_identifiers(agent_id):
    institution_id = current_user.active_institution_id
    agent = _get_agent_or_404(agent_id, institution_id)
    if not agent:
        return error('Agent not found', 404)
    return success([i.to_dict() for i in agent.identifiers])


@bp.route('/agents/<int:agent_id>/identifiers', methods=['POST'])
@login_required
@require_write
def add_agent_identifier(agent_id):
    institution_id = current_user.active_institution_id
    agent = _get_agent_or_404(agent_id, institution_id)
    if not agent:
        return error('Agent not found', 404)

    data = request.get_json(silent=True) or {}
    scheme_id = data.get('scheme_id')
    value = (data.get('value') or '').strip()
    if not scheme_id:
        return error('scheme_id is required', 400)
    if not value:
        return error('value is required', 400)

    scheme = IdentifierScheme.query.filter_by(
        id=scheme_id, institution_id=institution_id).first()
    if not scheme:
        return error('Identifier scheme not found', 404)

    clash_agent = AgentIdentifier.query.filter_by(scheme_id=scheme_id, value=value).first()
    clash_node = NodeIdentifier.query.filter_by(scheme_id=scheme_id, value=value).first()
    if clash_agent or clash_node:
        return error(
            f'That {scheme.name} identifier is already used by another record.', 409)

    make_primary = data.get('is_primary', False)
    if make_primary:
        for existing in agent.identifiers:
            if existing.scheme_id == scheme_id:
                existing.is_primary = False

    ident = AgentIdentifier(
        agent_id=agent_id,
        scheme_id=scheme_id,
        value=value,
        is_primary=make_primary,
        note=data.get('note'),
        created_by_id=current_user.id,
    )
    db.session.add(ident)
    db.session.commit()
    return success(ident.to_dict(), 201)


@bp.route('/agents/<int:agent_id>/identifiers/<int:ident_id>', methods=['PATCH'])
@login_required
@require_write
def update_agent_identifier(agent_id, ident_id):
    institution_id = current_user.active_institution_id
    agent = _get_agent_or_404(agent_id, institution_id)
    if not agent:
        return error('Agent not found', 404)

    ident = AgentIdentifier.query.filter_by(id=ident_id, agent_id=agent_id).first()
    if not ident:
        return error('Identifier not found', 404)

    data = request.get_json(silent=True) or {}

    if 'value' in data:
        new_value = (data['value'] or '').strip()
        if not new_value:
            return error('value cannot be empty', 400)
        if new_value != ident.value:
            clash = (AgentIdentifier.query.filter_by(scheme_id=ident.scheme_id, value=new_value).first()
                     or NodeIdentifier.query.filter_by(scheme_id=ident.scheme_id, value=new_value).first())
            if clash:
                return error('That identifier value is already in use.', 409)
        ident.value = new_value

    if 'note' in data:
        ident.note = data['note']

    if data.get('is_primary'):
        for existing in agent.identifiers:
            if existing.scheme_id == ident.scheme_id and existing.id != ident.id:
                existing.is_primary = False
        ident.is_primary = True
    elif 'is_primary' in data and not data['is_primary']:
        ident.is_primary = False

    db.session.commit()
    return success(ident.to_dict())


@bp.route('/agents/<int:agent_id>/identifiers/<int:ident_id>', methods=['DELETE'])
@login_required
@require_write
def delete_agent_identifier(agent_id, ident_id):
    institution_id = current_user.active_institution_id
    agent = _get_agent_or_404(agent_id, institution_id)
    if not agent:
        return error('Agent not found', 404)

    ident = AgentIdentifier.query.filter_by(id=ident_id, agent_id=agent_id).first()
    if not ident:
        return error('Identifier not found', 404)

    db.session.delete(ident)
    db.session.commit()
    return success({'message': 'Identifier deleted'})


@bp.route('/agents/<int:agent_id>/attachments', methods=['GET'])
@login_required
def list_agent_attachments(agent_id):
    institution_id = current_user.active_institution_id
    agent = _get_agent_or_404(agent_id, institution_id)
    if not agent:
        return error('Agent not found', 404)
    return success([a.to_dict() for a in agent.attachments])


@bp.route('/agents/<int:agent_id>/attachments', methods=['POST'])
@login_required
@require_write
def upload_agent_attachment(agent_id):
    institution_id = current_user.active_institution_id
    agent = _get_agent_or_404(agent_id, institution_id)
    if not agent:
        return error('Agent not found', 404)

    if 'file' not in request.files:
        return error('No file provided', 400)

    file = request.files['file']
    if not file.filename:
        return error('No file selected', 400)

    if not _allowed_file(file.filename):
        return error('File type not allowed. Supported: ' + ', '.join(sorted(MIME_MAP.keys())), 400)

    original_filename = secure_filename(file.filename)
    stored_filename = f'{uuid.uuid4().hex}_{original_filename}'

    upload_dir = os.path.join(
        current_app.config['UPLOAD_FOLDER'], str(institution_id), 'agents', str(agent_id))
    os.makedirs(upload_dir, exist_ok=True)

    file_path = os.path.join(upload_dir, stored_filename)
    file.save(file_path)
    file_size = os.path.getsize(file_path)

    ext = original_filename.rsplit('.', 1)[1].lower() if '.' in original_filename else ''
    mime_type = MIME_MAP.get(ext, 'application/octet-stream')

    attachment = AgentAttachment(
        agent_id=agent_id,
        filename=stored_filename,
        original_filename=original_filename,
        file_size=file_size,
        mime_type=mime_type,
        description=request.form.get('description'),
        uploaded_by_id=current_user.id,
    )
    db.session.add(attachment)
    db.session.commit()
    return success(attachment.to_dict(), 201)


@bp.route('/agents/<int:agent_id>/attachments/<int:attachment_id>/download', methods=['GET'])
@login_required
def download_agent_attachment(agent_id, attachment_id):
    institution_id = current_user.active_institution_id
    agent = _get_agent_or_404(agent_id, institution_id)
    if not agent:
        return error('Agent not found', 404)

    attachment = AgentAttachment.query.filter_by(id=attachment_id, agent_id=agent_id).first()
    if not attachment:
        return error('Attachment not found', 404)

    upload_dir = os.path.join(
        current_app.config['UPLOAD_FOLDER'], str(institution_id), 'agents', str(agent_id))
    INLINE_TYPES = {'image/png', 'image/jpeg', 'image/gif', 'image/webp',
                     'image/tiff', 'application/pdf', 'text/plain', 'text/markdown', 'text/csv'}
    as_attachment = attachment.mime_type not in INLINE_TYPES
    return send_from_directory(
        upload_dir, attachment.filename,
        download_name=attachment.original_filename,
        as_attachment=as_attachment,
        mimetype=attachment.mime_type,
    )


@bp.route('/agents/<int:agent_id>/attachments/<int:attachment_id>', methods=['DELETE'])
@login_required
@require_write
def delete_agent_attachment(agent_id, attachment_id):
    institution_id = current_user.active_institution_id
    agent = _get_agent_or_404(agent_id, institution_id)
    if not agent:
        return error('Agent not found', 404)

    attachment = AgentAttachment.query.filter_by(id=attachment_id, agent_id=agent_id).first()
    if not attachment:
        return error('Attachment not found', 404)

    upload_dir = os.path.join(
        current_app.config['UPLOAD_FOLDER'], str(institution_id), 'agents', str(agent_id))
    file_path = os.path.join(upload_dir, attachment.filename)
    if os.path.exists(file_path):
        os.remove(file_path)

    db.session.delete(attachment)
    db.session.commit()
    return success({'message': 'Attachment deleted'})