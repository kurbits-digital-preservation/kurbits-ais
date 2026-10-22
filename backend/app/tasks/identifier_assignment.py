"""
Background assignment of auto-generated identifiers to new records.
"""

from __future__ import annotations
import logging

log = logging.getLogger(__name__)

TASK_TYPE = 'identifier_assignment'
_MAX_STORED_WARNINGS = 200


def run_identifier_assignment(task_id: str) -> None:
    """Entry point called by the background runner."""
    from app.extensions import db
    from app.models.background_task import BackgroundTask
    from app.services.identifier_minting import assign_batch

    task = db.session.get(BackgroundTask, task_id)
    if not task:
        return

    task.set_running()
    db.session.commit()

    payload = dict(task.result or {})
    node_ids = payload.get('node_ids') or []
    agent_ids = payload.get('agent_ids') or []

    def on_progress(done: int, total: int) -> None:
        task.set_progress(int(done * 100 / total) if total else 100)

    try:
        assigned, warnings = assign_batch(db.session, node_ids, agent_ids, on_progress=on_progress)
    except Exception as e:
        log.exception(f'Identifier assignment task {task_id} failed')
        db.session.rollback()
        task.set_error(str(e))
        db.session.commit()
        return

    for message in warnings:
        log.warning(message)

    task.set_done({
        'node_ids': node_ids,
        'agent_ids': agent_ids,
        'assigned': assigned,
        'warning_count': len(warnings),
        'warnings': warnings[:_MAX_STORED_WARNINGS],
    })
    db.session.commit()