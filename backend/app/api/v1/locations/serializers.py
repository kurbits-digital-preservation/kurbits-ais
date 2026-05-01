from app.models.location import Location, LocationMovement


def serialize_location_stub(loc: Location) -> dict:
    return {
        'id': loc.id,
        'name': loc.name,
        'code': loc.code,
        'level_name': loc.level_name,
        'can_store_nodes': loc.can_store_nodes,
        'capacity': loc.capacity,
        'available_capacity': loc.get_available_capacity(),
        'stored_count': loc.stored_nodes.count() if loc.can_store_nodes else 0,
        'parent_id': loc.parent_id,
        'has_children': loc.children.count() > 0,
    }


def serialize_location_detail(loc: Location) -> dict:
    return {
        'id': loc.id,
        'institution_id': loc.institution_id,
        'name': loc.name,
        'code': loc.code,
        'level_name': loc.level_name,
        'description': loc.description,
        'can_store_nodes': loc.can_store_nodes,
        'capacity': loc.capacity,
        'available_capacity': loc.get_available_capacity(),
        'stored_count': loc.stored_nodes.count() if loc.can_store_nodes else 0,
        'full_path': loc.get_full_path(),
        'hierarchy_type_id': loc.hierarchy_type_id,
        'parent_id': loc.parent_id,
        'has_children': loc.children.count() > 0,
        'created_at': loc.created_at.isoformat(),
    }


def serialize_movement(m: LocationMovement) -> dict:
    return {
        'id': m.id,
        'node_id': m.node_id,
        'node_title': m.node.title if m.node else None,
        'node_ref_code': m.node.ref_code if m.node else None,
        'location_id': m.location_id,
        'location_name': m.location.get_full_path() if m.location else None,
        'movement_type': m.movement_type,
        'notes': m.notes,
        'moved_at': m.moved_at.isoformat(),
        'moved_by': m.moved_by.username if m.moved_by else None,
    }
