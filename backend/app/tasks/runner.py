"""
Simple threaded task runner. No external dependencies.
Tasks run in daemon threads and update BackgroundTask rows for polling.
"""
from __future__ import annotations
import threading
import logging
from typing import Callable

log = logging.getLogger(__name__)


def run_in_background(
    app,
    task_id: str,
    fn: Callable[[str], None],
) -> None:
    """
    Spawn a daemon thread that runs fn(task_id) inside an app context.
    fn is responsible for updating the BackgroundTask row.
    """
    def _run():
        with app.app_context():
            try:
                fn(task_id)
            except Exception as e:
                log.exception(f'Background task {task_id} crashed: {e}')
                # Last-resort: mark task as error if fn didn't handle it
                try:
                    from app.extensions import db
                    from app.models.background_task import BackgroundTask
                    task = BackgroundTask.query.get(task_id)
                    if task and task.status not in ('done', 'error'):
                        task.set_error(str(e))
                        db.session.commit()
                except Exception:
                    pass

    t = threading.Thread(target=_run, daemon=True)
    t.start()