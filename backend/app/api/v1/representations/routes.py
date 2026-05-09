from flask import request
from flask_login import login_required, current_user
from app.api.v1 import bp
from app.api.v1.helpers import success, error, require_write, require_institution_admin
from app.extensions import db
from app.models.representation import RepresentationType, NodeRepresentation
from app.models.node import NodeAttachment
import sqlalchemy as sa


def _serialize_rep_type(rt: RepresentationType) -> dict:
    return {
        'id': rt.id,
        'name': rt.name,
        'description': rt.description,
        'sort_order': rt.sort_order,
    }


def _serialize_representation(rep: NodeRepresentation) -> dict:
    return {
        'id': rep.id,
        'node_id': rep.node_id,
        'rep_type_id': rep.rep_type_id,
        'rep_type_name': rep.rep_type_obj.name if rep.rep_type_obj else None,
        'label': rep.label,
        'note': rep.note,
        'created_at': rep.created_at.isoformat(),
        'created_by': rep.created_by.username if rep.created_by else None,
        'files': [_serialize_rep_file(f) for f in rep.files],
    }


def _serialize_rep_file(attachment: NodeAttachment) -> dict:
    return {
        'id': attachment.id,
        'original_filename': attachment.original_filename,
        'file_size': attachment.file_size,
        'mime_type': attachment.mime_type,
        'description': attachment.description,
        'uploaded_at': attachment.uploaded_at.isoformat(),
        'uploaded_by': attachment.uploaded_by.username if attachment.uploaded_by else None,
        'checksum_md5': attachment.checksum_md5,
        'checksum_sha256': attachment.checksum_sha256,
        'pronom_id': attachment.pronom_id,
        'image_width': attachment.image_width,
        'image_height': attachment.image_height,
        'image_dpi_x': attachment.image_dpi_x,
        'image_dpi_y': attachment.image_dpi_y,
        'image_mode': attachment.image_mode,
        'image_bit_depth': attachment.image_bit_depth,
        'duration_seconds': attachment.duration_seconds,
        'av_codec': attachment.av_codec,
        'av_bitrate': attachment.av_bitrate,
        'has_thumbnail': attachment.thumbnail_path is not None,
        'tech_extracted_at': attachment.tech_extracted_at.isoformat() if attachment.tech_extracted_at else None,
        'extracted_text': bool(attachment.extracted_text),
        'extracted_text_at': attachment.extracted_text_at.isoformat() if attachment.extracted_text_at else None,
    }


# ── Require institution admin helper (reuse pattern from hierarchy routes) ──

# ══════════════════════════════════════════════════════════════════════
# REPRESENTATION TYPE VOCABULARY (institution admin)
# ══════════════════════════════════════════════════════════════════════

# GET /api/v1/representation-types
@bp.route('/representation-types', methods=['GET'])
@login_required
def list_representation_types():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)
    types = db.session.execute(
        sa.select(RepresentationType)
        .where(RepresentationType.institution_id == institution_id)
        .order_by(RepresentationType.sort_order, RepresentationType.name)
    ).scalars().all()
    return success([_serialize_rep_type(rt) for rt in types])


# POST /api/v1/representation-types
@bp.route('/representation-types', methods=['POST'])
@login_required
@require_institution_admin
def create_representation_type():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)


    data = request.get_json(silent=True) or {}
    if not data.get('name'):
        return error('name is required', 400)

    existing = RepresentationType.query.filter_by(
        institution_id=institution_id, name=data['name']
    ).first()
    if existing:
        return error(f'A representation type named "{data["name"]}" already exists', 409)

    max_order = db.session.execute(
        sa.select(sa.func.max(RepresentationType.sort_order))
        .where(RepresentationType.institution_id == institution_id)
    ).scalar() or 0

    rt = RepresentationType(
        institution_id=institution_id,
        name=data['name'],
        description=data.get('description'),
        sort_order=data.get('sort_order', max_order + 1),
    )
    db.session.add(rt)
    db.session.commit()
    return success(_serialize_rep_type(rt), 201)


# PATCH /api/v1/representation-types/<id>
@bp.route('/representation-types/<int:rt_id>', methods=['PATCH'])
@login_required
@require_institution_admin
def update_representation_type(rt_id):
    institution_id = current_user.active_institution_id

    rt = RepresentationType.query.filter_by(id=rt_id, institution_id=institution_id).first()
    if not rt:
        return error('Representation type not found', 404)

    data = request.get_json(silent=True) or {}
    if 'name' in data:
        rt.name = data['name']
    if 'description' in data:
        rt.description = data['description']
    if 'sort_order' in data:
        rt.sort_order = data['sort_order']

    db.session.commit()
    return success(_serialize_rep_type(rt))


# DELETE /api/v1/representation-types/<id>
@bp.route('/representation-types/<int:rt_id>', methods=['DELETE'])
@login_required
@require_institution_admin
def delete_representation_type(rt_id):
    institution_id = current_user.active_institution_id

    rt = RepresentationType.query.filter_by(id=rt_id, institution_id=institution_id).first()
    if not rt:
        return error('Representation type not found', 404)

    in_use = db.session.execute(
        sa.select(sa.func.count()).where(NodeRepresentation.rep_type_id == rt_id)
    ).scalar()
    if in_use:
        return error('Cannot delete: representation type is in use', 409)

    db.session.delete(rt)
    db.session.commit()
    return success({'message': 'Deleted'})


