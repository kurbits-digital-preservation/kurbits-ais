from flask import request
from flask_login import login_required, current_user
import sqlalchemy as sa
from app.api.v1 import bp
from app.api.v1.helpers import success, error
from app.extensions import db
from app.models.saved_search import SavedSearch


def _serialize(s: SavedSearch) -> dict:
    return {
        'id': s.id,
        'name': s.name,
        'params': s.params,
        'created_at': s.created_at.isoformat(),
    }


# GET /api/v1/saved-searches
@bp.route('/saved-searches', methods=['GET'])
@login_required
def list_saved_searches():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    searches = db.session.execute(
        sa.select(SavedSearch)
        .where(
            SavedSearch.user_id == current_user.id,
            SavedSearch.institution_id == institution_id,
        )
        .order_by(SavedSearch.name)
    ).scalars().all()

    return success([_serialize(s) for s in searches])


# POST /api/v1/saved-searches
@bp.route('/saved-searches', methods=['POST'])
@login_required
def create_saved_search():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    params = data.get('params')

    if not name:
        return error('name is required', 400)
    if not params or not isinstance(params, dict):
        return error('params is required', 400)

    existing = db.session.execute(
        sa.select(SavedSearch).where(
            SavedSearch.user_id == current_user.id,
            SavedSearch.institution_id == institution_id,
            SavedSearch.name == name,
        )
    ).scalar_one_or_none()

    if existing:
        return error(f'A saved search named "{name}" already exists', 409)

    s = SavedSearch(
        user_id=current_user.id,
        institution_id=institution_id,
        name=name,
        params=params,
    )
    db.session.add(s)
    db.session.commit()
    return success(_serialize(s), 201)


# DELETE /api/v1/saved-searches/<id>
@bp.route('/saved-searches/<int:search_id>', methods=['DELETE'])
@login_required
def delete_saved_search(search_id):
    institution_id = current_user.active_institution_id
    s = db.session.execute(
        sa.select(SavedSearch).where(
            SavedSearch.id == search_id,
            SavedSearch.user_id == current_user.id,
            SavedSearch.institution_id == institution_id,
        )
    ).scalar_one_or_none()

    if not s:
        return error('Not found', 404)

    db.session.delete(s)
    db.session.commit()
    return success({'deleted': search_id})