from flask import request
from flask_login import login_required, current_user
from app.api.v1 import bp
from app.api.v1.helpers import success, error, require_write
from app.api.v1.locations.serializers import (
    serialize_location_stub, serialize_location_detail, serialize_movement
)
from app.api.v1.nodes.serializers import serialize_node_stub
from app.extensions import db
from app.models import Location, LocationMovement
from app.models.location import location_node_association
import sqlalchemy as sa


def _get_location_or_404(location_id: int, institution_id: int):
    return Location.query.filter_by(id=location_id, institution_id=institution_id).first()


# ---------------------------------------------------------------------------
# Tree
# ---------------------------------------------------------------------------

# GET /api/v1/locations/tree
@bp.route('/locations/tree', methods=['GET'])
@login_required
def get_location_tree():
    if not current_user.active_institution_id:
        return error('No active institution', 400)

    roots = Location.query.filter_by(
        institution_id=current_user.active_institution_id,
        parent_id=None
    ).order_by(Location.code).all()

    return success([serialize_location_stub(loc) for loc in roots])


# GET /api/v1/locations/<id>/children
@bp.route('/locations/<int:location_id>/children', methods=['GET'])
@login_required
def get_location_children(location_id):
    if not current_user.active_institution_id:
        return error('No active institution', 400)

    loc = _get_location_or_404(location_id, current_user.active_institution_id)
    if not loc:
        return error('Location not found', 404)

    children = loc.children.order_by(Location.code).all()
    return success([serialize_location_stub(c) for c in children])


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

# GET /api/v1/locations/<id>
@bp.route('/locations/<int:location_id>', methods=['GET'])
@login_required
def get_location(location_id):
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    loc = _get_location_or_404(location_id, current_user.active_institution_id)
    if not loc:
        return error('Location not found', 404)
    return success(serialize_location_detail(loc))


# POST /api/v1/locations
@bp.route('/locations', methods=['POST'])
@login_required
@require_write
def create_location():
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}

    required = ['name', 'code', 'level_name', 'hierarchy_type_id']
    missing = [f for f in required if not data.get(f)]
    if missing:
        return error(f'Missing required fields: {", ".join(missing)}', 400)

    parent = None
    if data.get('parent_id'):
        parent = _get_location_or_404(data['parent_id'], institution_id)
        if not parent:
            return error('Parent location not found', 404)

    loc = Location(
        institution_id=institution_id,
        name=data['name'],
        code=data['code'],
        level_name=data['level_name'],
        hierarchy_type_id=data['hierarchy_type_id'],
        description=data.get('description'),
        can_store_nodes=data.get('can_store_nodes', False),
        capacity=data.get('capacity'),
        parent=parent,
    )
    db.session.add(loc)
    db.session.flush()

    if not loc.validate_hierarchy():
        db.session.rollback()
        return error(f'Invalid hierarchy: "{loc.level_name}" is not allowed at this position', 422)

    db.session.commit()
    return success(serialize_location_detail(loc), 201)


# PATCH /api/v1/locations/<id>
@bp.route('/locations/<int:location_id>', methods=['PATCH'])
@login_required
@require_write
def update_location(location_id):
    institution_id = current_user.active_institution_id
    loc = _get_location_or_404(location_id, institution_id)
    if not loc:
        return error('Location not found', 404)

    data = request.get_json(silent=True) or {}
    updatable = ['name', 'code', 'description', 'can_store_nodes', 'capacity']
    for field in updatable:
        if field in data:
            setattr(loc, field, data[field])

    db.session.commit()
    return success(serialize_location_detail(loc))


# DELETE /api/v1/locations/<id>
@bp.route('/locations/<int:location_id>', methods=['DELETE'])
@login_required
@require_write
def delete_location(location_id):
    institution_id = current_user.active_institution_id
    loc = _get_location_or_404(location_id, institution_id)
    if not loc:
        return error('Location not found', 404)

    if loc.children.count() > 0:
        return error('Cannot delete a location that has children', 409)

    if loc.stored_nodes.count() > 0:
        return error('Cannot delete a location that has stored items. Remove items first.', 409)

    db.session.delete(loc)
    db.session.commit()
    return success({'message': 'Location deleted'})


