import logging
import threading
import uuid

import requests
import sqlalchemy as sa
import sqlalchemy.orm as so
from flask import current_app, has_app_context, has_request_context
from sqlalchemy.exc import IntegrityError

from app.request_feedback import add_task

log = logging.getLogger(__name__)

_QUEUE_KEY = 'auto_identifier_queue'
_STARTED_KEY = 'auto_identifier_started_tasks'
_DETACHED_KEY = 'auto_identifier_detached_batches'
_BUSY_KEY = 'auto_identifier_busy'
_TIMEOUT = 15


class MintError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.message = message
        self.status = status


# ── Request context ──────────────────────────────────────────────

def build_context(scheme, entity, kind: str) -> dict:
    shoulder = scheme.generator_shoulder or ''
    if kind == 'node':
        ref_code = entity.ref_code or ''
        target_url = ''
        if scheme.target_url_template:
            target_url = (scheme.target_url_template
                          .replace('{ref_code}', ref_code)
                          .replace('{node_id}', str(entity.id)))
        return {
            'entity_type': 'node',
            'entity_id': str(entity.id),
            'node_id': str(entity.id),
            'agent_id': '',
            'ref_code': ref_code,
            'title': entity.title or '',
            'name': entity.title or '',
            'target_url': target_url,
            'shoulder': shoulder,
        }

    name = entity.authorized_form or entity.name or ''
    target_url = ''
    if scheme.agent_target_url_template:
        target_url = scheme.agent_target_url_template.replace('{agent_id}', str(entity.id))
    return {
        'entity_type': 'agent',
        'entity_id': str(entity.id),
        'node_id': '',
        'agent_id': str(entity.id),
        'ref_code': '',
        'title': name,
        'name': name,
        'target_url': target_url,
        'shoulder': shoulder,
    }


def _default_body(ctx: dict) -> dict:
    if ctx['entity_type'] == 'node':
        return {'node_id': int(ctx['node_id']), 'ref_code': ctx['ref_code'] or None, 'title': ctx['title']}
    return {'agent_id': int(ctx['agent_id']), 'name': ctx['name']}


def _substitute(obj, ctx: dict):
    if isinstance(obj, str):
        out = obj
        for k, v in ctx.items():
            out = out.replace('{' + k + '}', v)
        return out
    if isinstance(obj, dict):
        return {k: _substitute(v, ctx) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_substitute(v, ctx) for v in obj]
    return obj


def _resolve_path(obj, path: str):
    if not path:
        return obj
    for key in path.split('.'):
        if isinstance(obj, dict):
            obj = obj.get(key)
        elif isinstance(obj, list) and key.isdigit():
            obj = obj[int(key)] if int(key) < len(obj) else None
        else:
            return None
    return obj


# ── Minting ──────────────────────────────────────────────────────

def mint_value(scheme, ctx: dict, http=None) -> str:
    if not scheme.generator_url:
        raise MintError(f'{scheme.name} has no generator service configured.', 422)

    if scheme.generator_body_template:
        body = _substitute(scheme.generator_body_template, ctx)
    else:
        body = _default_body(ctx)

    headers = {'Content-Type': 'application/json'}
    if scheme.generator_headers:
        headers.update(scheme.generator_headers)

    client = http or requests
    try:
        resp = client.post(scheme.generator_url, json=body, headers=headers, timeout=_TIMEOUT)
        resp.raise_for_status()
        payload = resp.json()
    except requests.HTTPError as e:
        detail = ''
        try:
            detail = f' — {e.response.text[:200]}'
        except Exception:
            pass
        raise MintError(f'Generator service returned {e.response.status_code}{detail}')
    except Exception as e:
        raise MintError(f'Generator service error: {e}')

    path = scheme.generator_response_path or 'value'
    raw = _resolve_path(payload, path)
    value = str(raw).strip() if raw is not None else ''
    if not value:
        raise MintError(f'Could not find the identifier at "{path}" in the service response.')
    return value


def value_in_use(session, scheme_id: int, value: str) -> bool:
    from app.models.node import NodeIdentifier
    from app.models.agent import AgentIdentifier
    for model in (NodeIdentifier, AgentIdentifier):
        if session.scalar(sa.select(sa.exists().where(
                model.scheme_id == scheme_id, model.value == value))):
            return True
    return False


