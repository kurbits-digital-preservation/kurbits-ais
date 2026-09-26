from datetime import datetime
from flask import request
from flask_login import login_required, current_user
from app.api.v1 import bp
from app.api.v1.helpers import success, error, require_write
from app.extensions import db
from app.models.acquisitions import (
    SubmissionAgreement, SAAttachment, Delivery, Accession,
    DEFAULT_CHECKLIST, accession_nodes
)
import sqlalchemy as sa



def _date(val):
    """Convert ISO date string or None/empty to a Python date object."""
    from datetime import date as date_cls
    if not val:
        return None
    if isinstance(val, date_cls):
        return val
    try:
        return date_cls.fromisoformat(str(val))
    except (ValueError, TypeError):
        return None


def _int(val) -> 'int | None':
    if not val and val != 0:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def _next_ref(model, institution_id: int, prefix: str) -> str:
    """Generate next running number: SA-1, SA-2, DEL-1 etc."""
    count = db.session.execute(
        sa.select(sa.func.count()).where(model.institution_id == institution_id)
    ).scalar() or 0
    return f'{prefix}-{count + 1}'


@bp.route('/submission-agreements', methods=['GET'])
@login_required
def list_submission_agreements():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    status = request.args.get('status')
    q = request.args.get('q', '').strip()

    stmt = sa.select(SubmissionAgreement).where(
        SubmissionAgreement.institution_id == institution_id
    )
    if status:
        stmt = stmt.where(SubmissionAgreement.status == status)
    if q:
        stmt = stmt.where(
            sa.or_(
                SubmissionAgreement.title.ilike(f'%{q}%'),
                SubmissionAgreement.reference_number.ilike(f'%{q}%'),
            )
        )
    items = db.session.execute(
        stmt.order_by(SubmissionAgreement.created_at.desc())
    ).scalars().all()
    return success([i.to_dict() for i in items])


@bp.route('/submission-agreements', methods=['POST'])
@login_required
@require_write
def create_submission_agreement():
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}
    if not data.get('title'):
        return error('title is required', 400)

    sa_obj = SubmissionAgreement(
        institution_id=institution_id,
        reference_number=_next_ref(SubmissionAgreement, institution_id, 'SA'),
        title=data['title'].strip(),
        agent_id=data.get('agent_id') or None,
        status=data.get('status', 'draft'),
        agreement_date=_date(data.get('agreement_date')),
        review_date=_date(data.get('review_date')),
        delivery_schedule=data.get('delivery_schedule'),
        scope_and_content=data.get('scope_and_content'),
        access_conditions=data.get('access_conditions'),
        appraisal_notes=data.get('appraisal_notes'),
        disposition_authority=data.get('disposition_authority'),
        notes=data.get('notes'),
        created_by_id=current_user.id,
    )
    db.session.add(sa_obj)
    db.session.commit()
    return success(sa_obj.to_dict(), 201)


@bp.route('/submission-agreements/<int:sa_id>', methods=['GET'])
@login_required
def get_submission_agreement(sa_id):
    institution_id = current_user.active_institution_id
    obj = SubmissionAgreement.query.filter_by(
        id=sa_id, institution_id=institution_id
    ).first()
    if not obj:
        return error('Not found', 404)
    return success(obj.to_dict())


@bp.route('/submission-agreements/<int:sa_id>', methods=['PATCH'])
@login_required
@require_write
def update_submission_agreement(sa_id):
    institution_id = current_user.active_institution_id
    obj = SubmissionAgreement.query.filter_by(
        id=sa_id, institution_id=institution_id
    ).first()
    if not obj:
        return error('Not found', 404)
    data = request.get_json(silent=True) or {}
    for field in ('title', 'agent_id', 'status',
                  'delivery_schedule', 'scope_and_content', 'access_conditions',
                  'appraisal_notes', 'disposition_authority', 'notes'):
        if field in data:
            setattr(obj, field, data[field])
    for date_field in ('agreement_date', 'review_date'):
        if date_field in data:
            setattr(obj, date_field, _date(data[date_field]))
    obj.updated_at = datetime.utcnow()
    db.session.commit()
    return success(obj.to_dict())


