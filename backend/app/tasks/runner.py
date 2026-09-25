"""
Simple threaded task runner. No external dependencies.
Tasks run in daemon threads and update BackgroundTask rows for polling.

Concurrency is capped: a bulk import can enqueue hundreds of extraction jobs,
and one unbounded thread per job would thrash the server (image decoding and
checksumming are CPU- and IO-heavy). Work above the cap waits its turn rather
than running immediately.
"""
from __future__ import annotations
import os
import threading
import logging
from typing import Callable

log = logging.getLogger(__name__)

# Cap concurrent background tasks. Override with KURBITS_TASK_WORKERS.
# Default is deliberately small — these jobs are CPU-bound, so more threads
# past a few cores makes everything slower, not faster.
_MAX_CONCURRENT = int(os.environ.get('KURBITS_TASK_WORKERS', '3'))
_semaphore = threading.BoundedSemaphore(_MAX_CONCURRENT)


def run_in_background(
    app,
    task_id: str,
    fn: Callable[[str], None],
) -> None:
    """
    Spawn a daemon thread that runs fn(task_id) inside an app context.
    fn is responsible for updating the BackgroundTask row.

    The thread starts immediately but blocks on a semaphore until a slot is
    free, so the task row stays 'pending' (visible to the poller) while queued.
    """
    def _run():
        with _semaphore:
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