# ── Auto-assignment ──────────────────────────────────────────────

def _models() -> dict:
    from app.models.node import Node
    from app.models.agent import Agent
    return {'node': Node, 'agent': Agent}


def _auto_schemes(session, institution_id: int, kind: str, cache: dict) -> list:
    key = (institution_id, kind)
    if key not in cache:
        from app.models.node import IdentifierScheme
        flag = (IdentifierScheme.auto_assign_nodes if kind == 'node'
                else IdentifierScheme.auto_assign_agents)
        cache[key] = session.scalars(
            sa.select(IdentifierScheme)
            .where(
                IdentifierScheme.institution_id == institution_id,
                IdentifierScheme.is_active.is_(True),
                flag.is_(True),
                IdentifierScheme.generator_url.isnot(None),
            )
            .order_by(IdentifierScheme.sort_order, IdentifierScheme.name)
        ).all()
    return cache[key]


def _level_allowed(scheme, node) -> bool:
    levels = {l.strip().lower() for l in (scheme.auto_assign_levels or []) if l and l.strip()}
    if not levels:
        return True
    return (node.level_of_description or '').strip().lower() in levels


def _applicable_schemes(session, kind: str, entity, cache: dict) -> list:
    schemes = _auto_schemes(session, entity.institution_id, kind, cache)
    if kind == 'node':
        schemes = [s for s in schemes if _level_allowed(s, entity)]
    return schemes


def _label(entity, kind: str) -> str:
    if kind == 'node':
        return entity.ref_code or entity.title or f'#{entity.id}'
    return entity.name or f'#{entity.id}'


def assign_identifiers(session, kind: str, entity, cache: dict = None, http=None) -> tuple:
    from app.models.node import NodeIdentifier
    from app.models.agent import AgentIdentifier

    ident_model, fk = ((NodeIdentifier, 'node_id') if kind == 'node'
                       else (AgentIdentifier, 'agent_id'))
    cache = cache if cache is not None else {}
    label = _label(entity, kind)
    added = 0
    warnings = []

    for scheme in _applicable_schemes(session, kind, entity, cache):
        already = session.scalar(sa.select(sa.exists().where(
            getattr(ident_model, fk) == entity.id,
            ident_model.scheme_id == scheme.id,
        )))
        if already:
            continue

        try:
            value = mint_value(scheme, build_context(scheme, entity, kind), http=http)
        except MintError as e:
            warnings.append(f'{scheme.name} was not assigned to "{label}": {e.message}')
            continue

        if value_in_use(session, scheme.id, value):
            warnings.append(
                f'{scheme.name} was not assigned to "{label}": the service returned '
                f'"{value}", which is already in use.')
            continue

        session.add(ident_model(**{
            fk: entity.id,
            'scheme_id': scheme.id,
            'value': value,
            'is_primary': True,
            'created_by_id': entity.created_by_id,
        }))
        added += 1

    return added, warnings


def assign_batch(session, node_ids: list, agent_ids: list, on_progress=None) -> tuple:
    models = _models()
    items = [('node', i) for i in node_ids] + [('agent', i) for i in agent_ids]
    total = len(items)
    cache = {}
    assigned = 0
    warnings = []

    with requests.Session() as http:
        for index, (kind, entity_id) in enumerate(items, start=1):
            entity = session.get(models[kind], entity_id)
            added, item_warnings = 0, []
            label = None
            if entity is not None:
                label = _label(entity, kind)
                added, item_warnings = assign_identifiers(session, kind, entity, cache=cache, http=http)
            if on_progress:
                on_progress(index, total)
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
                cache.clear()
                added = 0
                item_warnings = [
                    f'Identifiers for "{label}" were not saved: a generated value was '
                    f'taken by another record at the same time.']
            assigned += added
            warnings.extend(item_warnings)

    return assigned, warnings


# ── Scheduling ───────────────────────────────────────────────────

def _acting_user_id():
    if not has_request_context():
        return None
    from flask_login import current_user
    if current_user and current_user.is_authenticated:
        return current_user.id
    return None


