from __future__ import annotations
import urllib.request
import urllib.parse
import urllib.error
import json

from flask import request
from flask_login import login_required, current_user

from app.api.v1 import bp
from app.api.v1.helpers import success, error
from app.extensions import db
from app.models.integration import ExternalIntegration


# ─── helpers ─────────────────────────────────────────────────────────

def _require_admin():
    from app.models import Institution
    inst = Institution.query.get(current_user.active_institution_id)
    if not inst:
        return error('No active institution', 400)
    if not current_user.is_institution_admin_of(inst) and not current_user.is_system_admin:
        return error('Institution admin access required', 403)
    return None


def _serialize(intg: ExternalIntegration) -> dict:
    return {
        'id': intg.id,
        'name': intg.name,
        'entity_type': intg.entity_type,
        'base_url': intg.base_url,
        'search_path': intg.search_path,
        'headers': intg.headers or {},
        'result_path': intg.result_path,
        'field_mappings': intg.field_mappings or {},
        'is_active': intg.is_active,
    }


def _resolve_path(obj, path: str):
    """Walk a dot-separated path through a dict/list. Returns None if missing."""
    if not path:
        return obj
    for key in path.split('.'):
        if isinstance(obj, dict):
            obj = obj.get(key)
        elif isinstance(obj, list) and key.isdigit():
            obj = obj[int(key)]
        else:
            return None
        if obj is None:
            return None
    return obj


def _parse_json_field(value):
    """Ensure a value that may be a JSON string or already a dict/list is parsed."""
    if value is None:
        return {}
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return {}
    return {}


# ─── CRUD ─────────────────────────────────────────────────────────────

@bp.route('/integrations', methods=['GET'])
@login_required
def list_integrations():
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    entity_type = request.args.get('entity_type')
    q = ExternalIntegration.query.filter_by(
        institution_id=current_user.active_institution_id,
        is_active=True,
    )
    if entity_type:
        q = q.filter_by(entity_type=entity_type)
    return success([_serialize(i) for i in q.order_by(ExternalIntegration.name).all()])


@bp.route('/integrations', methods=['POST'])
@login_required
def create_integration():
    err = _require_admin()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    required = ['name', 'entity_type', 'base_url', 'search_path']
    missing = [f for f in required if not data.get(f)]
    if missing:
        return error(f'Missing required fields: {", ".join(missing)}', 400)

    intg = ExternalIntegration(
        institution_id=current_user.active_institution_id,
        name=data['name'],
        entity_type=data['entity_type'],
        base_url=data['base_url'].rstrip('/'),
        search_path=data['search_path'],
        headers=_parse_json_field(data.get('headers')),
        result_path=(data.get('result_path') or '').strip(),
        field_mappings=_parse_json_field(data.get('field_mappings')),
        is_active=data.get('is_active', True),
    )
    db.session.add(intg)
    db.session.commit()
    return success(_serialize(intg), 201)


@bp.route('/integrations/<int:intg_id>', methods=['PATCH'])
@login_required
def update_integration(intg_id):
    err = _require_admin()
    if err:
        return err
    intg = ExternalIntegration.query.filter_by(
        id=intg_id,
        institution_id=current_user.active_institution_id,
    ).first_or_404()

    data = request.get_json(silent=True) or {}
    for field in ['name', 'entity_type', 'is_active']:
        if field in data:
            setattr(intg, field, data[field])
    if 'base_url' in data:
        intg.base_url = data['base_url'].rstrip('/')
    if 'search_path' in data:
        intg.search_path = data['search_path']
    if 'result_path' in data:
        intg.result_path = (data['result_path'] or '').strip()
    if 'headers' in data:
        intg.headers = _parse_json_field(data['headers'])
    if 'field_mappings' in data:
        intg.field_mappings = _parse_json_field(data['field_mappings'])

    db.session.commit()
    return success(_serialize(intg))


@bp.route('/integrations/<int:intg_id>', methods=['DELETE'])
@login_required
def delete_integration(intg_id):
    err = _require_admin()
    if err:
        return err
    intg = ExternalIntegration.query.filter_by(
        id=intg_id,
        institution_id=current_user.active_institution_id,
    ).first_or_404()
    db.session.delete(intg)
    db.session.commit()
    return success({'deleted': intg_id})