@bp.route('/submission-agreements/<int:sa_id>', methods=['DELETE'])
@login_required
@require_write
def delete_submission_agreement(sa_id):
    institution_id = current_user.active_institution_id
    obj = SubmissionAgreement.query.filter_by(
        id=sa_id, institution_id=institution_id
    ).first()
    if not obj:
        return error('Not found', 404)
    db.session.delete(obj)
    db.session.commit()
    return success({'message': 'Deleted'})


@bp.route('/submission-agreements/<int:sa_id>/attachments', methods=['POST'])
@login_required
@require_write
def upload_sa_attachment(sa_id):
    import os, uuid
    from werkzeug.utils import secure_filename
    from flask import current_app

    institution_id = current_user.active_institution_id
    obj = SubmissionAgreement.query.filter_by(
        id=sa_id, institution_id=institution_id
    ).first()
    if not obj:
        return error('Not found', 404)
    if 'file' not in request.files:
        return error('No file uploaded', 400)

    f = request.files['file']
    if not f.filename:
        return error('No file selected', 400)

    original_filename = secure_filename(f.filename)
    stored_filename = f'{uuid.uuid4().hex}_{original_filename}'
    upload_dir = os.path.join(
        current_app.config['UPLOAD_FOLDER'], str(institution_id), 'sa', str(sa_id)
    )
    os.makedirs(upload_dir, exist_ok=True)
    file_path = os.path.join(upload_dir, stored_filename)
    f.save(file_path)
    file_size = os.path.getsize(file_path)

    attachment = SAAttachment(
        submission_agreement_id=sa_id,
        filename=stored_filename,
        original_filename=original_filename,
        mime_type=f.content_type or 'application/octet-stream',
        file_size=file_size,
        description=request.form.get('description'),
        uploaded_by_id=current_user.id,
    )
    db.session.add(attachment)
    db.session.commit()
    return success(attachment.to_dict(), 201)


@bp.route('/submission-agreements/<int:sa_id>/attachments/<int:att_id>/download', methods=['GET'])
@login_required
def download_sa_attachment(sa_id, att_id):
    import os
    from flask import current_app, send_from_directory
    institution_id = current_user.active_institution_id
    att = SAAttachment.query.filter_by(id=att_id, submission_agreement_id=sa_id).first()
    if not att:
        return error('Not found', 404)
    upload_dir = os.path.join(
        current_app.config['UPLOAD_FOLDER'], str(institution_id), 'sa', str(sa_id)
    )
    INLINE_TYPES = {'image/png', 'image/jpeg', 'image/gif', 'image/webp',
                    'image/tiff', 'application/pdf', 'text/plain'}
    as_attachment = att.mime_type not in INLINE_TYPES
    return send_from_directory(
        upload_dir, att.filename,
        download_name=att.original_filename,
        as_attachment=as_attachment,
        mimetype=att.mime_type or 'application/octet-stream',
    )


@bp.route('/submission-agreements/<int:sa_id>/attachments/<int:att_id>', methods=['DELETE'])
@login_required
@require_write
def delete_sa_attachment(sa_id, att_id):
    att = SAAttachment.query.filter_by(id=att_id, submission_agreement_id=sa_id).first()
    if not att:
        return error('Not found', 404)
    db.session.delete(att)
    db.session.commit()
    return success({'message': 'Deleted'})


def _template_items_to_checklist(items: list) -> list:
    return [{'key': i.get('key') or i['label'].lower().replace(' ', '_'),
             'label': i['label'], 'checked': False, 'note': ''}
            for i in items]


def _resolve_checklist(institution_id: int, delivery_method: str | None,
                        template_id: int | None = None) -> list:
    """Find best matching checklist template, fall back to defaults."""
    from app.models.acquisitions import DeliveryChecklistTemplate

    # Explicit template wins
    if template_id:
        t = DeliveryChecklistTemplate.query.filter_by(
            id=template_id, institution_id=institution_id
        ).first()
        if t:
            return _template_items_to_checklist(t.items)

    # Method-specific default
    if delivery_method:
        t = DeliveryChecklistTemplate.query.filter_by(
            institution_id=institution_id,
            delivery_method=delivery_method,
            is_default=True,
        ).first()
        if t:
            return _template_items_to_checklist(t.items)

    # Generic default (no method)
    t = DeliveryChecklistTemplate.query.filter_by(
        institution_id=institution_id,
        delivery_method=None,
        is_default=True,
    ).first()
    if t:
        return _template_items_to_checklist(t.items)

    return list(DEFAULT_CHECKLIST)