# ---------------------------------------------------------------------------
# Stored nodes (check in / check out / transfer)
# ---------------------------------------------------------------------------

# GET /api/v1/locations/<id>/nodes
@bp.route('/locations/<int:location_id>/nodes', methods=['GET'])
@login_required
def get_stored_nodes(location_id):
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    loc = _get_location_or_404(location_id, current_user.active_institution_id)
    if not loc:
        return error('Location not found', 404)
    if not loc.can_store_nodes:
        return error('This location cannot store nodes', 422)

    return success([serialize_node_stub(n) for n in loc.stored_nodes])





def _get_or_create_checked_out_location(institution_id: int, db):
    """Get or create the virtual 'Checked out' root for an institution.

    On first creation, the default checkout categories are seeded as child
    locations. Admins manage them afterwards like any other location.
    """
    from app.models.location import CHECKOUT_ROOT_CODE, DEFAULT_CHECKOUT_CATEGORIES
    loc = Location.query.filter_by(
        institution_id=institution_id,
        code=CHECKOUT_ROOT_CODE,
        parent_id=None,
    ).first()
    if not loc:
        ht = db.session.execute(
            sa.select(sa.text('id')).select_from(sa.text('hierarchy_types'))
            .where(sa.text("entity_type = 'location' AND institution_id = :iid"))
            .params(iid=institution_id).limit(1)
        ).scalar()
        loc = Location(
            institution_id=institution_id,
            name='Checked out',
            code=CHECKOUT_ROOT_CODE,
            level_name='Virtual',
            location_type='virtual',
            can_store_nodes=True,
            is_public=False,
            hierarchy_type_id=ht or 1,
        )
        db.session.add(loc)
        db.session.flush()

    # Backfill default categories for any missing codes. Runs whether the root
    # was just created or already existed from the old flat checkout system,
    # so upgrading databases get categories without a migration. Categories the
    # admin later deletes are not resurrected, because we only add codes that
    # have never existed — see the guard below.
    _seed_checkout_categories(loc, db)
    return loc


def _seed_checkout_categories(root, db):
    """Add any default checkout categories that don't yet exist under `root`.

    Only seeds when the root currently has NO children at all, so an admin who
    has deliberately curated the category list (renaming or removing some) is
    never overridden on subsequent calls.
    """
    from app.models.location import DEFAULT_CHECKOUT_CATEGORIES
    existing = root.children.count()
    if existing > 0:
        return
    for cat_name, cat_code in DEFAULT_CHECKOUT_CATEGORIES:
        db.session.add(Location(
            institution_id=root.institution_id,
            name=cat_name,
            code=cat_code,
            level_name='Virtual',
            location_type='virtual',
            can_store_nodes=True,
            is_public=False,
            hierarchy_type_id=root.hierarchy_type_id,
            parent_id=root.id,
        ))
    db.session.flush()

def _update_node_current_location(node, location_id, db):
    """Denormalise current location onto node for fast lookup."""
    node.current_location_id = location_id


def _date_or_none(val):
    if not val:
        return None
    from datetime import date as date_cls
    if isinstance(val, date_cls):
        return val
    try:
        return date_cls.fromisoformat(str(val))
    except (ValueError, TypeError):
        return None