# ─── Diagnostic endpoint ──────────────────────────────────────────────
# GET /api/v1/integrations/<id>/debug?q=segerberg
# Returns every intermediate step so you can see exactly what's happening.

@bp.route('/integrations/<int:intg_id>/debug', methods=['GET'])
@login_required
def debug_integration(intg_id):
    if not current_user.active_institution_id:
        return error('No active institution', 400)

    intg = ExternalIntegration.query.filter_by(
        id=intg_id,
        institution_id=current_user.active_institution_id,
    ).first_or_404()

    query = request.args.get('q', 'test').strip()
    encoded = urllib.parse.quote(query, safe='')
    path = intg.search_path.replace('{query}', encoded)
    url = f'{intg.base_url}/{path}'

    headers = {'User-Agent': 'Kurbits/1.0'}
    if intg.headers:
        headers.update(intg.headers)

    # Step 1 — fetch
    fetch_error = None
    raw = None
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        fetch_error = str(e)

    if fetch_error:
        return success({
            'step': 'fetch_failed',
            'url': url,
            'error': fetch_error,
        })

    # Step 2 — resolve result_path
    result_path = (intg.result_path or '').strip()
    if result_path:
        items = _resolve_path(raw, result_path)
    else:
        items = raw

    # Step 3 — parse mappings
    mappings = _parse_json_field(intg.field_mappings)

    # Step 4 — map first item only (for brevity)
    first_mapped = None
    if isinstance(items, list) and items:
        item = items[0]
        mapped = {'_integration_id': intg.id, '_integration_name': intg.name}
        for target_field, source_path in mappings.items():
            val = _resolve_path(item, str(source_path).strip())
            if val is not None:
                mapped[target_field] = val
        first_mapped = mapped

    return success({
        'config': {
            'base_url':     intg.base_url,
            'search_path':  intg.search_path,
            'result_path':  result_path,
            'field_mappings': mappings,
            'field_mappings_raw_type': type(intg.field_mappings).__name__,
        },
        'url_called': url,
        'raw_response_type': type(raw).__name__,
        'raw_response_keys': list(raw.keys()) if isinstance(raw, dict) else f'list of {len(raw)}',
        'items_after_result_path': {
            'type': type(items).__name__,
            'count': len(items) if isinstance(items, list) else 'n/a',
            'first_item_keys': list(items[0].keys()) if isinstance(items, list) and items else None,
        },
        'first_item_raw': items[0] if isinstance(items, list) and items else items,
        'first_item_mapped': first_mapped,
    })


# ─── Proxy search ─────────────────────────────────────────────────────

@bp.route('/integrations/<int:intg_id>/search', methods=['GET'])
@login_required
def search_integration(intg_id):
    if not current_user.active_institution_id:
        return error('No active institution', 400)

    intg = ExternalIntegration.query.filter_by(
        id=intg_id,
        institution_id=current_user.active_institution_id,
        is_active=True,
    ).first_or_404()

    query = request.args.get('q', '').strip()
    if not query:
        return success([])

    encoded = urllib.parse.quote(query, safe='')
    path = intg.search_path.replace('{query}', encoded)
    url = f'{intg.base_url}/{path}'

    headers = {'User-Agent': 'Kurbits/1.0'}
    if intg.headers:
        headers.update(intg.headers)

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return error(f'External API returned {e.code}', 502)
    except Exception as e:
        return error(f'External API unreachable: {str(e)}', 502)

    result_path = (intg.result_path or '').strip()
    items = _resolve_path(raw, result_path) if result_path else raw
    if not isinstance(items, list):
        items = [items] if isinstance(items, dict) else []

    mappings = _parse_json_field(intg.field_mappings)

    results = []
    for item in items:
        if not isinstance(item, dict):
            continue
        mapped: dict = {
            '_integration_id':   intg.id,
            '_integration_name': intg.name,
        }
        for target_field, source_path in mappings.items():
            val = _resolve_path(item, str(source_path).strip())
            if val is not None:
                mapped[target_field] = val
        results.append(mapped)

    return success(results)