# ══════════════════════════════════════════════════════════════════════
# NODE REPRESENTATIONS (archivist)
# ══════════════════════════════════════════════════════════════════════

def _get_node_or_404(node_id, institution_id):
    from app.models.node import Node
    return Node.query.filter_by(id=node_id, institution_id=institution_id).first()


# GET /api/v1/nodes/<id>/representations
@bp.route('/nodes/<int:node_id>/representations', methods=['GET'])
@login_required
def list_representations(node_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    reps = db.session.execute(
        sa.select(NodeRepresentation)
        .where(NodeRepresentation.node_id == node_id)
        .order_by(NodeRepresentation.created_at)
    ).scalars().all()
    return success([_serialize_representation(r) for r in reps])


# POST /api/v1/nodes/<id>/representations
@bp.route('/nodes/<int:node_id>/representations', methods=['POST'])
@login_required
@require_write
def create_representation(node_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    if not node.is_object():
        return error('Node is not an object level — representations can only be added to object nodes', 400)

    data = request.get_json(silent=True) or {}
    if not data.get('rep_type_id'):
        return error('rep_type_id is required', 400)

    rt = RepresentationType.query.filter_by(
        id=data['rep_type_id'], institution_id=institution_id
    ).first()
    if not rt:
        return error('Representation type not found', 404)

    rep = NodeRepresentation(
        node_id=node_id,
        rep_type_id=rt.id,
        label=data.get('label'),
        note=data.get('note'),
        created_by_id=current_user.id,
    )
    db.session.add(rep)
    db.session.commit()
    return success(_serialize_representation(rep), 201)


# PATCH /api/v1/nodes/<id>/representations/<rep_id>
@bp.route('/nodes/<int:node_id>/representations/<int:rep_id>', methods=['PATCH'])
@login_required
@require_write
def update_representation(node_id, rep_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    rep = NodeRepresentation.query.filter_by(id=rep_id, node_id=node_id).first()
    if not rep:
        return error('Representation not found', 404)

    data = request.get_json(silent=True) or {}
    if 'rep_type_id' in data:
        rt = RepresentationType.query.filter_by(
            id=data['rep_type_id'], institution_id=institution_id
        ).first()
        if not rt:
            return error('Representation type not found', 404)
        rep.rep_type_id = rt.id
    if 'label' in data:
        rep.label = data['label']
    if 'note' in data:
        rep.note = data['note']

    db.session.commit()
    return success(_serialize_representation(rep))


# DELETE /api/v1/nodes/<id>/representations/<rep_id>
@bp.route('/nodes/<int:node_id>/representations/<int:rep_id>', methods=['DELETE'])
@login_required
@require_write
def delete_representation(node_id, rep_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    rep = NodeRepresentation.query.filter_by(id=rep_id, node_id=node_id).first()
    if not rep:
        return error('Representation not found', 404)

    # Files (attachments) cascade delete via the relationship
    db.session.delete(rep)
    db.session.commit()
    return success({'message': 'Representation deleted'})


# ══════════════════════════════════════════════════════════════════════
# ASSIGN EXISTING ATTACHMENT TO A REPRESENTATION
# ══════════════════════════════════════════════════════════════════════

# PATCH /api/v1/nodes/<id>/attachments/<attachment_id>/assign-representation
@bp.route('/nodes/<int:node_id>/attachments/<int:attachment_id>/assign-representation', methods=['PATCH'])
@login_required
@require_write
def assign_attachment_to_representation(node_id, attachment_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    attachment = NodeAttachment.query.filter_by(id=attachment_id, node_id=node_id).first()
    if not attachment:
        return error('Attachment not found', 404)

    data = request.get_json(silent=True) or {}
    rep_id = data.get('representation_id')  # pass null to unassign

    if rep_id is not None:
        rep = NodeRepresentation.query.filter_by(id=rep_id, node_id=node_id).first()
        if not rep:
            return error('Representation not found on this node', 404)

    attachment.representation_id = rep_id
    db.session.commit()
    return success({'id': attachment.id, 'representation_id': attachment.representation_id})

# GET /api/v1/nodes/<id>/attachments/<attachment_id>/text
@bp.route('/nodes/<int:node_id>/attachments/<int:attachment_id>/text', methods=['GET'])
@login_required
def get_attachment_text(node_id, attachment_id):
    institution_id = current_user.active_institution_id
    node = _get_node_or_404(node_id, institution_id)
    if not node:
        return error('Node not found', 404)

    attachment = NodeAttachment.query.filter_by(id=attachment_id, node_id=node_id).first()
    if not attachment:
        return error('Attachment not found', 404)

    if not attachment.extracted_text:
        return error('No extracted text available', 404)

    from flask import Response
    filename = attachment.original_filename.rsplit('.', 1)[0] + '_extracted.txt'
    return Response(
        attachment.extracted_text,
        mimetype='text/plain; charset=utf-8',
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"',
        }
    )