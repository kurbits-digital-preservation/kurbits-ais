import os
import uuid
from datetime import datetime
from flask import request, current_app, send_from_directory
from flask_login import login_required, current_user
from werkzeug.utils import secure_filename

from app.api.v1 import bp
from app.api.v1.helpers import success, error, require_write
from app.api.v1.nodes.serializers import (
    serialize_node_stub, serialize_node_detail, serialize_change,
    serialize_attachment, serialize_note
)
from app.extensions import db
from app.models import Node, NodeStatus, NodeChange, NodeAttachment, NodeNote
from app.models.node import node_association
import sqlalchemy as sa


def _get_node_or_404(node_id: int, institution_id: int):
    node = Node.query.filter_by(id=node_id, institution_id=institution_id).first()
    if not node:
        return None
    return node


# ---------------------------------------------------------------------------
# Tree
# ---------------------------------------------------------------------------

# GET /api/v1/nodes/tree
# Returns root nodes with stub data. Frontend fetches children on expand.
@bp.route('/nodes/tree', methods=['GET'])
@login_required
def get_tree():
    if not current_user.active_institution_id:
        return error('No active institution', 400)

    institution_id = current_user.active_institution_id
    include_drafts = request.args.get('include_drafts', 'true').lower() == 'true'

    query = sa.select(Node).where(
        Node.institution_id == institution_id,
        Node.parent_id.is_(None)
    )
    if not include_drafts:
        query = query.where(Node.status == NodeStatus.PUBLISHED)

    roots = db.session.execute(query.order_by(Node.ref_code)).scalars().all()
    return success([serialize_node_stub(n) for n in roots])


# GET /api/v1/nodes/<id>/children
@bp.route('/nodes/<int:node_id>/children', methods=['GET'])
@login_required
def get_children(node_id):
    if not current_user.active_institution_id:
        return error('No active institution', 400)

    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    include_drafts = request.args.get('include_drafts', 'true').lower() == 'true'
    children_q = node.children.order_by(Node.local_ref)

    if not include_drafts:
        children_q = children_q.filter(Node.status == NodeStatus.PUBLISHED)

    return success([serialize_node_stub(c) for c in children_q])


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

# GET /api/v1/nodes
@bp.route('/nodes', methods=['GET'])
@login_required
def list_nodes():
    if not current_user.active_institution_id:
        return error('No active institution', 400)

    institution_id = current_user.active_institution_id
    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 25, type=int), 100)
    search = request.args.get('q', '').strip()
    status_filter = request.args.get('status')
    level_filter = request.args.get('level')
    hierarchy_type_id = request.args.get('hierarchy_type_id', type=int)
    has_scope_note = request.args.get('has_scope_note')
    has_agents = request.args.get('has_agents')
    has_attachments = request.args.get('has_attachments')
    has_description = request.args.get('has_description')
    no_date = request.args.get('no_date')

    query = sa.select(Node).where(Node.institution_id == institution_id)

    if search:
        query = query.where(
            sa.or_(
                Node.title.ilike(f'%{search}%'),
                Node.ref_code.ilike(f'%{search}%'),
                Node.description.ilike(f'%{search}%'),
            )
        )
    if status_filter:
        query = query.where(Node.status == status_filter)
    if level_filter:
        query = query.where(sa.func.lower(Node.level_of_description) == level_filter.lower())
    if hierarchy_type_id:
        query = query.where(Node.hierarchy_type_id == hierarchy_type_id)

    if has_scope_note == 'true':
        query = query.where(Node.scope_and_content.isnot(None), Node.scope_and_content != '')
    if has_scope_note == 'false':
        query = query.where(sa.or_(Node.scope_and_content.is_(None), Node.scope_and_content == ''))
    if has_description == 'true':
        query = query.where(Node.description.isnot(None), Node.description != '')
    if has_description == 'false':
        query = query.where(sa.or_(Node.description.is_(None), Node.description == ''))
    if has_agents == 'true':
        from app.models.agent import agent_node_association as ana
        query = query.where(
            sa.exists(sa.select(ana.c.node_id).where(ana.c.node_id == Node.id))
        )
    if has_attachments == 'true':
        from app.models.node import NodeAttachment
        query = query.where(
            sa.exists(sa.select(NodeAttachment.id).where(NodeAttachment.node_id == Node.id))
        )
    if no_date == 'true':
        query = query.where(Node.date_start.is_(None), Node.date_end.is_(None))

    parent_id_filter = request.args.get('parent_id', type=int)
    if parent_id_filter is not None:
        query = query.where(Node.parent_id == parent_id_filter)

    query = query.order_by(Node.ref_code)
    paginated = db.paginate(query, page=page, per_page=per_page, error_out=False)

    return success(
        [serialize_node_stub(n) for n in paginated.items],
        meta={
            'page': paginated.page,
            'per_page': per_page,
            'total': paginated.total,
            'pages': paginated.pages,
        }
    )


# GET /api/v1/nodes/<id>
@bp.route('/nodes/<int:node_id>', methods=['GET'])
@login_required
def get_node(node_id):
    if not current_user.active_institution_id:
        return error('No active institution', 400)

    node = _get_node_or_404(node_id, current_user.active_institution_id)
    if not node:
        return error('Node not found', 404)

    return success(serialize_node_detail(node))


# POST /api/v1/nodes
@bp.route('/nodes', methods=['POST'])
@login_required
@require_write
def create_node():
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}

    required = ['title', 'local_ref', 'level_of_description', 'hierarchy_type_id']
    missing = [f for f in required if not data.get(f)]
    if missing:
        return error(f'Missing required fields: {", ".join(missing)}', 400)

    parent = None
    if data.get('parent_id'):
        parent = _get_node_or_404(data['parent_id'], institution_id)
        if not parent:
            return error('Parent node not found', 404)

    node = Node(
        institution_id=institution_id,
        title=data['title'],
        local_ref=data['local_ref'],
        level_of_description=data['level_of_description'],
        hierarchy_type_id=data['hierarchy_type_id'],
        parent=parent,
        description=data.get('description'),
        scope_and_content=data.get('scope_and_content'),
        arrangement=data.get('arrangement'),
        access_conditions=data.get('access_conditions'),
        reproduction_conditions=data.get('reproduction_conditions'),
        language=data.get('language'),
        finding_aids=data.get('finding_aids'),
        extent=data.get('extent'),
        date_certainty=data.get('date_certainty'),
        metadata_spec=data.get('metadata_spec', {}),
        status=NodeStatus.DRAFT,
        created_by_id=current_user.id,
        updated_by_id=current_user.id,
    )

    if data.get('date_start'):
        try:
            node.date_start = datetime.strptime(data['date_start'], '%Y-%m-%d').date()
        except ValueError:
            return error('Invalid date_start format. Use YYYY-MM-DD', 400)

    if data.get('date_end'):
        try:
            node.date_end = datetime.strptime(data['date_end'], '%Y-%m-%d').date()
        except ValueError:
            return error('Invalid date_end format. Use YYYY-MM-DD', 400)

    # Compute ref_code before flush — load institution explicitly since
    # the relationship isn't populated until after a flush
    from app.models import Institution
    institution = Institution.query.get(institution_id)
    if parent:
        node.ref_code = f'{parent.ref_code}/{data["local_ref"]}'
    else:
        node.ref_code = f'{institution.ref_prefix}/{data["local_ref"]}'

    db.session.add(node)
    db.session.flush()

    if not node.validate_hierarchy():
        db.session.rollback()
        return error(
            f'Invalid hierarchy: "{node.level_of_description}" is not allowed at this position', 422
        )

    node.record_change(
        change_type='create',
        description=f'Created node "{node.title}"',
        created_by_id=current_user.id,
        before_data={},
        after_data=node.to_dict(),
    )

    db.session.commit()
    return success(serialize_node_detail(node), 201)


