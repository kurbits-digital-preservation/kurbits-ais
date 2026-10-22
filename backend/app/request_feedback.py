from flask import g, has_app_context

_WARNINGS_KEY = '_request_warnings'
_TASKS_KEY = '_request_tasks'


def _append(key: str, item) -> None:
    if not has_app_context():
        return
    items = g.get(key)
    if items is None:
        items = []
        setattr(g, key, items)
    items.append(item)


def _pop(key: str) -> list:
    if not has_app_context():
        return []
    return g.pop(key, None) or []


def add_warning(message: str) -> None:
    _append(_WARNINGS_KEY, message)


def add_task(task_id: str, task_type: str) -> None:
    _append(_TASKS_KEY, {'id': task_id, 'task_type': task_type})


def pop_warnings() -> list:
    return _pop(_WARNINGS_KEY)


def pop_tasks() -> list:
    return _pop(_TASKS_KEY)