@bp.route('/deliveries', methods=['GET'])
@login_required
def list_deliveries():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    sa_id = request.args.get('submission_agreement_id', type=int)
    status = request.args.get('status')

    stmt = sa.select(Delivery).where(Delivery.institution_id == institution_id)
    if sa_id:
        stmt = stmt.where(Delivery.submission_agreement_id == sa_id)
    if status:
        stmt = stmt.where(Delivery.status == status)

    items = db.session.execute(
        stmt.order_by(Delivery.created_at.desc())
    ).scalars().all()
    return success([i.to_dict() for i in items])


@bp.route('/deliveries', methods=['POST'])
@login_required
@require_write
def create_delivery():
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}
    if not data.get('title'):
        return error('title is required', 400)

    delivery = Delivery(
        institution_id=institution_id,
        reference_number=_next_ref(Delivery, institution_id, 'DEL'),
        title=data['title'].strip(),
        submission_agreement_id=data.get('submission_agreement_id'),
        status=data.get('status', 'expected'),
        delivery_method=data.get('delivery_method'),
        delivery_date=_date(data.get('delivery_date')),
        description=data.get('description'),
        item_count=data.get('item_count'),
        physical_extent=data.get('physical_extent'),
        size_bytes=data.get('size_bytes'),
        notes=data.get('notes'),
        checklist=_resolve_checklist(institution_id, data.get('delivery_method')),
        created_by_id=current_user.id,
    )
    db.session.add(delivery)
    db.session.commit()
    return success(delivery.to_dict(), 201)


@bp.route('/deliveries/<int:delivery_id>', methods=['GET'])
@login_required
def get_delivery(delivery_id):
    delivery = Delivery.query.filter_by(
        id=delivery_id, institution_id=current_user.active_institution_id
    ).first()
    if not delivery:
        return error('Not found', 404)
    return success(delivery.to_dict())


@bp.route('/deliveries/<int:delivery_id>', methods=['PATCH'])
@login_required
@require_write
def update_delivery(delivery_id):
    delivery = Delivery.query.filter_by(
        id=delivery_id, institution_id=current_user.active_institution_id
    ).first()
    if not delivery:
        return error('Not found', 404)
    data = request.get_json(silent=True) or {}

    for field in ('title', 'status', 'delivery_method',
                  'description', 'item_count', 'physical_extent',
                  'size_bytes', 'notes', 'submission_agreement_id'):
        if field in data:
            setattr(delivery, field, data[field])
    if 'delivery_date' in data:
        delivery.delivery_date = _date(data['delivery_date'])

    # Mark received timestamp when status changes to received
    if data.get('status') in ('received', 'in_review', 'accepted', 'partially_accepted') \
            and not delivery.received_at:
        delivery.received_at = datetime.utcnow()
        delivery.received_by_id = current_user.id

    if 'checklist' in data:
        delivery.checklist = data['checklist']

    delivery.updated_at = datetime.utcnow()
    db.session.commit()
    return success(delivery.to_dict())


@bp.route('/deliveries/<int:delivery_id>', methods=['DELETE'])
@login_required
@require_write
def delete_delivery(delivery_id):
    delivery = Delivery.query.filter_by(
        id=delivery_id, institution_id=current_user.active_institution_id
    ).first()
    if not delivery:
        return error('Not found', 404)
    db.session.delete(delivery)
    db.session.commit()
    return success({'message': 'Deleted'})