# PATCH /api/v1/nodes/<id>
@bp.route('/nodes/<int:node_id>', methods=['PATCH'])
@login_required
@require_write
def update_node(node_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    data = request.get_json(silent=True) or {}
    before_data = node.to_dict()

    updatable_fields = [
        'title', 'description', 'scope_and_content', 'arrangement',
        'access_conditions', 'reproduction_conditions', 'language',
        'finding_aids', 'extent', 'date_certainty', 'metadata_spec',
    ]
    for field in updatable_fields:
        if field in data:
            setattr(node, field, data[field])

    if 'date_start' in data:
        if data['date_start']:
            try:
                node.date_start = datetime.strptime(data['date_start'], '%Y-%m-%d').date()
            except ValueError:
                return error('Invalid date_start format. Use YYYY-MM-DD', 400)
        else:
            node.date_start = None

    if 'date_end' in data:
        if data['date_end']:
            try:
                node.date_end = datetime.strptime(data['date_end'], '%Y-%m-%d').date()
            except ValueError:
                return error('Invalid date_end format. Use YYYY-MM-DD', 400)
        else:
            node.date_end = None

    if 'level_of_description' in data and data['level_of_description'] != node.level_of_description:
        old_level = node.level_of_description
        node.level_of_description = data['level_of_description']
        if not node.validate_hierarchy():
            node.level_of_description = old_level
            return error(f'Invalid hierarchy: cannot change level to "{data["level_of_description"]}"', 422)

    if 'local_ref' in data and data['local_ref'] != node.local_ref:
        node.local_ref = data['local_ref']
        node.refresh_ref_code()

    node.updated_by_id = current_user.id
    after_data = node.to_dict()

    if before_data != after_data:
        changed_fields = [k for k in after_data if after_data[k] != before_data.get(k)]
        node.record_change(
            change_type='edit',
            description=f'Updated: {", ".join(changed_fields)}',
            created_by_id=current_user.id,
            before_data=before_data,
            after_data=after_data,
        )

    db.session.commit()
    return success(serialize_node_detail(node))


# DELETE /api/v1/nodes/<id>
@bp.route('/nodes/<int:node_id>', methods=['DELETE'])
@login_required
@require_write
def delete_node(node_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    if node.children.count() > 0:
        return error('Cannot delete a node that has children. Delete or move children first.', 409)

    db.session.delete(node)
    db.session.commit()
    return success({'message': 'Node deleted'})


# POST /api/v1/nodes/bulk-move
@bp.route('/nodes/bulk-move', methods=['POST'])
@login_required
@require_write
def bulk_move_nodes():
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}
    node_ids = data.get('node_ids', [])
    parent_id = data.get('parent_id', None)

    if not node_ids:
        return error('node_ids is required', 400)

    target = None
    if parent_id is not None:
        target = _get_node_or_404(parent_id, institution_id)
        if not target:
            return error('Target node not found', 404)

    moved = []
    errors = []
    for nid in node_ids:
        node = _get_node_or_404(nid, institution_id)
        if not node:
            errors.append({'id': nid, 'error': 'Not found'})
            continue
        if parent_id is not None:
            ancestor = target
            while ancestor:
                if ancestor.id == nid:
                    errors.append({'id': nid, 'error': 'Cannot move node into itself or a descendant'})
                    break
                ancestor = ancestor.parent
            else:
                node.parent_id = parent_id
                _refresh_subtree_refs(node)
                moved.append(nid)
        else:
            node.parent_id = None
            _refresh_subtree_refs(node)
            moved.append(nid)

    db.session.commit()
    return success({'moved': moved, 'errors': errors})


# POST /api/v1/nodes/bulk-delete
@bp.route('/nodes/bulk-delete', methods=['POST'])
@login_required
@require_write
def bulk_delete_nodes():
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}
    node_ids = data.get('node_ids', [])
    force = bool(data.get('force', False))

    if not node_ids:
        return error('node_ids is required', 400)

    deleted = []
    errors = []
    for nid in node_ids:
        node = _get_node_or_404(nid, institution_id)
        if not node:
            errors.append({'id': nid, 'error': 'Not found'})
            continue
        if not force and node.children.count() > 0:
            errors.append({'id': nid, 'error': f'"{node.title or node.ref_code}" has children — use force delete to remove with all descendants'})
            continue
        db.session.delete(node)
        deleted.append(nid)

    db.session.commit()
    return success({'deleted': deleted, 'errors': errors})


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

