from app.models.classification import Classification, ClassificationChange


def serialize_classification_stub(c: Classification) -> dict:
    return {
        'id': c.id,
        'name': c.name,
        'code': c.code,
        'full_code': c.get_full_code(),
        'level_name': c.level_name,
        'is_active': c.is_active,
        'valid_from': c.valid_from.isoformat() if c.valid_from else None,
        'valid_to': c.valid_to.isoformat() if c.valid_to else None,
        'parent_id': c.parent_id,
        'has_children': c.children.count() > 0,
        'node_count': c.nodes.count(),
        'status': getattr(c, 'status', 'draft'),
        'version': getattr(c, 'version', 1),
        'version_label': getattr(c, 'version_label', None),
    }


def serialize_classification_detail(c: Classification) -> dict:
    return {
        'id': c.id,
        'institution_id': c.institution_id,
        'name': c.name,
        'code': c.code,
        'full_code': c.get_full_code(),
        'level_name': c.level_name,
        'description': c.description,
        'scope_note': c.scope_note,
        'is_active': c.is_active,
        'valid_from': c.valid_from.isoformat() if c.valid_from else None,
        'valid_to': c.valid_to.isoformat() if c.valid_to else None,
        'hierarchy_type_id': c.hierarchy_type_id,
        'parent_id': c.parent_id,
        'breadcrumb': c.get_breadcrumb(),
        'has_children': c.children.count() > 0,
        'node_count': c.nodes.count(),
        'status': getattr(c, 'status', 'draft'),
        'version': getattr(c, 'version', 1),
        'version_label': getattr(c, 'version_label', None),
        'created_at': c.created_at.isoformat(),
        'updated_at': c.updated_at.isoformat(),
        'created_by': c.created_by.username if c.created_by else None,
    }


def serialize_classification_change(ch: ClassificationChange) -> dict:
    return {
        'id': ch.id,
        'change_type': ch.change_type,
        'description': ch.description,
        'before_data': ch.before_data,
        'after_data': ch.after_data,
        'created_at': ch.created_at.isoformat(),
        'created_by': ch.created_by.username if ch.created_by else None,
    }