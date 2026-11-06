from __future__ import annotations

import re

from flask import request
from flask_login import login_required, current_user

from app.api.v1 import bp
from app.api.v1.helpers import success, error, require_institution_admin
from app.extensions import db
from app.models.agent import AgentType
from app.models.agent_type_schema import AgentTypeSchema

AGENT_TYPES = [t.value for t in AgentType]
FIELD_TYPES = {
    'text', 'textarea', 'number', 'date', 'select', 'multiselect',
    'boolean', 'url', 'email', 'integration',
}
_FIELD_NAME_RE = re.compile(r'^[a-z0-9][a-z0-9_]*$')


# ─── Helpers ──────────────────────────────────────────────────────────

def _serialize(agent_type: str, schema: AgentTypeSchema | None) -> dict:
    metadata_schema = dict(schema.metadata_schema or {}) if schema else {}
    metadata_schema.setdefault('fields', [])
    return {'agent_type': agent_type, 'metadata_schema': metadata_schema}


def _validate_fields(raw) -> tuple[list, list[str]]:
    if not isinstance(raw, list):
        return [], ['fields must be a list']
    clean: list[dict] = []
    errors: list[str] = []
    seen: set[str] = set()
    for i, field in enumerate(raw, 1):
        if not isinstance(field, dict):
            errors.append(f'Field #{i}: must be an object')
            continue
        name = str(field.get('name') or '').strip()
        if not _FIELD_NAME_RE.match(name):
            errors.append(f'Field #{i}: the key must start with a–z or 0–9 and only contain a–z, 0–9 and _')
            continue
        if name in seen:
            errors.append(f'Field #{i}: the key "{name}" is used twice')
            continue
        ftype = field.get('type') or 'text'
        if ftype not in FIELD_TYPES:
            errors.append(f'Field #{i}: unknown type "{ftype}"')
            continue
        seen.add(name)
        clean.append({**field, 'name': name, 'type': ftype, 'label': str(field.get('label') or name)})
    return clean, errors


# ─── Routes ───────────────────────────────────────────────────────────

@bp.route('/agents/type-schemas', methods=['GET'])
@login_required
def list_agent_type_schemas():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)
    existing = {
        s.agent_type: s
        for s in AgentTypeSchema.query.filter_by(institution_id=institution_id).all()
    }
    return success([_serialize(at, existing.get(at)) for at in AGENT_TYPES])


@bp.route('/agents/type-schemas/<string:agent_type>', methods=['GET'])
@login_required
def get_agent_type_schema(agent_type):
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)
    if agent_type not in AGENT_TYPES:
        return error(f'Invalid agent_type. Must be one of: {", ".join(AGENT_TYPES)}', 400)
    return success(_serialize(agent_type, AgentTypeSchema.for_type(institution_id, agent_type)))


@bp.route('/agents/type-schemas/<string:agent_type>', methods=['PATCH'])
@login_required
@require_institution_admin
def update_agent_type_schema(agent_type):
    institution_id = current_user.active_institution_id
    if agent_type not in AGENT_TYPES:
        return error(f'Invalid agent_type. Must be one of: {", ".join(AGENT_TYPES)}', 400)

    data = request.get_json(silent=True) or {}
    incoming = data.get('metadata_schema')
    if not isinstance(incoming, dict):
        return error('metadata_schema must be an object', 400)

    schema = AgentTypeSchema.for_type(institution_id, agent_type)
    if schema is None:
        schema = AgentTypeSchema(institution_id=institution_id, agent_type=agent_type, metadata_schema={})
        db.session.add(schema)

    merged = dict(schema.metadata_schema or {})
    if 'fields' in incoming:
        fields, errors = _validate_fields(incoming['fields'])
        if errors:
            return error('; '.join(errors), 422)
        merged['fields'] = fields
    merged.setdefault('fields', [])

    schema.metadata_schema = merged
    db.session.commit()
    return success(_serialize(agent_type, schema))