# POST /api/v1/locations/<id>/check-in
@bp.route('/locations/<int:location_id>/check-in', methods=['POST'])
@login_required
@require_write
def check_in(location_id):
    institution_id = current_user.active_institution_id
    loc = _get_location_or_404(location_id, institution_id)
    if not loc:
        return error('Location not found', 404)
    if not loc.can_store_nodes:
        return error('This location cannot store nodes', 422)

    if loc.capacity is not None and loc.stored_nodes.count() >= loc.capacity:
        return error('Location is at full capacity', 409)

    data = request.get_json(silent=True) or {}
    node_id = data.get('node_id')
    if not node_id:
        return error('node_id is required', 400)

    from app.models import Node
    node = Node.query.filter_by(id=node_id, institution_id=institution_id).first()
    if not node:
        return error('Node not found', 404)

    existing = db.session.execute(
        sa.select(location_node_association).where(
            location_node_association.c.location_id == location_id,
            location_node_association.c.node_id == node_id,
        )
    ).first()
    if existing:
        return error('Node is already at this location', 409)

    # Remove from ALL previous locations — a node can only be in one place
    db.session.execute(
        location_node_association.delete().where(
            location_node_association.c.node_id == node_id
        )
    )

    db.session.execute(
        location_node_association.insert().values(
            location_id=location_id, node_id=node_id
        )
    )

    movement = LocationMovement(
        node_id=node_id,
        location_id=location_id,
        from_location_id=node.current_location_id,
        movement_type='checked_in',
        notes=data.get('notes'),
        condition_note=data.get('condition_note'),
        moved_by_id=current_user.id,
    )
    db.session.add(movement)
    _update_node_current_location(node, location_id, db)
    db.session.commit()
    return success({'message': 'Node checked in', 'movement': movement.to_dict()}, 201)


# POST /api/v1/locations/<id>/check-out
@bp.route('/locations/<int:location_id>/check-out', methods=['POST'])
@login_required
@require_write
def check_out(location_id):
    institution_id = current_user.active_institution_id
    loc = _get_location_or_404(location_id, institution_id)
    if not loc:
        return error('Location not found', 404)

    data = request.get_json(silent=True) or {}
    node_id = data.get('node_id')
    if not node_id:
        return error('node_id is required', 400)

    db.session.execute(
        location_node_association.delete().where(
            location_node_association.c.location_id == location_id,
            location_node_association.c.node_id == node_id,
        )
    )

    from app.models import Node
    node = Node.query.filter_by(id=node_id, institution_id=institution_id).first()

    # Auto-assign to virtual "Checked out" location for this institution
    checked_out_root = _get_or_create_checked_out_location(institution_id, db)

    # Optional category (a child of the virtual root, admin-managed)
    checked_out_loc = checked_out_root
    category_id = data.get('category_location_id')
    if category_id:
        category = _get_location_or_404(category_id, institution_id)
        if not category or not category.is_checkout_location():
            return error('Invalid checkout category', 422)
        checked_out_loc = category

    # Move to checked-out virtual location
    db.session.execute(
        location_node_association.insert().values(
            location_id=checked_out_loc.id, node_id=node_id
        )
    )

    movement = LocationMovement(
        node_id=node_id,
        location_id=checked_out_loc.id,
        from_location_id=location_id,
        movement_type='checked_out',
        notes=data.get('notes'),
        condition_note=data.get('condition_note'),
        moved_by_id=current_user.id,
    )
    db.session.add(movement)
    if node:
        _update_node_current_location(node, checked_out_loc.id, db)
    db.session.commit()
    return success({'message': 'Node checked out', 'movement': movement.to_dict()})




# POST /api/v1/locations/<id>/move
# Move a node from this location directly to another location
@bp.route('/locations/<int:location_id>/move', methods=['POST'])
@login_required
@require_write
def move_node_between_locations(location_id):
    institution_id = current_user.active_institution_id
    loc = _get_location_or_404(location_id, institution_id)
    if not loc:
        return error('Location not found', 404)

    data = request.get_json(silent=True) or {}
    node_id = data.get('node_id')
    target_id = data.get('target_location_id')
    if not node_id or not target_id:
        return error('node_id and target_location_id are required', 400)

    target_loc = _get_location_or_404(target_id, institution_id)
    if not target_loc:
        return error('Target location not found', 404)
    if not target_loc.can_store_nodes:
        return error('Target location cannot store nodes', 422)
    if target_loc.capacity is not None and target_loc.stored_nodes.count() >= target_loc.capacity:
        return error('Target location is at full capacity', 409)

    from app.models import Node
    node = Node.query.filter_by(id=node_id, institution_id=institution_id).first()
    if not node:
        return error('Node not found', 404)

    # Remove from all current locations, add to target
    db.session.execute(
        location_node_association.delete().where(
            location_node_association.c.node_id == node_id
        )
    )
    db.session.execute(
        location_node_association.insert().values(
            location_id=target_id, node_id=node_id
        )
    )

    movement = LocationMovement(
        node_id=node_id,
        location_id=target_id,
        from_location_id=location_id,
        movement_type='moved',
        notes=data.get('notes'),
        condition_note=data.get('condition_note'),
        moved_by_id=current_user.id,
    )
    db.session.add(movement)
    _update_node_current_location(node, target_id, db)
    db.session.commit()
    return success({'message': 'Node moved', 'movement': movement.to_dict()})

