from flask import request
from flask_login import login_required, current_user
from app.api.v1 import bp
from app.api.v1.helpers import success, error, require_institution_admin
from app.extensions import db
from app.models import HierarchyType, HierarchyLevel, HierarchyEntityType
from app.models.hierarchy import hierarchy_level_relationships
import sqlalchemy as sa


# ── Serializers ───────────────────────────────────────────────────────

def _serialize_type(ht: HierarchyType) -> dict:
    return {
        'id': ht.id,
        'name': ht.name,
        'description': ht.description,
        'entity_type': ht.entity_type.value,
        'is_default': ht.is_default,
        'level_count': len(ht.levels),
    }


def _serialize_level(level: HierarchyLevel) -> dict:
    allowed_parent_ids = [p.id for p in level.allowed_parents]
    allowed_children_ids = [
        c.id for c in db.session.execute(
            sa.select(HierarchyLevel)
            .join(hierarchy_level_relationships,
                  HierarchyLevel.id == hierarchy_level_relationships.c.child_id)
            .where(hierarchy_level_relationships.c.parent_id == level.id)
        ).scalars().all()
    ]
    return {
        'id': level.id,
        'name': level.name,
        'description': level.description,
        'sort_order': level.sort_order,
        'can_have_location': level.can_have_location,
        'metadata_schema': level.metadata_schema or {'fields': []},
        'allowed_parent_ids': allowed_parent_ids,
        'allowed_children_ids': allowed_children_ids,
        'is_object_level': level.is_object_level,
    }


# ── Hierarchy Types ───────────────────────────────────────────────────

# GET /api/v1/hierarchy/types
@bp.route('/hierarchy/types', methods=['GET'])
@login_required
def list_hierarchy_types():
    if not current_user.active_institution_id:
        return error('No active institution', 400)

    entity_type = request.args.get('entity_type')
    query = sa.select(HierarchyType).where(
        HierarchyType.institution_id == current_user.active_institution_id
    )
    if entity_type:
        query = query.where(HierarchyType.entity_type == entity_type)

    types = db.session.execute(query.order_by(HierarchyType.name)).scalars().all()
    return success([_serialize_type(ht) for ht in types])


# POST /api/v1/hierarchy/types
@bp.route('/hierarchy/types', methods=['POST'])
@login_required
@require_institution_admin
def create_hierarchy_type():
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}

    required = ['name', 'entity_type']
    missing = [f for f in required if not data.get(f)]
    if missing:
        return error(f'Missing required fields: {", ".join(missing)}', 400)

    valid_types = [e.value for e in HierarchyEntityType]
    if data['entity_type'] not in valid_types:
        return error(f'Invalid entity_type. Must be one of: {", ".join(valid_types)}', 400)

    existing = HierarchyType.query.filter_by(
        institution_id=institution_id, name=data['name']
    ).first()
    if existing:
        return error(f'A hierarchy type named "{data["name"]}" already exists', 409)

    ht = HierarchyType(
        institution_id=institution_id,
        name=data['name'],
        description=data.get('description'),
        entity_type=HierarchyEntityType(data['entity_type']),
        is_default=data.get('is_default', False),
    )
    db.session.add(ht)
    db.session.commit()
    return success(_serialize_type(ht), 201)


# PATCH /api/v1/hierarchy/types/<id>
@bp.route('/hierarchy/types/<int:type_id>', methods=['PATCH'])
@login_required
@require_institution_admin
def update_hierarchy_type(type_id):
    ht = HierarchyType.query.filter_by(
        id=type_id, institution_id=current_user.active_institution_id
    ).first()
    if not ht:
        return error('Hierarchy type not found', 404)

    data = request.get_json(silent=True) or {}
    if 'name' in data:
        ht.name = data['name']
    if 'description' in data:
        ht.description = data['description']
    if 'is_default' in data:
        ht.is_default = data['is_default']

    db.session.commit()
    return success(_serialize_type(ht))


# DELETE /api/v1/hierarchy/types/<id>
@bp.route('/hierarchy/types/<int:type_id>', methods=['DELETE'])
@login_required
@require_institution_admin
def delete_hierarchy_type(type_id):
    ht = HierarchyType.query.filter_by(
        id=type_id, institution_id=current_user.active_institution_id
    ).first()
    if not ht:
        return error('Hierarchy type not found', 404)

    from app.models import Node
    node_count = Node.query.filter_by(hierarchy_type_id=type_id).count()
    if node_count > 0:
        return error(
            f'Cannot delete: {node_count} resource(s) use this hierarchy type', 409
        )

    db.session.delete(ht)
    db.session.commit()
    return success({'message': 'Hierarchy type deleted'})


# ── Hierarchy Levels ──────────────────────────────────────────────────

# GET /api/v1/hierarchy/types/<id>/levels
@bp.route('/hierarchy/types/<int:type_id>/levels', methods=['GET'])
@login_required
def list_levels(type_id):
    ht = HierarchyType.query.filter_by(
        id=type_id, institution_id=current_user.active_institution_id
    ).first()
    if not ht:
        return error('Hierarchy type not found', 404)

    levels = sorted(ht.levels, key=lambda l: l.sort_order)
    return success([_serialize_level(l) for l in levels])