@bp.route('/deliveries/<int:delivery_id>/checklist', methods=['PATCH'])
@login_required
@require_write
def update_checklist(delivery_id):
    delivery = Delivery.query.filter_by(
        id=delivery_id, institution_id=current_user.active_institution_id
    ).first()
    if not delivery:
        return error('Not found', 404)
    data = request.get_json(silent=True) or {}
    delivery.checklist = data.get('checklist', delivery.checklist)
    delivery.updated_at = datetime.utcnow()
    db.session.commit()
    return success(delivery.to_dict())


@bp.route('/accessions', methods=['GET'])
@login_required
def list_accessions():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    status = request.args.get('status')
    delivery_id = request.args.get('delivery_id', type=int)
    sa_id = request.args.get('submission_agreement_id', type=int)

    stmt = sa.select(Accession).where(Accession.institution_id == institution_id)
    if status:
        stmt = stmt.where(Accession.status == status)
    if delivery_id:
        stmt = stmt.where(Accession.delivery_id == delivery_id)
    if sa_id:
        stmt = stmt.where(Accession.submission_agreement_id == sa_id)

    items = db.session.execute(
        stmt.order_by(Accession.created_at.desc())
    ).scalars().all()
    return success([i.to_dict() for i in items])


@bp.route('/accessions', methods=['POST'])
@login_required
@require_write
def create_accession():
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}
    if not data.get('title'):
        return error('title is required', 400)

    accession = Accession(
        institution_id=institution_id,
        accession_number=_next_ref(Accession, institution_id, 'ACC'),
        title=data['title'].strip(),
        delivery_id=data.get('delivery_id'),
        submission_agreement_id=data.get('submission_agreement_id'),
        status=data.get('status', 'open'),
        date_received=_date(data.get('date_received')),
        date_accessioned=_date(data.get('date_accessioned')),
        creator_agent_id=data.get('creator_agent_id') or None,
        extent=data.get('extent'),
        description=data.get('description'),
        appraisal_decision=data.get('appraisal_decision'),
        disposition_notes=data.get('disposition_notes'),
        access_restrictions=data.get('access_restrictions'),
        processing_notes=data.get('processing_notes'),
        accessioned_by_id=data.get('accessioned_by_id') or current_user.id,
        created_by_id=current_user.id,
    )
    db.session.add(accession)
    db.session.commit()
    return success(accession.to_dict(), 201)


@bp.route('/accessions/<int:accession_id>', methods=['GET'])
@login_required
def get_accession(accession_id):
    accession = Accession.query.filter_by(
        id=accession_id, institution_id=current_user.active_institution_id
    ).first()
    if not accession:
        return error('Not found', 404)
    return success(accession.to_dict())


@bp.route('/accessions/<int:accession_id>', methods=['PATCH'])
@login_required
@require_write
def update_accession(accession_id):
    accession = Accession.query.filter_by(
        id=accession_id, institution_id=current_user.active_institution_id
    ).first()
    if not accession:
        return error('Not found', 404)
    data = request.get_json(silent=True) or {}
    for field in ('title', 'status', 'delivery_id', 'submission_agreement_id',
                  'creator_agent_id',
                  'extent', 'description', 'appraisal_decision',
                  'disposition_notes', 'access_restrictions',
                  'processing_notes', 'accessioned_by_id'):
        if field in data:
            setattr(accession, field, data[field])
    for date_field in ('date_received', 'date_accessioned'):
        if date_field in data:
            setattr(accession, date_field, _date(data[date_field]))
    accession.updated_at = datetime.utcnow()
    db.session.commit()
    return success(accession.to_dict())


@bp.route('/accessions/<int:accession_id>', methods=['DELETE'])
@login_required
@require_write
def delete_accession(accession_id):
    accession = Accession.query.filter_by(
        id=accession_id, institution_id=current_user.active_institution_id
    ).first()
    if not accession:
        return error('Not found', 404)
    db.session.delete(accession)
    db.session.commit()
    return success({'message': 'Deleted'})



@bp.route('/accessions/<int:accession_id>/nodes', methods=['GET'])
@login_required
def get_accession_nodes(accession_id):
    accession = Accession.query.filter_by(
        id=accession_id, institution_id=current_user.active_institution_id
    ).first()
    if not accession:
        return error('Not found', 404)
    from app.api.v1.nodes.serializers import serialize_node_stub
    return success([serialize_node_stub(n) for n in accession.nodes])