# POST /api/v1/locations/<id>/transfer
@bp.route('/locations/<int:location_id>/transfer', methods=['POST'])
@login_required
@require_write
def transfer_node(location_id):
    """Move a node from one location to another in a single operation."""
    institution_id = current_user.active_institution_id
    source_loc = _get_location_or_404(location_id, institution_id)
    if not source_loc:
        return error('Source location not found', 404)

    data = request.get_json(silent=True) or {}
    node_id = data.get('node_id')
    target_location_id = data.get('target_location_id')

    if not node_id or not target_location_id:
        return error('node_id and target_location_id are required', 400)

    target_loc = _get_location_or_404(target_location_id, institution_id)
    if not target_loc:
        return error('Target location not found', 404)
    if not target_loc.can_store_nodes:
        return error('Target location cannot store nodes', 422)
    if target_loc.capacity is not None and target_loc.stored_nodes.count() >= target_loc.capacity:
        return error('Target location is at full capacity', 409)

    db.session.execute(
        location_node_association.delete().where(
            location_node_association.c.location_id == location_id,
            location_node_association.c.node_id == node_id,
        )
    )
    db.session.execute(
        location_node_association.insert().values(
            location_id=target_location_id, node_id=node_id
        )
    )

    from app.models import Node
    node = Node.query.filter_by(id=node_id, institution_id=institution_id).first()
    movement = LocationMovement(
        node_id=node_id,
        location_id=target_location_id,
        from_location_id=location_id,
        movement_type='transferred',
        notes=data.get('notes'),
        condition_note=data.get('condition_note'),
        moved_by_id=current_user.id,
    )
    db.session.add(movement)
    if node:
        _update_node_current_location(node, target_location_id, db)
    db.session.commit()
    return success({'message': 'Node transferred', 'movement': movement.to_dict()})


# GET /api/v1/locations/<id>/movements
@bp.route('/locations/<int:location_id>/movements', methods=['GET'])
@login_required
def get_movements(location_id):
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    loc = _get_location_or_404(location_id, current_user.active_institution_id)
    if not loc:
        return error('Location not found', 404)

    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 25, type=int), 100)

    paginated = db.paginate(
        sa.select(LocationMovement)
        .where(LocationMovement.location_id == location_id)
        .order_by(LocationMovement.moved_at.desc()),
        page=page, per_page=per_page, error_out=False
    )
    return success(
        [serialize_movement(m) for m in paginated.items],
        meta={'page': paginated.page, 'total': paginated.total, 'pages': paginated.pages}
    )


# GET /api/v1/locations/search?q=shelf&storable=true
@bp.route('/locations/search', methods=['GET'])
@login_required
def search_locations():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    q = request.args.get('q', '').strip()
    storable_only = request.args.get('storable', 'false').lower() == 'true'

    query = sa.select(Location).where(Location.institution_id == institution_id)
    if storable_only:
        query = query.where(Location.can_store_nodes == True)  # noqa: E712
    if q:
        query = query.where(
            sa.or_(
                Location.name.ilike(f'%{q}%'),
                Location.code.ilike(f'%{q}%'),
            )
        )

    locations = db.session.execute(
        query.order_by(Location.name).limit(20)
    ).scalars().all()

    return success([{
        'id': loc.id,
        'name': loc.name,
        'code': loc.code,
        'level_name': loc.level_name,
        'full_path': loc.get_full_path(),
        'can_store_nodes': loc.can_store_nodes,
        'stored_count': loc.stored_nodes.count(),
        'capacity': loc.capacity,
    } for loc in locations])


