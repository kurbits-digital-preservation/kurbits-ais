from flask import request
from flask_login import login_required, current_user
from app.api.v1 import bp
from app.api.v1.helpers import success, error
from app.models.background_task import BackgroundTask
import sqlalchemy as sa
from app.extensions import db


def _serialize(t: BackgroundTask) -> dict:
    return {
        'id':            t.id,
        'task_type':     t.task_type,
        'entity_type':   t.entity_type,
        'entity_id':     t.entity_id,
        'status':        t.status,
        'progress':      t.progress,
        'result':        t.result,
        'error_message': t.error_message,
        'created_at':    t.created_at.isoformat(),
        'updated_at':    t.updated_at.isoformat(),
    }


# GET /api/v1/tasks/<id>
@bp.route('/tasks/<string:task_id>', methods=['GET'])
@login_required
def get_task(task_id):
    task = BackgroundTask.query.filter_by(
        id=task_id,
        institution_id=current_user.active_institution_id,
    ).first()
    if not task:
        return error('Task not found', 404)
    return success(_serialize(task))


# GET /api/v1/tasks?entity_type=node_attachment&entity_id=42
@bp.route('/tasks', methods=['GET'])
@login_required
def list_tasks():
    entity_type = request.args.get('entity_type')
    entity_id   = request.args.get('entity_id', type=int)

    q = sa.select(BackgroundTask).where(
        BackgroundTask.institution_id == current_user.active_institution_id
    )
    if entity_type:
        q = q.where(BackgroundTask.entity_type == entity_type)
    if entity_id:
        q = q.where(BackgroundTask.entity_id == entity_id)

    tasks = db.session.execute(
        q.order_by(BackgroundTask.created_at.desc()).limit(20)
    ).scalars().all()

    return success([_serialize(t) for t in tasks])