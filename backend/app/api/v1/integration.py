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
from app.services.sources import current_lang, get_plugin_class, is_enabled, localize
from app.services.sources.config import public_config, validate_config

LOOKUP_TYPES = ('agent', 'metadata')
SOURCE_TYPE = 'source'
ENTITY_TYPES = LOOKUP_TYPES + (SOURCE_TYPE,)


# ─── Helpers ──────────────────────────────────────────────────────────

def _current_institution():
    from app.models import Institution
    if not current_user.active_institution_id:
        return None
    return Institution.query.get(current_user.active_institution_id)


def _is_admin() -> bool:
    inst = _current_institution()
    if not inst:
        return False
    return current_user.is_system_admin or current_user.is_institution_admin_of(inst)


def _require_admin():
    inst = _current_institution()
    if not inst:
        return error('No active institution', 400)
    if not current_user.is_institution_admin_of(inst) and not current_user.is_system_admin:
        return error('Institution admin access required', 403)
    return None


def _parse_json_field(value):
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


def _serialize(intg: ExternalIntegration, include_secrets: bool = False) -> dict:
    headers = _parse_json_field(intg.headers)
    data = {
        'id': intg.id,
        'name': intg.name,
        'entity_type': intg.entity_type,
        'is_active': intg.is_active,
        'plugin': intg.plugin,
        'base_url': intg.base_url,
        'search_path': intg.search_path,
        'result_path': intg.result_path,
        'field_mappings': intg.field_mappings or {},
        'headers': headers if include_secrets else {},
        'has_headers': bool(headers),
    }
    if intg.entity_type == SOURCE_TYPE:
        plugin_cls = get_plugin_class(intg.plugin)
        values, secrets_set = public_config(plugin_cls, intg.config)
        data.update({
            'plugin_label': localize(plugin_cls.label, current_lang()) if plugin_cls else intg.plugin,
            'plugin_installed': plugin_cls is not None,
            'config': values,
            'secrets_set': secrets_set,
        })
    return data


def _resolve_path(obj, path: str):
    if not path:
        return obj
    for key in path.split('.'):
        if isinstance(obj, dict):
            obj = obj.get(key)
        elif isinstance(obj, list) and key.isdigit():
            idx = int(key)
            obj = obj[idx] if idx < len(obj) else None
        else:
            return None
        if obj is None:
            return None
    return obj


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
    include_secrets = _is_admin()
    return success([_serialize(i, include_secrets) for i in q.order_by(ExternalIntegration.name).all()])


@bp.route('/integrations', methods=['POST'])
@login_required
def create_integration():
    err = _require_admin()
    if err:
        return err
    data = request.get_json(silent=True) or {}

    name = (data.get('name') or '').strip()
    entity_type = (data.get('entity_type') or '').strip()
    if not name:
        return error('name is required', 400)
    if entity_type not in ENTITY_TYPES:
        return error(f'entity_type must be one of: {", ".join(ENTITY_TYPES)}', 400)
    if entity_type == 'agent':
        return error('Agent lookups are replaced by source plugins. Create a source instead.', 400)

    if entity_type == SOURCE_TYPE:
        plugin_key = (data.get('plugin') or '').strip()
        plugin_cls = get_plugin_class(plugin_key)
        if plugin_cls is None:
            return error(f'Unknown plugin "{plugin_key}"', 400)
        if not is_enabled(plugin_key, _current_institution()):
            return error('This plugin is disabled for the institution', 403)
        config, errors = validate_config(plugin_cls, data.get('config'))
        if errors:
            return error('; '.join(errors), 422)
        intg = ExternalIntegration(
            institution_id=current_user.active_institution_id,
            name=name,
            entity_type=SOURCE_TYPE,
            plugin=plugin_key,
            config=config,
            base_url='',
            search_path='',
            result_path='',
            is_active=data.get('is_active', True),
        )
    else:
        base_url = (data.get('base_url') or '').strip().rstrip('/')
        search_path = (data.get('search_path') or '').strip()
        missing = [n for n, v in (('base_url', base_url), ('search_path', search_path)) if not v]
        if missing:
            return error(f'Missing required fields: {", ".join(missing)}', 400)
        intg = ExternalIntegration(
            institution_id=current_user.active_institution_id,
            name=name,
            entity_type=entity_type,
            base_url=base_url,
            search_path=search_path,
            headers=_parse_json_field(data.get('headers')),
            result_path=(data.get('result_path') or '').strip(),
            field_mappings=_parse_json_field(data.get('field_mappings')),
            is_active=data.get('is_active', True),
        )

    db.session.add(intg)
    db.session.commit()
    return success(_serialize(intg, include_secrets=True), 201)


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

    if 'entity_type' in data and data['entity_type'] != intg.entity_type:
        if SOURCE_TYPE in (data['entity_type'], intg.entity_type):
            return error('A source cannot be converted to or from a lookup integration', 422)
        if data['entity_type'] not in LOOKUP_TYPES:
            return error(f'entity_type must be one of: {", ".join(LOOKUP_TYPES)}', 400)
        intg.entity_type = data['entity_type']

    if 'plugin' in data and data['plugin'] != intg.plugin:
        return error('The plugin of an existing source cannot be changed. Create a new source instead.', 422)

    if 'name' in data:
        name = (data['name'] or '').strip()
        if not name:
            return error('name cannot be empty', 400)
        intg.name = name
    if 'is_active' in data:
        intg.is_active = bool(data['is_active'])

    if intg.entity_type == SOURCE_TYPE:
        if 'config' in data:
            plugin_cls = get_plugin_class(intg.plugin)
            if plugin_cls is None:
                return error(f'Plugin "{intg.plugin}" is not installed', 404)
            config, errors = validate_config(plugin_cls, data['config'], intg.config)
            if errors:
                return error('; '.join(errors), 422)
            intg.config = config
    else:
        if 'base_url' in data:
            intg.base_url = (data['base_url'] or '').strip().rstrip('/')
        if 'search_path' in data:
            intg.search_path = (data['search_path'] or '').strip()
        if 'result_path' in data:
            intg.result_path = (data['result_path'] or '').strip()
        if 'headers' in data:
            intg.headers = _parse_json_field(data['headers'])
        if 'field_mappings' in data:
            intg.field_mappings = _parse_json_field(data['field_mappings'])
        if not intg.base_url or not intg.search_path:
            return error('base_url and search_path are required', 400)

    db.session.commit()
    return success(_serialize(intg, include_secrets=True))


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


# ─── Lookup search (agent / metadata) ─────────────────────────────────

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
    if intg.entity_type == SOURCE_TYPE:
        return error('Sources are searched through /sources/integrations/<id>/search', 400)

    query = request.args.get('q', '').strip()
    if not query:
        return success([])

    encoded = urllib.parse.quote(query, safe='')
    path = intg.search_path.replace('{query}', encoded)
    url = f'{intg.base_url}/{path}'

    headers = {'User-Agent': 'Kurbits/1.0'}
    headers.update(_parse_json_field(intg.headers))

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