# ── Institution-wide location overview ────────────────────────────────



# POST /api/v1/nodes/<id>/move
# Convenience endpoint — move a node to a new location with full status
@bp.route('/nodes/<int:node_id>/move', methods=['POST'])
@login_required
@require_write
def move_node_to_location(node_id):
    institution_id = current_user.active_institution_id
    from app.models.node import Node

    node = Node.query.filter_by(id=node_id, institution_id=institution_id).first()
    if not node:
        return error('Node not found', 404)

    data = request.get_json(silent=True) or {}
    target_location_id = data.get('location_id')
    movement_type = data.get('movement_type', 'moved')

    # Validate target location exists (optional — missing = on_loan_out with no internal loc)
    target_loc = None
    if target_location_id:
        target_loc = _get_location_or_404(target_location_id, institution_id)
        if not target_loc:
            return error('Target location not found', 404)

        # Update node-location association
        # Remove from any existing location
        db.session.execute(
            sa.text('DELETE FROM location_node_association WHERE node_id = :nid'),
            {'nid': node_id}
        )
        if target_loc.can_store_nodes:
            db.session.execute(
                location_node_association.insert().values(
                    location_id=target_location_id, node_id=node_id
                )
            )

    movement = LocationMovement(
        node_id=node_id,
        location_id=target_location_id,
        from_location_id=node.current_location_id,
        movement_type=movement_type,
        notes=data.get('notes'),
        condition_note=data.get('condition_note'),
        moved_by_id=current_user.id,
    )
    db.session.add(movement)
    _update_node_current_location(node, target_location_id, db)
    db.session.commit()
    return success(movement.to_dict(), 201)


# GET /api/v1/nodes/<id>/movements
@bp.route('/nodes/<int:node_id>/movements', methods=['GET'])
@login_required
def get_node_movements(node_id):
    institution_id = current_user.active_institution_id
    from app.models.node import Node
    node = Node.query.filter_by(id=node_id, institution_id=institution_id).first()
    if not node:
        return error('Node not found', 404)

    movements = db.session.execute(
        sa.select(LocationMovement)
        .where(LocationMovement.node_id == node_id)
        .order_by(LocationMovement.moved_at.desc())
    ).scalars().all()
    return success([m.to_dict() for m in movements])

# GET /api/v1/locations/<id>/inventory
@bp.route('/locations/<int:location_id>/inventory', methods=['GET'])
@login_required
def print_location_inventory(location_id):
    """Generate an inventory PDF for a location and all its sub-locations."""
    from flask import make_response
    from app.reports import generate_location_inventory

    institution_id = current_user.active_institution_id
    loc = _get_location_or_404(location_id, institution_id)
    if not loc:
        return error('Location not found', 404)

    try:
        pdf_bytes = generate_location_inventory(location_id, institution_id, db)
    except Exception as e:
        current_app.logger.error(f'Inventory generation failed: {e}')
        return error(f'Failed to generate inventory: {e}', 500)

    safe_name = (loc.name or 'inventory').replace(' ', '_')[:40]
    response = make_response(pdf_bytes)
    response.headers['Content-Type'] = 'application/pdf'
    response.headers['Content-Disposition'] = f'inline; filename="{safe_name}_inventory.pdf"'
    return response

# ---------------------------------------------------------------------------
# Bulk movement
# ---------------------------------------------------------------------------