@bp.route('/accessions/<int:accession_id>/nodes', methods=['POST'])
@login_required
@require_write
def link_accession_node(accession_id):
    accession = Accession.query.filter_by(
        id=accession_id, institution_id=current_user.active_institution_id
    ).first()
    if not accession:
        return error('Not found', 404)
    data = request.get_json(silent=True) or {}
    node_id = data.get('node_id')
    if not node_id:
        return error('node_id is required', 400)
    from app.models.node import Node
    node = Node.query.filter_by(
        id=node_id, institution_id=current_user.active_institution_id
    ).first()
    if not node:
        return error('Node not found', 404)
    try:
        db.session.execute(
            accession_nodes.insert().values(accession_id=accession_id, node_id=node_id)
        )
        db.session.flush()
    except Exception:
        db.session.rollback()
    db.session.commit()
    return success({'message': 'Linked'})


@bp.route('/accessions/<int:accession_id>/nodes/<int:node_id>', methods=['DELETE'])
@login_required
@require_write
def unlink_accession_node(accession_id, node_id):
    db.session.execute(
        sa.delete(accession_nodes).where(
            accession_nodes.c.accession_id == accession_id,
            accession_nodes.c.node_id == node_id,
        )
    )
    db.session.commit()
    return success({'message': 'Unlinked'})


@bp.route('/vocab/checklist-templates', methods=['GET'])
@login_required
def list_checklist_templates():
    institution_id = current_user.active_institution_id
    from app.models.acquisitions import DeliveryChecklistTemplate
    templates = DeliveryChecklistTemplate.query.filter_by(
        institution_id=institution_id
    ).order_by(
        DeliveryChecklistTemplate.sort_order,
        DeliveryChecklistTemplate.name
    ).all()
    return success([t.to_dict() for t in templates])


@bp.route('/vocab/checklist-templates', methods=['POST'])
@login_required
@require_write
def create_checklist_template():
    institution_id = current_user.active_institution_id
    from app.models.acquisitions import DeliveryChecklistTemplate
    data = request.get_json(silent=True) or {}
    if not data.get('name'):
        return error('name is required', 400)

    # If marked as default, unset other defaults for same method
    if data.get('is_default'):
        existing_defaults = DeliveryChecklistTemplate.query.filter_by(
            institution_id=institution_id,
            delivery_method=data.get('delivery_method'),
            is_default=True,
        ).all()
        for e in existing_defaults:
            e.is_default = False

    t = DeliveryChecklistTemplate(
        institution_id=institution_id,
        name=data['name'].strip(),
        delivery_method=data.get('delivery_method') or None,
        is_default=bool(data.get('is_default', False)),
        items=data.get('items', []),
        sort_order=data.get('sort_order', 0),
    )
    db.session.add(t)
    db.session.commit()
    return success(t.to_dict(), 201)


@bp.route('/vocab/checklist-templates/<int:template_id>', methods=['PATCH'])
@login_required
@require_write
def update_checklist_template(template_id):
    institution_id = current_user.active_institution_id
    from app.models.acquisitions import DeliveryChecklistTemplate
    t = DeliveryChecklistTemplate.query.filter_by(
        id=template_id, institution_id=institution_id
    ).first()
    if not t:
        return error('Not found', 404)
    data = request.get_json(silent=True) or {}
    for field in ('name', 'delivery_method', 'is_default', 'items', 'sort_order'):
        if field in data:
            setattr(t, field, data[field] if field != 'delivery_method' else (data[field] or None))
    db.session.commit()
    return success(t.to_dict())


@bp.route('/vocab/checklist-templates/<int:template_id>', methods=['DELETE'])
@login_required
@require_write
def delete_checklist_template(template_id):
    institution_id = current_user.active_institution_id
    from app.models.acquisitions import DeliveryChecklistTemplate
    t = DeliveryChecklistTemplate.query.filter_by(
        id=template_id, institution_id=institution_id
    ).first()
    if not t:
        return error('Not found', 404)
    db.session.delete(t)
    db.session.commit()
    return success({'message': 'Deleted'})