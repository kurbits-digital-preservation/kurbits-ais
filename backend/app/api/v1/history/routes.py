from datetime import datetime
from flask import request
from flask_login import login_required, current_user
import sqlalchemy as sa
from app.api.v1 import bp
from app.api.v1.helpers import success, error
from app.extensions import db
from app.models.history import RecentItem, Bookmark

RECENT_LIMIT = 20


def _serialize_recent(r: RecentItem) -> dict:
    return {
        'id': r.id,
        'entity_type': r.entity_type,
        'entity_id': r.entity_id,
        'title': r.title,
        'subtitle': r.subtitle,
        'viewed_at': r.viewed_at.isoformat(),
    }


def _serialize_bookmark(b: Bookmark) -> dict:
    return {
        'id': b.id,
        'entity_type': b.entity_type,
        'entity_id': b.entity_id,
        'title': b.title,
        'subtitle': b.subtitle,
        'created_at': b.created_at.isoformat(),
    }


@bp.route('/recent', methods=['GET'])
@login_required
def list_recent():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    items = db.session.execute(
        sa.select(RecentItem)
        .where(
            RecentItem.user_id == current_user.id,
            RecentItem.institution_id == institution_id,
        )
        .order_by(RecentItem.viewed_at.desc())
        .limit(RECENT_LIMIT)
    ).scalars().all()

    return success([_serialize_recent(r) for r in items])


@bp.route('/recent', methods=['POST'])
@login_required
def track_recent():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    data = request.get_json(silent=True) or {}
    entity_type = data.get('entity_type')
    entity_id = data.get('entity_id')
    title = (data.get('title') or '').strip()

    if entity_type not in ('node', 'agent'):
        return error('entity_type must be node or agent', 400)
    if not entity_id or not title:
        return error('entity_id and title are required', 400)

    existing = db.session.execute(
        sa.select(RecentItem).where(
            RecentItem.user_id == current_user.id,
            RecentItem.institution_id == institution_id,
            RecentItem.entity_type == entity_type,
            RecentItem.entity_id == entity_id,
        )
    ).scalar_one_or_none()

    if existing:
        existing.title = title
        existing.subtitle = data.get('subtitle')
        existing.viewed_at = datetime.utcnow()
    else:
        item = RecentItem(
            user_id=current_user.id,
            institution_id=institution_id,
            entity_type=entity_type,
            entity_id=entity_id,
            title=title,
            subtitle=data.get('subtitle'),
        )
        db.session.add(item)
        db.session.flush()

        oldest_ids = db.session.execute(
            sa.select(RecentItem.id)
            .where(
                RecentItem.user_id == current_user.id,
                RecentItem.institution_id == institution_id,
            )
            .order_by(RecentItem.viewed_at.desc())
            .offset(RECENT_LIMIT)
        ).scalars().all()

        if oldest_ids:
            db.session.execute(
                sa.delete(RecentItem).where(RecentItem.id.in_(oldest_ids))
            )

    db.session.commit()
    return success({'tracked': True})


@bp.route('/bookmarks', methods=['GET'])
@login_required
def list_bookmarks():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    items = db.session.execute(
        sa.select(Bookmark)
        .where(
            Bookmark.user_id == current_user.id,
            Bookmark.institution_id == institution_id,
        )
        .order_by(Bookmark.created_at.desc())
    ).scalars().all()

    return success([_serialize_bookmark(b) for b in items])


@bp.route('/bookmarks', methods=['POST'])
@login_required
def add_bookmark():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    data = request.get_json(silent=True) or {}
    entity_type = data.get('entity_type')
    entity_id = data.get('entity_id')
    title = (data.get('title') or '').strip()

    if entity_type not in ('node', 'agent'):
        return error('entity_type must be node or agent', 400)
    if not entity_id or not title:
        return error('entity_id and title are required', 400)

    existing = db.session.execute(
        sa.select(Bookmark).where(
            Bookmark.user_id == current_user.id,
            Bookmark.institution_id == institution_id,
            Bookmark.entity_type == entity_type,
            Bookmark.entity_id == entity_id,
        )
    ).scalar_one_or_none()

    if existing:
        return success(_serialize_bookmark(existing))

    b = Bookmark(
        user_id=current_user.id,
        institution_id=institution_id,
        entity_type=entity_type,
        entity_id=entity_id,
        title=title,
        subtitle=data.get('subtitle'),
    )
    db.session.add(b)
    db.session.commit()
    return success(_serialize_bookmark(b), 201)


@bp.route('/bookmarks', methods=['DELETE'])
@login_required
def remove_bookmark():
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}
    entity_type = data.get('entity_type')
    entity_id = data.get('entity_id')

    db.session.execute(
        sa.delete(Bookmark).where(
            Bookmark.user_id == current_user.id,
            Bookmark.institution_id == institution_id,
            Bookmark.entity_type == entity_type,
            Bookmark.entity_id == entity_id,
        )
    )
    db.session.commit()
    return success({'removed': True})


@bp.route('/bookmarks/check', methods=['GET'])
@login_required
def check_bookmark():
    institution_id = current_user.active_institution_id
    entity_type = request.args.get('entity_type')
    entity_id = request.args.get('entity_id', type=int)

    exists = db.session.execute(
        sa.select(Bookmark.id).where(
            Bookmark.user_id == current_user.id,
            Bookmark.institution_id == institution_id,
            Bookmark.entity_type == entity_type,
            Bookmark.entity_id == entity_id,
        )
    ).scalar_one_or_none()

    return success({'bookmarked': exists is not None})