def _create_tasks(session, queue: list) -> None:
    from app.models.background_task import BackgroundTask
    from app.tasks.identifier_assignment import TASK_TYPE

    models = _models()
    cache = {}
    batches = {}

    for kind, entity_id in dict.fromkeys(queue):
        entity = session.get(models[kind], entity_id)
        if entity is None or not _applicable_schemes(session, kind, entity, cache):
            continue
        batch = batches.setdefault(
            entity.institution_id, {'node_ids': [], 'agent_ids': [], 'fallback_user_id': None})
        batch[f'{kind}_ids'].append(entity.id)
        batch['fallback_user_id'] = batch['fallback_user_id'] or entity.created_by_id

    if not batches:
        return

    acting_user_id = _acting_user_id()
    started = session.info.setdefault(_STARTED_KEY, [])
    detached = session.info.setdefault(_DETACHED_KEY, [])

    for institution_id, batch in batches.items():
        payload = {'node_ids': batch['node_ids'], 'agent_ids': batch['agent_ids']}
        user_id = acting_user_id or batch['fallback_user_id']
        if user_id is None:
            detached.append(payload)
            continue

        task_id = str(uuid.uuid4())
        session.add(BackgroundTask(
            id=task_id,
            institution_id=institution_id,
            created_by_id=user_id,
            task_type=TASK_TYPE,
            entity_type='identifier_batch',
            entity_id=0,
            result=payload,
        ))
        started.append(task_id)
        add_task(task_id, TASK_TYPE)


def _spawn(app, fn, arg, wait: bool) -> None:
    def _run():
        with app.app_context():
            try:
                fn(arg)
            except Exception:
                log.exception('Identifier assignment crashed')

    thread = threading.Thread(target=_run, daemon=not wait)
    thread.start()
    if wait:
        thread.join()


def _run_detached(payload: dict) -> None:
    from app.extensions import db
    _, warnings = assign_batch(db.session, payload['node_ids'], payload['agent_ids'])
    for message in warnings:
        log.warning(message)


# ── Session hooks ────────────────────────────────────────────────

@sa.event.listens_for(so.Session, 'after_flush')
def _queue_new_records(session, flush_context):
    from app.models.node import Node
    from app.models.agent import Agent

    queue = session.info.setdefault(_QUEUE_KEY, [])
    for obj in session.new:
        if isinstance(obj, Node):
            queue.append(('node', obj.id))
        elif isinstance(obj, Agent):
            queue.append(('agent', obj.id))


@sa.event.listens_for(so.Session, 'before_commit')
def _schedule_before_commit(session):
    if session.info.get(_BUSY_KEY):
        return
    session.info[_BUSY_KEY] = True
    try:
        session.flush()
        queue = session.info.pop(_QUEUE_KEY, None)
        if queue:
            _create_tasks(session, queue)
    finally:
        session.info.pop(_BUSY_KEY, None)


@sa.event.listens_for(so.Session, 'after_commit')
def _start_after_commit(session):
    task_ids = session.info.pop(_STARTED_KEY, None) or []
    detached = session.info.pop(_DETACHED_KEY, None) or []
    if not task_ids and not detached:
        return
    if not has_app_context():
        log.warning('Identifier assignment skipped: no app context after commit')
        return

    from app.tasks.runner import run_in_background
    from app.tasks.identifier_assignment import run_identifier_assignment

    app = current_app._get_current_object()
    wait = not has_request_context() and threading.current_thread() is threading.main_thread()

    for task_id in task_ids:
        if wait:
            _spawn(app, run_identifier_assignment, task_id, wait=True)
        else:
            run_in_background(app, task_id, run_identifier_assignment)

    for payload in detached:
        _spawn(app, _run_detached, payload, wait=wait)


@sa.event.listens_for(so.Session, 'after_soft_rollback')
def _clear_on_rollback(session, previous_transaction):
    if not previous_transaction.nested:
        session.info.pop(_QUEUE_KEY, None)
        session.info.pop(_STARTED_KEY, None)
        session.info.pop(_DETACHED_KEY, None)