# POST /api/v1/locations/<id>/move-contents
# Relocate every stored item from this location to another, in one transaction.
@bp.route('/locations/<int:location_id>/move-contents', methods=['POST'])
@login_required
@require_write
def move_location_contents(location_id):
    institution_id = current_user.active_institution_id
    source = _get_location_or_404(location_id, institution_id)
    if not source:
        return error('Location not found', 404)

    data = request.get_json(silent=True) or {}
    target_id = data.get('target_location_id')
    if not target_id:
        return error('target_location_id is required', 400)
    if target_id == location_id:
        return error('Target must be a different location', 400)

    target = _get_location_or_404(target_id, institution_id)
    if not target:
        return error('Target location not found', 404)
    if not target.can_store_nodes:
        return error('Target location cannot store archival materials', 422)

    node_ids = db.session.execute(
        sa.select(location_node_association.c.node_id).where(
            location_node_association.c.location_id == source.id
        )
    ).scalars().all()

    if not node_ids:
        return success({'moved': 0, 'message': 'Location has no stored items'})

    if target.capacity is not None:
        current_count = target.stored_nodes.count()
        if current_count + len(node_ids) > target.capacity:
            return error(
                f'Target capacity exceeded: {len(node_ids)} incoming, '
                f'{target.capacity - current_count} free of {target.capacity}',
                409,
            )

    # Re-point associations
    db.session.execute(
        location_node_association.delete().where(
            location_node_association.c.location_id == source.id,
            location_node_association.c.node_id.in_(node_ids),
        )
    )
    # Guard against duplicates if some item already sits at the target
    db.session.execute(
        location_node_association.delete().where(
            location_node_association.c.location_id == target.id,
            location_node_association.c.node_id.in_(node_ids),
        )
    )
    db.session.execute(
        location_node_association.insert(),
        [{'location_id': target.id, 'node_id': nid} for nid in node_ids],
    )

    # One movement record per item
    for nid in node_ids:
        db.session.add(LocationMovement(
            node_id=nid,
            location_id=target.id,
            from_location_id=source.id,
            movement_type='transfer',
            notes=data.get('notes'),
            moved_by_id=current_user.id,
        ))

    # Keep the denormalised pointer in sync
    from app.models import Node
    db.session.execute(
        sa.update(Node)
        .where(Node.id.in_(node_ids))
        .values(current_location_id=target.id)
    )

    db.session.commit()
    return success({
        'moved': len(node_ids),
        'target': serialize_location_stub(target),
    })


# POST /api/v1/locations/quick-move
# Barcode workflow: resolve target by location code, items by ref_code.
# Items currently in the virtual checked-out location are checked back in;
# everything else is a transfer.
@bp.route('/locations/quick-move', methods=['POST'])
@login_required
@require_write
def quick_move():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    data = request.get_json(silent=True) or {}
    location_code = (data.get('location_code') or '').strip()
    ref_codes = data.get('ref_codes') or []
    if not location_code:
        return error('location_code is required', 400)
    if not isinstance(ref_codes, list) or not ref_codes:
        return error('ref_codes must be a non-empty list', 400)
    if len(ref_codes) > 200:
        return error('Too many items in one request (max 200)', 400)

    # Location codes are only unique per parent — resolve and detect ambiguity
    matches = Location.query.filter_by(
        code=location_code, institution_id=institution_id
    ).all()
    if not matches:
        return error(f'No location with code "{location_code}"', 404)
    if len(matches) > 1:
        paths = '; '.join(m.get_full_path() for m in matches)
        return error(f'Ambiguous location code "{location_code}": {paths}', 409)
    target = matches[0]
    if not target.can_store_nodes:
        return error('This location cannot store archival materials', 422)

    remaining = None
    if target.capacity is not None:
        remaining = target.capacity - target.stored_nodes.count()

    from app.models import Node
    results = []
    seen = set()
    for raw in ref_codes:
        ref = str(raw).strip()
        if not ref or ref in seen:
            continue
        seen.add(ref)

        node = Node.query.filter_by(
            ref_code=ref, institution_id=institution_id
        ).first()
        if not node:
            results.append({'ref_code': ref, 'status': 'not_found'})
            continue

        if node.current_location_id == target.id:
            results.append({'ref_code': ref, 'status': 'already_here',
                            'title': node.title})
            continue

        if remaining is not None and remaining <= 0:
            results.append({'ref_code': ref, 'status': 'at_capacity',
                            'title': node.title})
            continue

        prev_id = node.current_location_id
        prev = Location.query.get(prev_id) if prev_id else None
        was_checked_out = prev is not None and prev.is_checkout_location()

        db.session.execute(
            location_node_association.delete().where(
                location_node_association.c.node_id == node.id
            )
        )
        db.session.execute(
            location_node_association.insert().values(
                location_id=target.id, node_id=node.id
            )
        )
        movement_type = 'checked_in' if (was_checked_out or prev is None) else 'transfer'
        db.session.add(LocationMovement(
            node_id=node.id,
            location_id=target.id,
            from_location_id=prev_id,
            movement_type=movement_type,
            moved_by_id=current_user.id,
        ))
        _update_node_current_location(node, target.id, db)
        if remaining is not None:
            remaining -= 1

        results.append({'ref_code': ref, 'status': 'moved',
                        'title': node.title,
                        'movement_type': movement_type})

    db.session.commit()
    moved = sum(1 for r in results if r['status'] == 'moved')
    return success({
        'target': {'id': target.id, 'name': target.name,
                   'full_path': target.get_full_path()},
        'moved': moved,
        'results': results,
    })