# PATCH /api/v1/nodes/<id>/status
@bp.route('/nodes/<int:node_id>/status', methods=['PATCH'])
@login_required
@require_write
def update_status(node_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    data = request.get_json(silent=True) or {}
    new_status = data.get('status')

    valid = [s.value for s in NodeStatus]
    if new_status not in valid:
        return error(f'Invalid status. Must be one of: {", ".join(valid)}', 400)

    before_data = node.to_dict()
    node.status = NodeStatus(new_status)
    node.updated_by_id = current_user.id

    node.record_change(
        change_type='status_change',
        description=f'Status changed to {new_status}',
        created_by_id=current_user.id,
        before_data=before_data,
        after_data=node.to_dict(),
    )
    db.session.commit()
    return success({'status': node.status.value})


# ---------------------------------------------------------------------------
# Move
# ---------------------------------------------------------------------------

def _refresh_subtree_refs(node: 'Node') -> None:
    """Recursively recompute ref_codes for a node and all its descendants."""
    node.refresh_ref_code()
    for child in node.children.all():
        _refresh_subtree_refs(child)


# PATCH /api/v1/nodes/<id>/move
@bp.route('/nodes/<int:node_id>/move', methods=['PATCH'])
@login_required
@require_write
def move_node(node_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    data = request.get_json(silent=True) or {}
    new_parent_id = data.get('parent_id')  # None = move to root

    before_data = node.to_dict()
    old_parent_title = node.parent.title if node.parent else 'root'

    if new_parent_id:
        new_parent = _get_node_or_404(new_parent_id, institution_id)
        if not new_parent:
            return error('Target parent node not found', 404)

        # Prevent moving into own descendant
        if new_parent.is_descendant_of(node):
            return error('Cannot move a node into its own descendant', 422)

        # Prevent moving into a different hierarchy type
        if new_parent.hierarchy_type_id != node.hierarchy_type_id:
            return error('Cannot move a node into a different hierarchy type', 422)

        # Prevent fonds-level nodes from being placed under other fonds
        # (a root-level node should stay root-level or go under a non-root)
        if node.parent_id is None:
            # Node is currently a root — only allow if target parent is also root
            # i.e. don't allow moving a fonds under another fonds
            if new_parent.parent_id is None:
                return error(
                    f'Cannot move "{node.title}" under another top-level node. '
                    f'Top-level records must remain at the root or be moved under a sub-level.',
                    422
                )

        node.parent = new_parent
    else:
        node.parent = None

    # Validate hierarchy rules at new position.
    # Use no_autoflush to prevent SQLAlchemy flushing the parent change
    # before validate_hierarchy finishes (which would trigger the unique constraint).
    with db.session.no_autoflush:
        valid = node.validate_hierarchy()
    if not valid:
        db.session.rollback()
        return error(
            f'Move not allowed: "{node.level_of_description}" cannot be placed here '
            f'according to hierarchy rules.',
            422
        )

    # Cascade ref_code updates to the whole subtree
    _refresh_subtree_refs(node)

    node.updated_by_id = current_user.id
    new_parent_title = node.parent.title if node.parent else 'root'
    node.record_change(
        change_type='move',
        description=f'Moved from "{old_parent_title}" to "{new_parent_title}"',
        created_by_id=current_user.id,
        before_data=before_data,
        after_data=node.to_dict(),
    )
    db.session.commit()
    return success({'message': f'Moved to "{new_parent_title}"',
                    'ref_code': node.ref_code,
                    'parent_id': node.parent_id})


# ---------------------------------------------------------------------------
# Version history
# ---------------------------------------------------------------------------

# GET /api/v1/nodes/<id>/history
@bp.route('/nodes/<int:node_id>/history', methods=['GET'])
@login_required
def get_history(node_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    changes = NodeChange.query.filter_by(node_id=node_id).order_by(
        NodeChange.created_at.desc()
    ).all()
    return success([serialize_change(c) for c in changes])


# POST /api/v1/nodes/<id>/revert/<change_id>
@bp.route('/nodes/<int:node_id>/revert/<int:change_id>', methods=['POST'])
@login_required
@require_write
def revert_node(node_id, change_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    try:
        node.revert_to(change_id, current_user.id)
    except ValueError as e:
        return error(str(e), 422)

    return success(serialize_node_detail(node))


# ---------------------------------------------------------------------------
# Node-to-node relations
# ---------------------------------------------------------------------------

# GET /api/v1/nodes/<id>/relations
@bp.route('/nodes/<int:node_id>/relations', methods=['GET'])
@login_required
def get_relations(node_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    outgoing = db.session.execute(
        sa.select(Node, node_association.c.relation_type)
        .join(node_association, Node.id == node_association.c.target_id)
        .where(node_association.c.source_id == node_id)
    ).all()

    incoming = db.session.execute(
        sa.select(Node, node_association.c.relation_type)
        .join(node_association, Node.id == node_association.c.source_id)
        .where(node_association.c.target_id == node_id)
    ).all()

    result = []
    seen = set()

    for related, rel_type in outgoing:
        key = (min(node_id, related.id), max(node_id, related.id))
        if key not in seen:
            seen.add(key)
            result.append({**serialize_node_stub(related), 'relation_type': rel_type, 'direction': 'outgoing'})

    for related, rel_type in incoming:
        key = (min(node_id, related.id), max(node_id, related.id))
        if key not in seen:
            seen.add(key)
            result.append({**serialize_node_stub(related), 'relation_type': rel_type, 'direction': 'incoming'})

    return success(result)


# POST /api/v1/nodes/<id>/relations
@bp.route('/nodes/<int:node_id>/relations', methods=['POST'])
@login_required
@require_write
def add_relation(node_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    data = request.get_json(silent=True) or {}
    target_id = data.get('target_id')
    relation_type = data.get('relation_type')

    if not target_id or not relation_type:
        return error('target_id and relation_type are required', 400)

    if target_id == node_id:
        return error('Cannot relate a node to itself', 422)

    target = _get_node_or_404(target_id, institution_id)
    if not target:
        return error('Target node not found', 404)

    existing = db.session.execute(
        sa.select(node_association).where(
            node_association.c.source_id == node_id,
            node_association.c.target_id == target_id,
        )
    ).first()
    if existing:
        return error('Relation already exists', 409)

    db.session.execute(
        node_association.insert().values(
            source_id=node_id,
            target_id=target_id,
            relation_type=relation_type,
        )
    )
    db.session.commit()
    return success({'message': 'Relation added'}, 201)


# DELETE /api/v1/nodes/<id>/relations/<target_id>
@bp.route('/nodes/<int:node_id>/relations/<int:target_id>', methods=['DELETE'])
@login_required
@require_write
def remove_relation(node_id, target_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    db.session.execute(
        node_association.delete().where(
            sa.or_(
                sa.and_(node_association.c.source_id == node_id, node_association.c.target_id == target_id),
                sa.and_(node_association.c.source_id == target_id, node_association.c.target_id == node_id),
            )
        )
    )
    db.session.commit()
    return success({'message': 'Relation removed'})


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------

# POST /api/v1/nodes/<id>/notes
@bp.route('/nodes/<int:node_id>/notes', methods=['POST'])
@login_required
@require_write
def add_note(node_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    data = request.get_json(silent=True) or {}
    if not data.get('content'):
        return error('content is required', 400)

    note = NodeNote(
        node_id=node_id,
        note_type=data.get('note_type', 'general'),
        content=data['content'],
        is_public=data.get('is_public', False),
        created_by_id=current_user.id,
    )
    db.session.add(note)
    db.session.commit()
    return success(serialize_note(note), 201)


# PATCH /api/v1/nodes/<id>/notes/<note_id>
@bp.route('/nodes/<int:node_id>/notes/<int:note_id>', methods=['PATCH'])
@login_required
@require_write
def update_note(node_id, note_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    note = NodeNote.query.filter_by(id=note_id, node_id=node_id).first()
    if not note:
        return error('Note not found', 404)

    data = request.get_json(silent=True) or {}
    if 'content' in data:
        note.content = data['content']
    if 'note_type' in data:
        note.note_type = data['note_type']
    if 'is_public' in data:
        note.is_public = data['is_public']

    db.session.commit()
    return success(serialize_note(note))


# DELETE /api/v1/nodes/<id>/notes/<note_id>
@bp.route('/nodes/<int:node_id>/notes/<int:note_id>', methods=['DELETE'])
@login_required
@require_write
def delete_note(node_id, note_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    note = NodeNote.query.filter_by(id=note_id, node_id=node_id).first()
    if not note:
        return error('Note not found', 404)

    db.session.delete(note)
    db.session.commit()
    return success({'message': 'Note deleted'})


# ---------------------------------------------------------------------------
# Attachments (PDF finding aids)
# ---------------------------------------------------------------------------

MIME_MAP = {
    'pdf': 'application/pdf',
    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'gif': 'image/gif', 'webp': 'image/webp',
    'tiff': 'image/tiff', 'tif': 'image/tiff',
    'txt': 'text/plain', 'md': 'text/markdown', 'csv': 'text/csv',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'odt': 'application/vnd.oasis.opendocument.text',
    'ods': 'application/vnd.oasis.opendocument.spreadsheet',
}


def _allowed_file(filename: str) -> bool:
    allowed = current_app.config.get('ALLOWED_UPLOAD_EXTENSIONS', set(MIME_MAP.keys()))
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in allowed


# POST /api/v1/nodes/<id>/attachments
@bp.route('/nodes/<int:node_id>/attachments', methods=['POST'])
@login_required
@require_write
def upload_attachment(node_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    if 'file' not in request.files:
        return error('No file provided', 400)

    file = request.files['file']
    if not file.filename:
        return error('No file selected', 400)

    if not _allowed_file(file.filename):
        return error('File type not allowed. Supported: ' + ', '.join(sorted(MIME_MAP.keys())), 400)

    original_filename = secure_filename(file.filename)
    stored_filename = f'{uuid.uuid4().hex}_{original_filename}'

    upload_dir = os.path.join(current_app.config['UPLOAD_FOLDER'], str(institution_id), str(node_id))
    os.makedirs(upload_dir, exist_ok=True)

    file_path = os.path.join(upload_dir, stored_filename)
    file.save(file_path)
    file_size = os.path.getsize(file_path)

    ext = original_filename.rsplit('.', 1)[1].lower() if '.' in original_filename else ''
    mime_type = MIME_MAP.get(ext, 'application/octet-stream')

    attachment = NodeAttachment(
        node_id=node_id,
        filename=stored_filename,
        original_filename=original_filename,
        file_size=file_size,
        mime_type=mime_type,
        description=request.form.get('description'),
        uploaded_by_id=current_user.id,
    )

    rep_id = request.args.get('representation_id', type=int) or request.form.get('representation_id', type=int)
    if rep_id:
        from app.models.representation import NodeRepresentation
        rep = NodeRepresentation.query.filter_by(id=rep_id, node_id=node_id).first()
        if rep:
            attachment.representation_id = rep.id
    db.session.add(attachment)
    db.session.flush()

    # Extract technical metadata (non-fatal)
    try:
        from app.tech_metadata import extract_all
        thumb_dir = os.path.join(upload_dir, 'thumbnails')
        tech = extract_all(file_path, mime_type, thumb_dir, stored_filename)
        for field, value in tech.items():
            if hasattr(attachment, field):
                setattr(attachment, field, value)
    except Exception as e:
        current_app.logger.warning(f'Tech metadata extraction failed for {original_filename}: {e}')

    db.session.commit()
    return success(serialize_attachment(attachment), 201)


# GET /api/v1/nodes/<id>/attachments/<attachment_id>/download
@bp.route('/nodes/<int:node_id>/attachments/<int:attachment_id>/download', methods=['GET'])
@login_required
def download_attachment(node_id, attachment_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    attachment = NodeAttachment.query.filter_by(id=attachment_id, node_id=node_id).first()
    if not attachment:
        return error('Attachment not found', 404)

    upload_dir = os.path.join(current_app.config['UPLOAD_FOLDER'], str(institution_id), str(node_id))
    INLINE_TYPES = {'image/png', 'image/jpeg', 'image/gif', 'image/webp',
                    'image/tiff', 'application/pdf', 'text/plain', 'text/markdown', 'text/csv'}
    as_attachment = attachment.mime_type not in INLINE_TYPES
    return send_from_directory(
        upload_dir, attachment.filename,
        download_name=attachment.original_filename,
        as_attachment=as_attachment,
        mimetype=attachment.mime_type,
    )


# GET /api/v1/nodes/<id>/attachments/<attachment_id>/thumbnail
@bp.route('/nodes/<int:node_id>/attachments/<int:attachment_id>/thumbnail', methods=['GET'])
@login_required
def get_attachment_thumbnail(node_id, attachment_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)
    attachment = NodeAttachment.query.filter_by(id=attachment_id, node_id=node_id).first()
    if not attachment or not attachment.thumbnail_path:
        return error('No thumbnail available', 404)
    upload_dir = os.path.join(current_app.config['UPLOAD_FOLDER'], str(institution_id), str(node_id))
    thumb_dir = os.path.join(upload_dir, 'thumbnails')
    thumb_filename = os.path.basename(attachment.thumbnail_path)
    return send_from_directory(thumb_dir, thumb_filename, mimetype='image/jpeg')


# POST /api/v1/nodes/<id>/attachments/<attachment_id>/extract
@bp.route('/nodes/<int:node_id>/attachments/<int:attachment_id>/extract', methods=['POST'])
@login_required
@require_write
def reextract_attachment_metadata(node_id, attachment_id):
    """Re-run technical metadata extraction on an existing attachment."""
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)
    attachment = NodeAttachment.query.filter_by(id=attachment_id, node_id=node_id).first()
    if not attachment:
        return error('Attachment not found', 404)
    upload_dir = os.path.join(current_app.config['UPLOAD_FOLDER'], str(institution_id), str(node_id))
    file_path = os.path.join(upload_dir, attachment.filename)
    if not os.path.exists(file_path):
        return error('File not found on disk', 404)
    try:
        from app.tech_metadata import extract_all
        thumb_dir = os.path.join(upload_dir, 'thumbnails')
        tech = extract_all(file_path, attachment.mime_type, thumb_dir, attachment.filename)
        for field, value in tech.items():
            if hasattr(attachment, field):
                setattr(attachment, field, value)
        db.session.commit()
        return success(serialize_attachment(attachment))
    except Exception as e:
        return error(f'Extraction failed: {e}', 500)


# DELETE /api/v1/nodes/<id>/attachments/<attachment_id>
@bp.route('/nodes/<int:node_id>/attachments/<int:attachment_id>', methods=['DELETE'])
@login_required
@require_write
def delete_attachment(node_id, attachment_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    attachment = NodeAttachment.query.filter_by(id=attachment_id, node_id=node_id).first()
    if not attachment:
        return error('Attachment not found', 404)

    upload_dir = os.path.join(current_app.config['UPLOAD_FOLDER'], str(institution_id), str(node_id))
    file_path = os.path.join(upload_dir, attachment.filename)
    if os.path.exists(file_path):
        os.remove(file_path)

    db.session.delete(attachment)
    db.session.commit()
    return success({'message': 'Attachment deleted'})

# ---------------------------------------------------------------------------
# Node → Agent associations
# ---------------------------------------------------------------------------

# GET /api/v1/nodes/<id>/agents
@bp.route('/nodes/<int:node_id>/agents', methods=['GET'])
@login_required
def get_node_agents(node_id):
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    from app.models.agent import agent_node_association
    rows = db.session.execute(
        sa.select(agent_node_association).where(
            agent_node_association.c.node_id == node_id
        )
    ).all()

    from app.models import Agent
    result = []
    for row in rows:
        agent = Agent.query.get(row.agent_id)
        if agent:
            result.append({
                'id': agent.id,
                'name': agent.name,
                'agent_type': agent.agent_type.value,
                'authorized_form': agent.authorized_form,
                'identifier': agent.identifier,
                'relation_type': row.relation_type,
            })
    return success(result)


# POST /api/v1/nodes/<id>/agents
@bp.route('/nodes/<int:node_id>/agents', methods=['POST'])
@login_required
@require_write
def add_node_agent(node_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    data = request.get_json(silent=True) or {}
    agent_id = data.get('agent_id')
    relation_type = data.get('relation_type')

    if not agent_id or not relation_type:
        return error('agent_id and relation_type are required', 400)

    from app.models import Agent
    from app.models.agent import agent_node_association
    agent = Agent.query.filter_by(id=agent_id, institution_id=institution_id).first()
    if not agent:
        return error('Agent not found', 404)

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
    return success({'message': 'Agent linked'}, 201)


# DELETE /api/v1/nodes/<id>/agents/<agent_id>
@bp.route('/nodes/<int:node_id>/agents/<int:agent_id>', methods=['DELETE'])
@login_required
@require_write
def remove_node_agent(node_id, agent_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    from app.models.agent import agent_node_association
    db.session.execute(
        agent_node_association.delete().where(
            agent_node_association.c.agent_id == agent_id,
            agent_node_association.c.node_id == node_id,
        )
    )
    db.session.commit()
    return success({'message': 'Agent unlinked'})


# ---------------------------------------------------------------------------
# Node → Location associations
# ---------------------------------------------------------------------------

# GET /api/v1/nodes/<id>/locations
@bp.route('/nodes/<int:node_id>/locations', methods=['GET'])
@login_required
def get_node_locations(node_id):
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    from app.models.location import location_node_association
    rows = db.session.execute(
        sa.select(location_node_association).where(
            location_node_association.c.node_id == node_id
        )
    ).all()

    from app.models import Location
    result = []
    for row in rows:
        loc = Location.query.get(row.location_id)
        if loc:
            result.append({
                'id': loc.id,
                'name': loc.name,
                'code': loc.code,
                'level_name': loc.level_name,
                'full_path': loc.get_full_path(),
                'can_store_nodes': loc.can_store_nodes,
            })
    return success(result)


# POST /api/v1/nodes/<id>/locations
@bp.route('/nodes/<int:node_id>/locations', methods=['POST'])
@login_required
@require_write
def add_node_location(node_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    data = request.get_json(silent=True) or {}
    location_id = data.get('location_id')
    if not location_id:
        return error('location_id is required', 400)

    from app.models import Location, LocationMovement
    from app.models.location import location_node_association
    location = Location.query.filter_by(id=location_id, institution_id=institution_id).first()
    if not location:
        return error('Location not found', 404)

    if not location.can_store_nodes:
        return error('This location cannot store archival materials', 422)

    if location.capacity is not None and location.stored_nodes.count() >= location.capacity:
        return error('Location is at full capacity', 409)

    existing = db.session.execute(
        sa.select(location_node_association).where(
            location_node_association.c.location_id == location_id,
            location_node_association.c.node_id == node_id,
        )
    ).first()
    if existing:
        return error('Node is already at this location', 409)

    db.session.execute(
        location_node_association.insert().values(
            location_id=location_id, node_id=node_id
        )
    )
    movement = LocationMovement(
        node_id=node_id,
        location_id=location_id,
        movement_type='check_in',
        notes=data.get('notes'),
        moved_by_id=current_user.id,
    )
    db.session.add(movement)
    db.session.commit()
    return success({'message': 'Location assigned'}, 201)


# DELETE /api/v1/nodes/<id>/locations/<location_id>
@bp.route('/nodes/<int:node_id>/locations/<int:location_id>', methods=['DELETE'])
@login_required
@require_write
def remove_node_location(node_id, location_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    from app.models import LocationMovement
    from app.models.location import location_node_association
    db.session.execute(
        location_node_association.delete().where(
            location_node_association.c.location_id == location_id,
            location_node_association.c.node_id == node_id,
        )
    )
    movement = LocationMovement(
        node_id=node_id,
        location_id=location_id,
        movement_type='check_out',
        moved_by_id=current_user.id,
    )
    db.session.add(movement)
    db.session.commit()
    return success({'message': 'Location removed'})


# ---------------------------------------------------------------------------
# Node → Classification associations
# ---------------------------------------------------------------------------

# GET /api/v1/nodes/<id>/classifications
@bp.route('/nodes/<int:node_id>/classifications', methods=['GET'])
@login_required
def get_node_classifications(node_id):
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    from app.models.classification import classification_node_association
    rows = db.session.execute(
        sa.select(classification_node_association).where(
            classification_node_association.c.node_id == node_id
        )
    ).all()

    from app.models import Classification
    result = []
    for row in rows:
        c = Classification.query.get(row.classification_id)
        if c:
            result.append({
                'id': c.id,
                'name': c.name,
                'code': c.code,
                'full_code': c.get_full_code(),
                'level_name': c.level_name,
                'is_active': c.is_active,
            })
    return success(result)


# POST /api/v1/nodes/<id>/classifications
@bp.route('/nodes/<int:node_id>/classifications', methods=['POST'])
@login_required
@require_write
def add_node_classification(node_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    data = request.get_json(silent=True) or {}
    classification_id = data.get('classification_id')
    if not classification_id:
        return error('classification_id is required', 400)

    from app.models import Classification
    from app.models.classification import classification_node_association
    c = Classification.query.filter_by(id=classification_id, institution_id=institution_id).first()
    if not c:
        return error('Classification not found', 404)

    existing = db.session.execute(
        sa.select(classification_node_association).where(
            classification_node_association.c.classification_id == classification_id,
            classification_node_association.c.node_id == node_id,
        )
    ).first()
    if existing:
        return error('Already classified', 409)

    db.session.execute(
        classification_node_association.insert().values(
            classification_id=classification_id, node_id=node_id
        )
    )
    db.session.commit()
    return success({'message': 'Classification assigned'}, 201)


# DELETE /api/v1/nodes/<id>/classifications/<classification_id>
@bp.route('/nodes/<int:node_id>/classifications/<int:classification_id>', methods=['DELETE'])
@login_required
@require_write
def remove_node_classification(node_id, classification_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    from app.models.classification import classification_node_association
    db.session.execute(
        classification_node_association.delete().where(
            classification_node_association.c.classification_id == classification_id,
            classification_node_association.c.node_id == node_id,
        )
    )
    db.session.commit()
    return success({'message': 'Classification removed'})


# ---------------------------------------------------------------------------
# Node-to-node relation types (vocabulary management)
# ---------------------------------------------------------------------------

def _serialize_node_relation_type(rt) -> dict:
    return {
        'id': rt.id,
        'name': rt.name,
        'description': rt.description,
        'is_symmetric': rt.is_symmetric,
        'complementary_id': rt.complementary_id,
        'complementary_name': rt.complementary.name if rt.complementary else None,
    }


# GET /api/v1/nodes/relation-types
@bp.route('/nodes/relation-types', methods=['GET'])
@login_required
def list_node_to_node_relation_types():
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    from app.models import NodeRelationType
    types = NodeRelationType.query.filter_by(
        institution_id=current_user.active_institution_id
    ).order_by(NodeRelationType.name).all()
    return success([_serialize_node_relation_type(t) for t in types])


# POST /api/v1/nodes/relation-types
@bp.route('/nodes/relation-types', methods=['POST'])
@login_required
@require_write
def create_node_to_node_relation_type():
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}
    if not data.get('name'):
        return error('name is required', 400)

    from app.models import NodeRelationType
    is_symmetric = data.get('is_symmetric', True)

    rt = NodeRelationType(
        institution_id=institution_id,
        name=data['name'],
        description=data.get('description'),
        is_symmetric=is_symmetric,
    )
    db.session.add(rt)
    db.session.flush()

    if not is_symmetric and data.get('complementary_name'):
        complement = NodeRelationType(
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
    return success(_serialize_node_relation_type(rt), 201)


# PATCH /api/v1/nodes/relation-types/<id>
@bp.route('/nodes/relation-types/<int:type_id>', methods=['PATCH'])
@login_required
@require_write
def update_node_to_node_relation_type(type_id):
    institution_id = current_user.active_institution_id
    from app.models import NodeRelationType
    rt = NodeRelationType.query.filter_by(id=type_id, institution_id=institution_id).first()
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
            comp = NodeRelationType(
                institution_id=institution_id,
                name=data['complementary_name'],
                is_symmetric=False,
                complementary_id=rt.id,
            )
            db.session.add(comp)
            db.session.flush()
            rt.complementary_id = comp.id
    db.session.commit()
    return success(_serialize_node_relation_type(rt))


# DELETE /api/v1/nodes/relation-types/<id>
@bp.route('/nodes/relation-types/<int:type_id>', methods=['DELETE'])
@login_required
@require_write
def delete_node_to_node_relation_type(type_id):
    institution_id = current_user.active_institution_id
    from app.models import NodeRelationType
    rt = NodeRelationType.query.filter_by(id=type_id, institution_id=institution_id).first()
    if not rt:
        return error('Relation type not found', 404)
    if rt.complementary:
        db.session.delete(rt.complementary)
    db.session.delete(rt)
    db.session.commit()
    return success({'message': 'Deleted'})


# POST /api/v1/nodes/<id>/locations/move
# Move a node from one location to another
@bp.route('/nodes/<int:node_id>/locations/move', methods=['POST'])
@login_required
@require_write
def move_node_location(node_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    data = request.get_json(silent=True) or {}
    from_location_id = data.get('from_location_id')
    to_location_id = data.get('to_location_id')
    notes = data.get('notes')

    if not from_location_id or not to_location_id:
        return error('from_location_id and to_location_id are required', 400)
    if from_location_id == to_location_id:
        return error('Source and destination are the same', 422)

    from app.models import Location, LocationMovement
    from app.models.location import location_node_association
    import sqlalchemy as sa

    from_loc = Location.query.filter_by(id=from_location_id, institution_id=institution_id).first()
    to_loc = Location.query.filter_by(id=to_location_id, institution_id=institution_id).first()

    if not from_loc:
        return error('Source location not found', 404)
    if not to_loc:
        return error('Destination location not found', 404)
    if not to_loc.can_store_nodes:
        return error('Destination cannot store archival materials', 422)

    # Verify node is actually at the source location
    existing = db.session.execute(
        sa.select(location_node_association).where(
            location_node_association.c.location_id == from_location_id,
            location_node_association.c.node_id == node_id,
        )
    ).first()
    if not existing:
        return error('Node is not at the source location', 422)

    if to_loc.capacity is not None:
        if to_loc.stored_nodes.count() >= to_loc.capacity:
            return error('Destination location is at full capacity', 409)

    # Remove from source, add to destination
    db.session.execute(
        location_node_association.delete().where(
            location_node_association.c.location_id == from_location_id,
            location_node_association.c.node_id == node_id,
        )
    )
    db.session.execute(
        location_node_association.insert().values(
            location_id=to_location_id, node_id=node_id
        )
    )

    movement = LocationMovement(
        node_id=node_id,
        location_id=to_location_id,
        movement_type='transfer',
        notes=notes or f'Moved from {from_loc.name} to {to_loc.name}',
        moved_by_id=current_user.id,
    )
    db.session.add(movement)
    db.session.commit()

    return success({
        'message': f'Moved from {from_loc.name} to {to_loc.name}',
        'from_location': from_loc.name,
        'to_location': to_loc.name,
    })


# POST /api/v1/nodes/batch
@bp.route('/nodes/batch', methods=['POST'])
@login_required
@require_write
def batch_create_nodes():
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}

    parent_id       = data.get('parent_id')
    hierarchy_type_id = data.get('hierarchy_type_id')
    level_of_description = data.get('level_of_description')
    entries         = data.get('entries', [])   # [{title, local_ref, date_start, date_end, description}]

    if not parent_id:
        return error('parent_id is required — rapid entry only creates children under an existing node', 400)
    if not hierarchy_type_id:
        return error('hierarchy_type_id is required', 400)
    if not level_of_description:
        return error('level_of_description is required', 400)
    if not entries:
        return error('entries must not be empty', 400)
    if len(entries) > 200:
        return error('Maximum 200 entries per batch', 400)

    from app.models import Institution
    institution = Institution.query.get(institution_id)

    parent = None
    if parent_id:
        parent = Node.query.filter_by(id=parent_id, institution_id=institution_id).first()
        if not parent:
            return error('Parent node not found', 404)

    created = []
    errors  = []

    for i, entry in enumerate(entries):
        title = (entry.get('title') or '').strip()
        local_ref = (entry.get('local_ref') or '').strip()
        if not title:
            errors.append({'row': i + 1, 'error': 'Title is required'})
            continue
        if not local_ref:
            errors.append({'row': i + 1, 'error': 'Reference code is required'})
            continue

        # Check for duplicate local_ref under same parent
        existing = Node.query.filter_by(
            institution_id=institution_id,
            parent_id=parent_id,
            local_ref=local_ref,
        ).first()
        if existing:
            errors.append({'row': i + 1, 'error': f'Ref "{local_ref}" already exists under this parent'})
            continue

        node = Node(
            institution_id=institution_id,
            title=title,
            local_ref=local_ref,
            level_of_description=level_of_description,
            hierarchy_type_id=hierarchy_type_id,
            parent=parent,
            description=entry.get('description') or None,
            status=NodeStatus.DRAFT,
            created_by_id=current_user.id,
            updated_by_id=current_user.id,
            metadata_spec={},
        )

        # Parse dates
        for field in ('date_start', 'date_end'):
            val = (entry.get(field) or '').strip()
            if val:
                try:
                    from datetime import date as _date
                    setattr(node, field, _date.fromisoformat(val))
                except ValueError:
                    pass

        if parent:
            node.ref_code = f'{parent.ref_code}/{local_ref}'
        else:
            node.ref_code = f'{institution.ref_prefix}/{local_ref}'

        db.session.add(node)
        db.session.flush()

        node.record_change(
            change_type='create',
            description='Created via rapid entry',
            created_by_id=current_user.id,
            before_data={},
            after_data=node.to_dict(),
        )

        created.append({'id': node.id, 'ref_code': node.ref_code, 'title': node.title})

    if errors and not created:
        db.session.rollback()
        return error(f'All entries failed: {errors[0]["error"]}', 422)

    db.session.commit()
    return success({'created': created, 'errors': errors, 'total_created': len(created)}, 201)


# ── Places ─────────────────────────────────────────────────────────────

# GET /api/v1/nodes/<id>/places
@bp.route('/nodes/<int:node_id>/places', methods=['GET'])
@login_required
def get_node_places(node_id):
    node = _get_node_or_404(node_id, current_user.active_institution_id)
    if not node:
        return error('Node not found', 404)
    from app.models.geo import NodePlace
    places = NodePlace.query.filter_by(node_id=node_id).order_by(NodePlace.sort_order).all()
    return success([p.to_dict() for p in places])


# POST /api/v1/nodes/<id>/places
@bp.route('/nodes/<int:node_id>/places', methods=['POST'])
@login_required
@require_write
def add_node_place(node_id):
    node = _get_node_or_404(node_id, current_user.active_institution_id)
    if not node:
        return error('Node not found', 404)
    data = request.get_json(silent=True) or {}
    if not data.get('name') or not data.get('place_type'):
        return error('name and place_type are required', 400)
    from app.models.geo import NodePlace
    place = NodePlace(
        node_id=node_id,
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


# PATCH /api/v1/nodes/<id>/places/<place_id>
@bp.route('/nodes/<int:node_id>/places/<int:place_id>', methods=['PATCH'])
@login_required
@require_write
def update_node_place(node_id, place_id):
    from app.models.geo import NodePlace
    place = NodePlace.query.filter_by(id=place_id, node_id=node_id).first()
    if not place:
        return error('Place not found', 404)
    data = request.get_json(silent=True) or {}
    for field in ('place_type', 'name', 'wikidata_id', 'lat', 'lon', 'note', 'date_from', 'date_to', 'sort_order'):
        if field in data:
            setattr(place, field, data[field])
    db.session.commit()
    return success(place.to_dict())


# DELETE /api/v1/nodes/<id>/places/<place_id>
@bp.route('/nodes/<int:node_id>/places/<int:place_id>', methods=['DELETE'])
@login_required
@require_write
def delete_node_place(node_id, place_id):
    from app.models.geo import NodePlace
    place = NodePlace.query.filter_by(id=place_id, node_id=node_id).first()
    if not place:
        return error('Place not found', 404)
    db.session.delete(place)
    db.session.commit()
    return success({'message': 'Deleted'})


# ── Tags ───────────────────────────────────────────────────────────────

# GET /api/v1/nodes/<id>/tags
@bp.route('/nodes/<int:node_id>/tags', methods=['GET'])
@login_required
def get_node_tags(node_id):
    node = _get_node_or_404(node_id, current_user.active_institution_id)
    if not node:
        return error('Node not found', 404)
    return success([t.to_dict() for t in node.tags])


# POST /api/v1/nodes/<id>/tags
@bp.route('/nodes/<int:node_id>/tags', methods=['POST'])
@login_required
@require_write
def add_node_tag(node_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)
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
    if tag not in node.tags:
        node.tags.append(tag)
    db.session.commit()
    return success(tag.to_dict(), 201)


# DELETE /api/v1/nodes/<id>/tags/<tag_id>
@bp.route('/nodes/<int:node_id>/tags/<int:tag_id>', methods=['DELETE'])
@login_required
@require_write
def remove_node_tag(node_id, tag_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)
    from app.models.geo import Tag
    tag = Tag.query.filter_by(id=tag_id, institution_id=institution_id).first()
    if tag and tag in node.tags:
        node.tags.remove(tag)
        db.session.commit()
    return success({'message': 'Removed'})


# GET /api/v1/tags/search?q=photo&category=occupation
@bp.route('/tags/search', methods=['GET'])
@login_required
def search_tags():
    from app.models.geo import Tag
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)
    q = request.args.get('q', '').strip()
    category = request.args.get('category', '').strip() or None
    import sqlalchemy as sa
    query = sa.select(Tag).where(Tag.institution_id == institution_id)
    if q:
        query = query.where(Tag.name.ilike(f'%{q}%'))
    if category:
        query = query.where(Tag.category == category)
    tags = db.session.execute(query.order_by(Tag.name).limit(20)).scalars().all()
    return success([t.to_dict() for t in tags])


# ── Place type vocab ───────────────────────────────────────────────────

@bp.route('/vocab/place-types', methods=['GET'])
@login_required
def list_place_types():
    from app.models.geo import PlaceType
    institution_id = current_user.active_institution_id
    applicable = request.args.get('applicable_to')  # agent | node | both
    import sqlalchemy as sa
    q = sa.select(PlaceType).where(PlaceType.institution_id == institution_id)
    if applicable:
        q = q.where(
            sa.or_(PlaceType.applicable_to == applicable, PlaceType.applicable_to == 'both')
        )
    types = db.session.execute(q.order_by(PlaceType.sort_order, PlaceType.label)).scalars().all()
    return success([t.to_dict() for t in types])


@bp.route('/vocab/place-types', methods=['POST'])
@login_required
@require_write
def create_place_type():
    from app.models.geo import PlaceType
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}
    if not data.get('name') or not data.get('label'):
        return error('name and label are required', 400)
    pt = PlaceType(
        institution_id=institution_id,
        name=data['name'].strip().lower().replace(' ', '_'),
        label=data['label'].strip(),
        applicable_to=data.get('applicable_to', 'both'),
        sort_order=data.get('sort_order', 0),
    )
    db.session.add(pt)
    db.session.commit()
    return success(pt.to_dict(), 201)


@bp.route('/vocab/place-types/<int:type_id>', methods=['PATCH'])
@login_required
@require_write
def update_place_type(type_id):
    from app.models.geo import PlaceType
    pt = PlaceType.query.filter_by(id=type_id, institution_id=current_user.active_institution_id).first()
    if not pt:
        return error('Not found', 404)
    data = request.get_json(silent=True) or {}
    for f in ('label', 'applicable_to', 'sort_order'):
        if f in data:
            setattr(pt, f, data[f])
    db.session.commit()
    return success(pt.to_dict())


@bp.route('/vocab/place-types/<int:type_id>', methods=['DELETE'])
@login_required
@require_write
def delete_place_type(type_id):
    from app.models.geo import PlaceType
    pt = PlaceType.query.filter_by(id=type_id, institution_id=current_user.active_institution_id).first()
    if not pt:
        return error('Not found', 404)
    db.session.delete(pt)
    db.session.commit()
    return success({'message': 'Deleted'})


# ── Tag category vocab ─────────────────────────────────────────────────

@bp.route('/vocab/tag-categories', methods=['GET'])
@login_required
def list_tag_categories():
    from app.models.geo import TagCategory
    import sqlalchemy as sa
    institution_id = current_user.active_institution_id
    applicable = request.args.get('applicable_to')
    q = sa.select(TagCategory).where(TagCategory.institution_id == institution_id)
    if applicable:
        q = q.where(
            sa.or_(TagCategory.applicable_to == applicable, TagCategory.applicable_to == 'both')
        )
    cats = db.session.execute(q.order_by(TagCategory.sort_order, TagCategory.label)).scalars().all()
    return success([c.to_dict() for c in cats])


@bp.route('/vocab/tag-categories', methods=['POST'])
@login_required
@require_write
def create_tag_category():
    from app.models.geo import TagCategory
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}
    if not data.get('name') or not data.get('label'):
        return error('name and label are required', 400)
    cat = TagCategory(
        institution_id=institution_id,
        name=data['name'].strip().lower().replace(' ', '_'),
        label=data['label'].strip(),
        applicable_to=data.get('applicable_to', 'both'),
        sort_order=data.get('sort_order', 0),
    )
    db.session.add(cat)
    db.session.commit()
    return success(cat.to_dict(), 201)


@bp.route('/vocab/tag-categories/<int:cat_id>', methods=['PATCH'])
@login_required
@require_write
def update_tag_category(cat_id):
    from app.models.geo import TagCategory
    cat = TagCategory.query.filter_by(id=cat_id, institution_id=current_user.active_institution_id).first()
    if not cat:
        return error('Not found', 404)
    data = request.get_json(silent=True) or {}
    for f in ('label', 'applicable_to', 'sort_order'):
        if f in data:
            setattr(cat, f, data[f])
    db.session.commit()
    return success(cat.to_dict())


@bp.route('/vocab/tag-categories/<int:cat_id>', methods=['DELETE'])
@login_required
@require_write
def delete_tag_category(cat_id):
    from app.models.geo import TagCategory
    cat = TagCategory.query.filter_by(id=cat_id, institution_id=current_user.active_institution_id).first()
    if not cat:
        return error('Not found', 404)
    db.session.delete(cat)
    db.session.commit()
    return success({'message': 'Deleted'})


# ── Flags ──────────────────────────────────────────────────────────────

# GET /api/v1/nodes/<id>/flags
@bp.route('/nodes/<int:node_id>/flags', methods=['GET'])
@login_required
def get_node_flags(node_id):
    node = _get_node_or_404(node_id, current_user.active_institution_id)
    if not node:
        return error('Node not found', 404)
    from app.models.flag import NodeFlag
    import sqlalchemy as sa
    flags = db.session.execute(
        sa.select(NodeFlag)
        .where(NodeFlag.node_id == node_id)
        .order_by(NodeFlag.created_at.desc())
    ).scalars().all()
    return success([f.to_dict() for f in flags])


# POST /api/v1/nodes/<id>/flags
@bp.route('/nodes/<int:node_id>/flags', methods=['POST'])
@login_required
@require_write
def create_node_flag(node_id):
    node = _get_node_or_404(node_id, current_user.active_institution_id)
    if not node:
        return error('Node not found', 404)
    data = request.get_json(silent=True) or {}
    if not data.get('title') or not data.get('flag_type'):
        return error('title and flag_type are required', 400)
    from app.models.flag import NodeFlag
    flag = NodeFlag(
        institution_id=current_user.active_institution_id,
        node_id=node_id,
        flag_type=data['flag_type'],
        severity=data.get('severity', 'medium'),
        status='open',
        title=data['title'].strip(),
        body=data.get('body', '').strip() or None,
        assigned_to_id=data.get('assigned_to_id'),
        created_by_id=current_user.id,
    )
    db.session.add(flag)
    db.session.commit()
    return success(flag.to_dict(), 201)


# PATCH /api/v1/nodes/<id>/flags/<flag_id>
@bp.route('/nodes/<int:node_id>/flags/<int:flag_id>', methods=['PATCH'])
@login_required
@require_write
def update_node_flag(node_id, flag_id):
    from app.models.flag import NodeFlag
    from datetime import datetime
    flag = NodeFlag.query.filter_by(
        id=flag_id, node_id=node_id,
        institution_id=current_user.active_institution_id
    ).first()
    if not flag:
        return error('Flag not found', 404)
    data = request.get_json(silent=True) or {}
    for field in ('flag_type', 'severity', 'title', 'body', 'assigned_to_id'):
        if field in data:
            setattr(flag, field, data[field])
    if 'status' in data:
        new_status = data['status']
        if new_status == 'resolved' and flag.status != 'resolved':
            flag.resolved_at = datetime.utcnow()
            flag.resolved_by_id = current_user.id
        elif new_status != 'resolved':
            flag.resolved_at = None
            flag.resolved_by_id = None
        flag.status = new_status
    flag.updated_at = datetime.utcnow()
    db.session.commit()
    return success(flag.to_dict())


# DELETE /api/v1/nodes/<id>/flags/<flag_id>
@bp.route('/nodes/<int:node_id>/flags/<int:flag_id>', methods=['DELETE'])
@login_required
@require_write
def delete_node_flag(node_id, flag_id):
    from app.models.flag import NodeFlag
    flag = NodeFlag.query.filter_by(
        id=flag_id, node_id=node_id,
        institution_id=current_user.active_institution_id
    ).first()
    if not flag:
        return error('Flag not found', 404)
    db.session.delete(flag)
    db.session.commit()
    return success({'message': 'Deleted'})


# ── Institution-wide flags overview ───────────────────────────────────

# GET /api/v1/flags?status=open&flag_type=conservation&severity=high&assigned_to_me=true&page=1
@bp.route('/flags', methods=['GET'])
@login_required
def list_all_flags():
    institution_id = current_user.active_institution_id
    from app.models.flag import NodeFlag
    import sqlalchemy as sa

    stmt = sa.select(NodeFlag).where(NodeFlag.institution_id == institution_id)

    status = request.args.get('status')
    if status:
        stmt = stmt.where(NodeFlag.status == status)
    else:
        # Default: exclude resolved
        stmt = stmt.where(NodeFlag.status != 'resolved')

    flag_type = request.args.get('flag_type')
    if flag_type:
        stmt = stmt.where(NodeFlag.flag_type == flag_type)

    severity = request.args.get('severity')
    if severity:
        stmt = stmt.where(NodeFlag.severity == severity)

    if request.args.get('assigned_to_me') == 'true':
        stmt = stmt.where(NodeFlag.assigned_to_id == current_user.id)
    elif request.args.get('unassigned') == 'true':
        stmt = stmt.where(NodeFlag.assigned_to_id == None)  # noqa: E711

    # Severity order: high → medium → low
    sev_order = sa.case(
        (NodeFlag.severity == 'high', 1),
        (NodeFlag.severity == 'medium', 2),
        else_=3
    )
    stmt = stmt.order_by(sev_order, NodeFlag.created_at.desc())

    page = max(1, request.args.get('page', 1, type=int))
    per_page = 25
    total = db.session.execute(
        sa.select(sa.func.count()).select_from(stmt.subquery())
    ).scalar()
    flags = db.session.execute(
        stmt.limit(per_page).offset((page - 1) * per_page)
    ).scalars().all()

    return success({
        'flags': [f.to_dict(include_node=True) for f in flags],
        'total': total,
        'page': page,
        'pages': max(1, (total + per_page - 1) // per_page),
        'per_page': per_page,
    })


# ── Label printing ────────────────────────────────────────────────────

# POST /api/v1/nodes/labels
# Body: { node_ids: [1,2,3], format: "avery_l7163", copies: 1 }
@bp.route('/nodes/labels', methods=['POST'])
@login_required
def print_labels():
    """Generate a label PDF for one or more nodes."""
    from flask import make_response
    from app.labels import generate_label_pdf, LabelData
    from app.models.location import Location

    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}

    node_ids = data.get('node_ids', [])
    fmt = data.get('format', 'avery_l7163')
    copies = max(1, min(int(data.get('copies', 1)), 10))

    if not node_ids:
        return error('node_ids is required', 400)
    if len(node_ids) > 200:
        return error('Maximum 200 labels per request', 400)

    nodes = db.session.execute(
        sa.select(Node)
        .where(
            Node.id.in_(node_ids),
            Node.institution_id == institution_id,
        )
        .order_by(Node.ref_code)
    ).scalars().all()

    if not nodes:
        return error('No nodes found', 404)

    from app.models import Institution
    institution = db.session.get(Institution, institution_id)
    inst_name = institution.name if institution else ''

    labels = []
    for node in nodes:
        location_path = None
        if node.current_location_id:
            loc = db.session.get(Location, node.current_location_id)
            if loc:
                location_path = loc.get_full_path()

        labels.append(LabelData(
            ref_code=node.ref_code or node.local_ref,
            title=node.title,
            level=node.level_of_description or '',
            local_ref=node.local_ref or '',
            date_from=node.date_start.strftime('%Y') if node.date_start else None,
            date_to=node.date_end.strftime('%Y') if node.date_end else None,
            institution_name=inst_name,
            location_path=location_path,
            copies=copies,
        ))

    try:
        pdf_bytes = generate_label_pdf(labels, format_key=fmt)
    except Exception as e:
        current_app.logger.error(f'Label generation failed: {e}')
        return error(f'Label generation failed: {e}', 500)

    response = make_response(pdf_bytes)
    response.headers['Content-Type'] = 'application/pdf'
    response.headers['Content-Disposition'] = 'inline; filename="labels.pdf"'
    return response


# ── Finding aid ───────────────────────────────────────────────────────

# GET /api/v1/nodes/<id>/finding-aid
@bp.route('/nodes/<int:node_id>/finding-aid', methods=['GET'])
@login_required
def print_finding_aid(node_id):
    """Generate a finding aid PDF for a node and all its descendants."""
    from flask import make_response
    from app.reports import generate_finding_aid

    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    try:
        pdf_bytes = generate_finding_aid(node_id, institution_id, db)
    except Exception as e:
        current_app.logger.error(f'Finding aid generation failed: {e}')
        return error(f'Failed to generate finding aid: {e}', 500)

    safe_title = (node.title or 'finding_aid').replace(' ', '_')[:40]
    response = make_response(pdf_bytes)
    response.headers['Content-Type'] = 'application/pdf'
    response.headers['Content-Disposition'] = f'inline; filename="{safe_title}_finding_aid.pdf"'
    return response

# POST /api/v1/nodes/<id>/duplicate
@bp.route('/nodes/<int:node_id>/duplicate', methods=['POST'])
@login_required
@require_write
def duplicate_node(node_id):
    from app.models.node import Node, NodeNote, NodeStatus
    from app.models.geo import Tag
    import sqlalchemy as sa

    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    source = Node.query.filter_by(id=node_id, institution_id=institution_id).first()
    if not source:
        return error('Node not found', 404)

    # ── Build a unique local_ref ──────────────────────────────────────
    base_ref = f'{source.local_ref}-copy'
    existing_refs = {
        r[0] for r in Node.query
        .filter_by(institution_id=institution_id, parent_id=source.parent_id)
        .with_entities(Node.local_ref).all()
    }
    candidate = base_ref
    i = 1
    while candidate in existing_refs:
        candidate = f'{base_ref}-{i}'
        i += 1
    local_ref = candidate

    # ── Compute ref_code ──────────────────────────────────────────────
    if source.parent:
        ref_code = f'{source.parent.ref_code}/{local_ref}'
    else:
        ref_code = f'{source.institution.ref_prefix}/{local_ref}'

    # ── Create the duplicate ──────────────────────────────────────────
    duplicate = Node(
        institution_id=institution_id,
        parent_id=source.parent_id,
        local_ref=local_ref,
        ref_code=ref_code,
        title=source.title,
        level_of_description=source.level_of_description,
        hierarchy_type_id=source.hierarchy_type_id,
        description=source.description,
        date_start=source.date_start,
        date_end=source.date_end,
        date_certainty=source.date_certainty,
        extent=source.extent,
        scope_and_content=source.scope_and_content,
        arrangement=source.arrangement,
        access_conditions=source.access_conditions,
        reproduction_conditions=source.reproduction_conditions,
        language=source.language,
        finding_aids=source.finding_aids,
        metadata_spec=dict(source.metadata_spec) if source.metadata_spec else {},
        status=NodeStatus.DRAFT,
        created_by_id=current_user.id,
        updated_by_id=current_user.id,
    )
    db.session.add(duplicate)
    db.session.flush()

    # ── Copy notes ────────────────────────────────────────────────────
    for note in source.notes:
        db.session.add(NodeNote(
            node_id=duplicate.id,
            note_type=note.note_type,
            content=note.content,
            is_public=note.is_public,
            created_by_id=current_user.id,
        ))

    # Provenance note
    db.session.add(NodeNote(
        node_id=duplicate.id,
        note_type='general',
        content=f'Duplicated from {source.ref_code} ("{source.title}").',
        is_public=False,
        created_by_id=current_user.id,
    ))

    # ── Copy tags ─────────────────────────────────────────────────────
    for tag in source.tags.all():
        duplicate.tags.append(tag)

    db.session.commit()

    from app.api.v1.nodes.serializers import serialize_node_detail
    return success(serialize_node_detail(duplicate), 201)

@bp.route('/nodes/<int:node_id>/attachments/<int:attachment_id>/ocr', methods=['POST'])
@login_required
@require_write
def ocr_attachment(node_id, attachment_id):
    from app.models.background_task import BackgroundTask
    from app.tasks.runner import run_in_background
    from app.tasks.ocr import can_ocr
    from flask import current_app

    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    attachment = NodeAttachment.query.filter_by(id=attachment_id, node_id=node_id).first()
    if not attachment:
        return error('Attachment not found', 404)

    if not can_ocr(attachment.mime_type):
        return error(
            f'Text extraction not supported for {attachment.mime_type}. '
            'Supported: images (JPEG, PNG, TIFF) and PDF.', 400
        )

    data = request.get_json(silent=True) or {}
    force_ocr = data.get('force_ocr', False)

    existing = BackgroundTask.query.filter_by(
        entity_type='node_attachment',
        entity_id=attachment_id,
        task_type='ocr',
        status='running',
    ).first()
    if existing:
        return error('Text extraction already running for this attachment', 409)

    task = BackgroundTask(
        institution_id=institution_id,
        created_by_id=current_user.id,
        task_type='ocr',
        entity_type='node_attachment',
        entity_id=attachment_id,
        result={'force_ocr': force_ocr},   # passes options to worker
    )
    db.session.add(task)
    db.session.commit()

    from app.tasks.ocr import run_ocr
    run_in_background(current_app._get_current_object(), task.id, run_ocr)

    return success({'task_id': task.id, 'status': 'pending'}, 201)

# POST /api/v1/nodes/<id>/attachments/<attachment_id>/transcribe
@bp.route('/nodes/<int:node_id>/attachments/<int:attachment_id>/transcribe', methods=['POST'])
@login_required
@require_write
def transcribe_attachment(node_id, attachment_id):
    from app.models.background_task import BackgroundTask
    from app.tasks.runner import run_in_background
    from app.tasks.whisper_ import can_transcribe
    from flask import current_app

    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    attachment = NodeAttachment.query.filter_by(id=attachment_id, node_id=node_id).first()
    if not attachment:
        return error('Attachment not found', 404)

    if not can_transcribe(attachment.mime_type, attachment.original_filename):
        return error(
            f'Transcription not supported for {attachment.mime_type}. '
            'Supported: audio (MP3, WAV, FLAC, AAC, OGG) and video (MP4, MOV, AVI, MKV).', 400
        )

    data = request.get_json(silent=True) or {}
    model_size = data.get('model_size', 'medium')
    if model_size not in ('tiny', 'base', 'small', 'medium', 'large'):
        model_size = 'medium'

    existing = BackgroundTask.query.filter_by(
        entity_type='node_attachment',
        entity_id=attachment_id,
        task_type='whisper',
        status='running',
    ).first()
    if existing:
        return error('Transcription already running for this attachment', 409)

    task = BackgroundTask(
        institution_id=institution_id,
        created_by_id=current_user.id,
        task_type='whisper',
        entity_type='node_attachment',
        entity_id=attachment_id,
        result={'model_size': model_size},
    )
    db.session.add(task)
    db.session.commit()

    from app.tasks.whisper_ import run_whisper
    run_in_background(current_app._get_current_object(), task.id, run_whisper)

    return success({'task_id': task.id, 'status': 'pending', 'model_size': model_size}, 201)