# POST /api/v1/hierarchy/types/<id>/levels
@bp.route('/hierarchy/types/<int:type_id>/levels', methods=['POST'])
@login_required
@require_institution_admin
def create_level(type_id):
    ht = HierarchyType.query.filter_by(
        id=type_id, institution_id=current_user.active_institution_id
    ).first()
    if not ht:
        return error('Hierarchy type not found', 404)

    data = request.get_json(silent=True) or {}
    if not data.get('name'):
        return error('name is required', 400)

    existing = HierarchyLevel.query.filter_by(
        hierarchy_type_id=type_id, name=data['name']
    ).first()
    if existing:
        return error(f'A level named "{data["name"]}" already exists in this hierarchy', 409)

    max_order = db.session.execute(
        sa.select(sa.func.max(HierarchyLevel.sort_order))
        .where(HierarchyLevel.hierarchy_type_id == type_id)
    ).scalar() or 0

    level = HierarchyLevel(
        hierarchy_type_id=type_id,
        name=data['name'],
        description=data.get('description'),
        sort_order=data.get('sort_order', max_order + 1),
        can_have_location=data.get('can_have_location', False),
        metadata_schema=data.get('metadata_schema', {'fields': []}),
    )
    db.session.add(level)
    db.session.commit()
    return success(_serialize_level(level), 201)


# PATCH /api/v1/hierarchy/types/<id>/levels/<level_id>
@bp.route('/hierarchy/types/<int:type_id>/levels/<int:level_id>', methods=['PATCH'])
@login_required
@require_institution_admin
def update_level(type_id, level_id):
    level = HierarchyLevel.query.filter_by(
        id=level_id, hierarchy_type_id=type_id
    ).first()
    if not level:
        return error('Level not found', 404)

    data = request.get_json(silent=True) or {}
    if 'name' in data:
        level.name = data['name']
    if 'description' in data:
        level.description = data['description']
    if 'sort_order' in data:
        level.sort_order = data['sort_order']
    if 'can_have_location' in data:
        level.save_can_have_location(data['can_have_location'])
    if 'metadata_schema' in data:
        level.metadata_schema = data['metadata_schema']
    if 'is_object_level' in data:
        level.is_object_level = bool(data['is_object_level'])

    db.session.commit()
    return success(_serialize_level(level))


# DELETE /api/v1/hierarchy/types/<id>/levels/<level_id>
@bp.route('/hierarchy/types/<int:type_id>/levels/<int:level_id>', methods=['DELETE'])
@login_required
@require_institution_admin
def delete_level(type_id, level_id):
    level = HierarchyLevel.query.filter_by(
        id=level_id, hierarchy_type_id=type_id
    ).first()
    if not level:
        return error('Level not found', 404)

    from app.models import Node
    node_count = Node.query.filter_by(
        hierarchy_type_id=type_id,
        level_of_description=level.name
    ).count()
    if node_count > 0:
        return error(
            f'Cannot delete: {node_count} resource(s) use this level', 409
        )

    db.session.delete(level)
    db.session.commit()
    return success({'message': 'Level deleted'})


# ── Level relationships ───────────────────────────────────────────────

# PUT /api/v1/hierarchy/types/<id>/levels/<level_id>/parents
# Replaces the full set of allowed parents for a level
@bp.route('/hierarchy/types/<int:type_id>/levels/<int:level_id>/parents', methods=['PUT'])
@login_required
@require_institution_admin
def set_level_parents(type_id, level_id):
    level = HierarchyLevel.query.filter_by(
        id=level_id, hierarchy_type_id=type_id
    ).first()
    if not level:
        return error('Level not found', 404)

    data = request.get_json(silent=True) or {}
    parent_ids: list[int] = data.get('parent_ids', [])

    if level_id in parent_ids:
        return error('A level cannot be its own parent', 422)

    # Validate all parent IDs belong to this hierarchy
    parents = HierarchyLevel.query.filter(
        HierarchyLevel.id.in_(parent_ids),
        HierarchyLevel.hierarchy_type_id == type_id,
    ).all() if parent_ids else []

    if len(parents) != len(parent_ids):
        return error('One or more parent IDs are invalid', 422)

    # Replace via direct SQL to avoid autoflush issues
    db.session.execute(
        hierarchy_level_relationships.delete().where(
            hierarchy_level_relationships.c.child_id == level_id
        )
    )
    for parent in parents:
        db.session.execute(
            hierarchy_level_relationships.insert().values(
                parent_id=parent.id, child_id=level_id
            )
        )

    db.session.commit()
    return success(_serialize_level(level))


# ── Read-only helpers (used by NodeForm) ──────────────────────────────

# GET /api/v1/hierarchy/valid-levels
@bp.route('/hierarchy/valid-levels', methods=['GET'])
@login_required
def get_valid_levels():
    if not current_user.active_institution_id:
        return error('No active institution', 400)

    hierarchy_type_id = request.args.get('hierarchy_type_id', type=int)
    parent_level = request.args.get('parent_level')

    if not hierarchy_type_id:
        return error('hierarchy_type_id is required', 400)

    ht = HierarchyType.query.filter_by(
        id=hierarchy_type_id,
        institution_id=current_user.active_institution_id
    ).first()
    if not ht:
        return error('Hierarchy type not found', 404)

    levels = ht.get_valid_child_levels(parent_level)
    return success([_serialize_level(l) for l in levels])


# GET /api/v1/hierarchy/level-schema
@bp.route('/hierarchy/level-schema', methods=['GET'])
@login_required
def get_level_schema():
    if not current_user.active_institution_id:
        return error('No active institution', 400)

    hierarchy_type_id = request.args.get('hierarchy_type_id', type=int)
    level_name = request.args.get('level_name', '').strip()

    if not hierarchy_type_id or not level_name:
        return error('hierarchy_type_id and level_name are required', 400)

    level = db.session.execute(
        sa.select(HierarchyLevel).where(
            HierarchyLevel.hierarchy_type_id == hierarchy_type_id,
            sa.func.lower(HierarchyLevel.name) == level_name.lower()
        )
    ).scalar_one_or_none()

    if not level:
        return error('Level not found', 404)

    return success(level.get_metadata_fields())