# ---------------------------------------------------------------------------
# Checkout categories & returns
# ---------------------------------------------------------------------------

# GET /api/v1/locations/checkout-categories
# The virtual root plus its admin-managed category children.
@bp.route('/locations/checkout-categories', methods=['GET'])
@login_required
def get_checkout_categories():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    root = _get_or_create_checked_out_location(institution_id, db)
    db.session.commit()

    categories = sorted(root.children.all(), key=lambda c: c.name.lower())
    return success({
        'root': serialize_location_stub(root),
        'categories': [serialize_location_stub(c) for c in categories],
    })


# POST /api/v1/nodes/<id>/return-to-previous
# Check a checked-out item back in to wherever it was checked out from.
@bp.route('/nodes/<int:node_id>/return-to-previous', methods=['POST'])
@login_required
@require_write
def return_to_previous(node_id):
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    from app.models import Node
    node = Node.query.filter_by(id=node_id, institution_id=institution_id).first()
    if not node:
        return error('Node not found', 404)

    current_loc = (Location.query.get(node.current_location_id)
                   if node.current_location_id else None)
    if not current_loc or not current_loc.is_checkout_location():
        return error('Item is not checked out', 422)

    last_out = LocationMovement.query.filter_by(
        node_id=node_id, movement_type='checked_out'
    ).order_by(LocationMovement.moved_at.desc()).first()
    if not last_out or not last_out.from_location_id:
        return error('No previous location recorded for this item', 404)

    dest = Location.query.filter_by(
        id=last_out.from_location_id, institution_id=institution_id
    ).first()
    if not dest:
        return error('The previous location no longer exists', 410)
    if not dest.can_store_nodes:
        return error('The previous location can no longer store items', 422)
    if dest.capacity is not None and dest.stored_nodes.count() >= dest.capacity:
        return error('The previous location is at full capacity', 409)

    data = request.get_json(silent=True) or {}

    db.session.execute(
        location_node_association.delete().where(
            location_node_association.c.node_id == node_id
        )
    )
    db.session.execute(
        location_node_association.insert().values(
            location_id=dest.id, node_id=node_id
        )
    )
    movement = LocationMovement(
        node_id=node_id,
        location_id=dest.id,
        from_location_id=current_loc.id,
        movement_type='checked_in',
        notes=data.get('notes') or 'Returned to previous location',
        moved_by_id=current_user.id,
    )
    db.session.add(movement)
    _update_node_current_location(node, dest.id, db)
    db.session.commit()
    return success({
        'message': 'Returned',
        'location': serialize_location_stub(dest),
        'movement': movement.to_dict(),
    })
