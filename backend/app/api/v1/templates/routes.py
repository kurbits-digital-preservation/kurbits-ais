from flask import request
from flask_login import login_required, current_user
from app.api.v1 import bp
from app.api.v1.helpers import success, error, require_institution_admin, require_write
from app.extensions import db
from app.models.metadata_template import MetadataTemplate


def _serialize(t: MetadataTemplate) -> dict:
    return {
        'id': t.id,
        'name': t.name,
        'description': t.description,
        'entity_type': t.entity_type,
        'fields': t.fields or [],
    }


# GET /api/v1/templates?entity_type=resource
@bp.route('/templates', methods=['GET'])
@login_required
def list_templates():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    entity_type = request.args.get('entity_type')
    import sqlalchemy as sa
    q = sa.select(MetadataTemplate).where(
        MetadataTemplate.institution_id == institution_id
    )
    if entity_type:
        q = q.where(MetadataTemplate.entity_type == entity_type)
    templates = db.session.execute(q.order_by(MetadataTemplate.name)).scalars().all()
    return success([_serialize(t) for t in templates])


# POST /api/v1/templates
@bp.route('/templates', methods=['POST'])
@login_required
@require_institution_admin
def create_template():
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}

    if not data.get('name'):
        return error('name is required', 400)

    t = MetadataTemplate(
        institution_id=institution_id,
        name=data['name'],
        description=data.get('description'),
        entity_type=data.get('entity_type', 'resource'),
        fields=data.get('fields', []),
    )
    db.session.add(t)
    db.session.commit()
    return success(_serialize(t), 201)


# PATCH /api/v1/templates/<id>
@bp.route('/templates/<int:template_id>', methods=['PATCH'])
@login_required
@require_institution_admin
def update_template(template_id):
    institution_id = current_user.active_institution_id
    t = MetadataTemplate.query.filter_by(
        id=template_id, institution_id=institution_id
    ).first()
    if not t:
        return error('Template not found', 404)

    data = request.get_json(silent=True) or {}
    if 'name' in data:
        t.name = data['name']
    if 'description' in data:
        t.description = data['description']
    if 'fields' in data:
        t.fields = data['fields']

    db.session.commit()
    return success(_serialize(t))


# DELETE /api/v1/templates/<id>
@bp.route('/templates/<int:template_id>', methods=['DELETE'])
@login_required
@require_institution_admin
def delete_template(template_id):
    institution_id = current_user.active_institution_id
    t = MetadataTemplate.query.filter_by(
        id=template_id, institution_id=institution_id
    ).first()
    if not t:
        return error('Template not found', 404)

    db.session.delete(t)
    db.session.commit()
    return success({'message': 'Deleted'})


# POST /api/v1/templates/import
# Import one or more templates from Kurbits JSON format
@bp.route('/templates/import', methods=['POST'])
@login_required
@require_write
def import_templates():
    from flask_login import current_user
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    if 'file' not in request.files:
        return error('No file uploaded', 400)

    import json
    try:
        data = json.loads(request.files['file'].read().decode('utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        return error(f'Invalid JSON: {e}', 400)

    templates = data if isinstance(data, list) else [data]

    created, skipped = [], []
    for tpl in templates:
        name = (tpl.get('name') or '').strip()
        if not name:
            skipped.append('Template missing name')
            continue

        # Upsert by name+institution
        existing = MetadataTemplate.query.filter_by(
            institution_id=institution_id, name=name
        ).first()

        if existing:
            existing.description = tpl.get('description') or existing.description
            existing.entity_type  = tpl.get('entity_type', existing.entity_type)
            existing.fields       = tpl.get('fields', existing.fields)
            created.append({'name': name, 'action': 'updated'})
        else:
            t = MetadataTemplate(
                institution_id=institution_id,
                name=name,
                description=tpl.get('description'),
                entity_type=tpl.get('entity_type', 'resource'),
                fields=tpl.get('fields', []),
            )
            db.session.add(t)
            created.append({'name': name, 'action': 'created'})

    db.session.commit()
    return success({'imported': created, 'skipped': skipped, 'total': len(created)}, 201)