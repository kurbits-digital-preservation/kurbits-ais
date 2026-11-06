from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

import sqlalchemy as sa
from flask import current_app
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models import AgentNameForm, AgentNameFormType
from app.models.agent import Agent, AgentIdentifier
from app.models.integration import ExternalIntegration
from app.models.node import IdentifierScheme
from app.request_feedback import add_warning
from app.services.identifier_minting import value_in_use
from .base import FetchedRecord, SourceError, SourcePlugin, is_empty, localize, to_text
from .node_mapping import FILL_MODES, IDENTIFIER_TARGET, META_PREFIX, _coerce, _display, _first_value
from .node_mapping import msg as node_msg
from .registry import get_plugin_class, plugin_for

AGENT_PREFIX = 'agent.'
NAME_FORM_TARGET = 'name_form'
PROVENANCE_KEY = '_sources'
IMPORT_TOKEN_SALT = 'source-import-agent-v1'
IMPORT_TOKEN_MAX_AGE = 60 * 60 * 24
MAX_IMPORTS_PER_SAVE = 10
MAX_NAME_FORMS = 50

AGENT_TARGETS: dict[str, dict] = {
    'name':            {'label': {'sv': 'Namn', 'en': 'Name'}, 'type': 'text', 'max_length': 300},
    'authorized_form': {'label': {'sv': 'Auktoriserad namnform', 'en': 'Authorised form'}, 'type': 'text', 'max_length': 300},
    'description':     {'label': {'sv': 'Beskrivning', 'en': 'Description'}, 'type': 'textarea'},
    'date_from':       {'label': {'sv': 'Verksam från', 'en': 'Date from'}, 'type': 'text', 'max_length': 50},
    'date_to':         {'label': {'sv': 'Verksam till', 'en': 'Date to'}, 'type': 'text', 'max_length': 50},
    'website':         {'label': {'sv': 'Webbplats', 'en': 'Website'}, 'type': 'text', 'max_length': 300},
}

AGENT_MESSAGES = {
    'conflict_agent': {'sv': 'Används redan av agenten {name}', 'en': 'Already used by the agent {name}'},
    'conflict_node':  {'sv': 'Används redan av en arkivpost', 'en': 'Already used by a record'},
}


def msg(key: str, lang: str, **kwargs) -> str:
    if key in AGENT_MESSAGES:
        return localize(AGENT_MESSAGES[key], lang).format(**kwargs)
    return node_msg(key, lang, **kwargs)


# ─── Targets ──────────────────────────────────────────────────────────

def agent_targets(lang: str) -> list[dict]:
    return [
        {
            'target': f'{AGENT_PREFIX}{name}',
            'field': name,
            'label': localize(spec['label'], lang),
            'type': spec['type'],
        }
        for name, spec in AGENT_TARGETS.items()
    ]


def agent_target_spec(target: str, fields: list, lang: str) -> Optional[dict]:
    if target.startswith(AGENT_PREFIX):
        name = target[len(AGENT_PREFIX):]
        spec = AGENT_TARGETS.get(name)
        if not spec:
            return None
        return {
            'kind': 'agent', 'field': name, 'label': localize(spec['label'], lang),
            'type': spec['type'], 'max_length': spec.get('max_length'), 'options': [],
        }
    if target.startswith(META_PREFIX):
        name = target[len(META_PREFIX):]
        for f in fields or []:
            if isinstance(f, dict) and f.get('name') == name:
                return {
                    'kind': 'meta', 'field': name, 'label': f.get('label') or name,
                    'type': f.get('type') or 'text', 'max_length': None,
                    'options': f.get('options') or [],
                }
    return None


# ─── Agent type configuration ─────────────────────────────────────────

def type_sources(schema) -> list[dict]:
    if schema is None:
        return []
    data = schema.metadata_schema if isinstance(schema.metadata_schema, dict) else {}
    sources = data.get('sources')
    return sources if isinstance(sources, list) else []


def find_type_source(schema, integration_id: int) -> Optional[dict]:
    for entry in type_sources(schema):
        if isinstance(entry, dict) and entry.get('integration_id') == integration_id:
            return entry
    return None


def suggested_for_agent_type(plugin_cls: type[SourcePlugin], agent_type: str, fields: list) -> list[dict]:
    field_names = {f.get('name') for f in fields or [] if isinstance(f, dict)}
    result = []
    for mapping in plugin_cls.suggested_agent_mappings.get(agent_type, ()):
        target = mapping.get('target', '')
        if target in (IDENTIFIER_TARGET, NAME_FORM_TARGET):
            result.append(dict(mapping))
        elif target.startswith(AGENT_PREFIX) and target[len(AGENT_PREFIX):] in AGENT_TARGETS:
            result.append(dict(mapping))
        elif target.startswith(META_PREFIX) and target[len(META_PREFIX):] in field_names:
            result.append(dict(mapping))
    return result


def _known_source_keys(integration) -> Optional[set[str]]:
    try:
        return {k.key for k in plugin_for(integration).source_keys()}
    except SourceError:
        return None


def validate_agent_sources(raw: Any, fields: list, institution_id: int, agent_type: str) -> tuple[list, list[str]]:
    if raw in (None, ''):
        return [], []
    if not isinstance(raw, list):
        return [], ['sources must be a list']

    clean: list[dict] = []
    errors: list[str] = []
    seen_integrations: set[int] = set()

    for i, entry in enumerate(raw, 1):
        prefix = f'Source #{i}'
        if not isinstance(entry, dict):
            errors.append(f'{prefix}: must be an object')
            continue
        try:
            integration_id = int(entry.get('integration_id'))
        except (TypeError, ValueError):
            errors.append(f'{prefix}: integration_id is required')
            continue
        if integration_id in seen_integrations:
            errors.append(f'{prefix}: source {integration_id} is used twice')
            continue
        seen_integrations.add(integration_id)

        integration = db.session.execute(
            sa.select(ExternalIntegration).where(
                ExternalIntegration.id == integration_id,
                ExternalIntegration.institution_id == institution_id,
                ExternalIntegration.entity_type == 'source',
            )
        ).scalar_one_or_none()
        if not integration:
            errors.append(f'{prefix}: source {integration_id} not found')
            continue
        plugin_cls = get_plugin_class(integration.plugin)
        if plugin_cls is None or not plugin_cls.handles_agent_type(agent_type):
            errors.append(f'{prefix}: plugin "{integration.plugin}" cannot describe agents of type {agent_type}')
            continue

        fill_mode = entry.get('fill_mode') or 'empty_only'
        if fill_mode not in FILL_MODES:
            errors.append(f'{prefix}: fill_mode must be one of {", ".join(FILL_MODES)}')
            continue

        known_keys = _known_source_keys(integration)
        mappings: list[dict] = []
        seen_targets: set[str] = set()

        for j, mapping in enumerate(entry.get('mappings') or [], 1):
            mp = f'{prefix}, mapping #{j}'
            if not isinstance(mapping, dict):
                errors.append(f'{mp}: must be an object')
                continue

            target = str(mapping.get('target') or '').strip()
            sources = list(dict.fromkeys(
                str(s).strip() for s in (mapping.get('sources') or []) if str(s).strip()
            ))
            if not sources:
                errors.append(f'{mp}: at least one source key is required')
                continue
            if known_keys is not None:
                unknown = [s for s in sources if s not in known_keys]
                if unknown:
                    errors.append(f'{mp}: unknown source key(s) {", ".join(unknown)}')
                    continue

            if target == IDENTIFIER_TARGET:
                scheme = str(mapping.get('scheme') or '').strip()
                if not scheme:
                    errors.append(f'{mp}: identifier mappings need a scheme')
                    continue
                dedupe_key = f'identifier:{scheme.lower()}'
                clean_mapping = {'target': target, 'sources': sources, 'scheme': scheme}
            elif target == NAME_FORM_TARGET:
                name_form_type = str(mapping.get('name_form_type') or '').strip()
                if not name_form_type:
                    errors.append(f'{mp}: name form mappings need a name form type')
                    continue
                dedupe_key = f'name_form:{name_form_type.lower()}'
                clean_mapping = {'target': target, 'sources': sources, 'name_form_type': name_form_type[:100]}
            else:
                if agent_target_spec(target, fields, 'en') is None:
                    errors.append(f'{mp}: unknown target "{target}"')
                    continue
                dedupe_key = target
                clean_mapping = {'target': target, 'sources': sources}

            if dedupe_key in seen_targets:
                errors.append(f'{mp}: target "{target}" is mapped twice')
                continue
            seen_targets.add(dedupe_key)
            mappings.append(clean_mapping)

        clean.append({'integration_id': integration_id, 'fill_mode': fill_mode, 'mappings': mappings})

    return clean, errors


# ─── Import tokens ────────────────────────────────────────────────────

def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config['SECRET_KEY'], salt=IMPORT_TOKEN_SALT)


def read_agent_import_token(token: Any) -> Optional[dict]:
    if not isinstance(token, str) or not token:
        return None
    try:
        data = _serializer().loads(token, max_age=IMPORT_TOKEN_MAX_AGE)
    except BadSignature:
        return None
    return data if isinstance(data, dict) else None


# ─── Preview ──────────────────────────────────────────────────────────

def _split_names(value: Any) -> list[str]:
    items = value if isinstance(value, list) else (to_text(value) or '').split('\n')
    seen: set[str] = set()
    names: list[str] = []
    for item in items:
        name = to_text(item)
        if name and name.lower() not in seen:
            seen.add(name.lower())
            names.append(name)
    return names


def _all_values(values: dict, sources: list[str]) -> tuple[list[str], Optional[str]]:
    names: list[str] = []
    used: list[str] = []
    for key in sources:
        found = _split_names(values.get(key))
        if found:
            names.extend(found)
            used.append(key)
    return _split_names(names), (', '.join(used) or None)


def _identifier_row(scheme_name: str, raw_value: Any, source_key: Optional[str],
                    agent_id: Optional[int], institution_id: int, lang: str) -> Optional[dict]:
    value = to_text(raw_value)
    if not value or not scheme_name:
        return None

    status = None
    message = None
    scheme = IdentifierScheme._find_by_name(institution_id, scheme_name)
    if scheme and value_in_use(db.session, scheme.id, value):
        on_agent = db.session.execute(
            sa.select(AgentIdentifier).where(
                AgentIdentifier.scheme_id == scheme.id,
                AgentIdentifier.value == value,
            )
        ).scalars().first()
        if on_agent is None:
            status = 'conflict'
            message = msg('conflict_node', lang)
        elif agent_id and on_agent.agent_id == agent_id:
            status = 'attached'
        else:
            other = db.session.get(Agent, on_agent.agent_id)
            status = 'conflict'
            message = msg('conflict_agent', lang, name=other.name if other else on_agent.agent_id)

    selectable = status is None
    return {
        'key': f'identifier:{scheme_name.lower()}',
        'kind': 'identifier',
        'field': scheme_name,
        'label': scheme_name,
        'source_key': source_key,
        'current': value if status == 'attached' else '',
        'proposed': value,
        'value': value,
        'scheme': scheme_name,
        'name_form_type': None,
        'selectable': selectable,
        'selected': selectable,
        'status': status,
        'message': message,
    }


def _name_form_row(type_name: str, names: list[str], source_key: Optional[str],
                   agent_id: Optional[int], current_name: Optional[str]) -> Optional[dict]:
    if not type_name or not names:
        return None

    existing: set[str] = set()
    if current_name:
        existing.add(current_name.strip().lower())
    if agent_id:
        rows = db.session.execute(
            sa.select(AgentNameForm.name).where(AgentNameForm.agent_id == agent_id)
        ).scalars().all()
        existing |= {n.strip().lower() for n in rows if n}

    new_names = [n for n in names if n.lower() not in existing][:MAX_NAME_FORMS]
    selectable = bool(new_names)
    return {
        'key': f'name_form:{type_name.lower()}',
        'kind': 'name_form',
        'field': type_name,
        'label': type_name,
        'source_key': source_key,
        'current': '',
        'proposed': '\n'.join(new_names or names),
        'value': new_names,
        'scheme': None,
        'name_form_type': type_name,
        'selectable': selectable,
        'selected': selectable,
        'status': None if selectable else 'attached',
        'message': None,
    }


def build_agent_preview(entry: dict, record: FetchedRecord, integration, agent_type: str, fields: list,
                        current_agent: dict, current_meta: dict, agent_id: Optional[int],
                        institution_id: int, lang: str) -> dict:
    fill_mode = entry.get('fill_mode') or 'empty_only'
    current_name = to_text(current_agent.get('name'))
    rows: list[dict] = []
    token_identifiers: list[dict] = []
    token_name_forms: list[dict] = []

    for mapping in entry.get('mappings') or []:
        target = mapping.get('target') or ''
        sources = mapping.get('sources') or []

        if target == NAME_FORM_TARGET:
            names, used = _all_values(record.values, sources)
            row = _name_form_row(mapping.get('name_form_type'), names, used, agent_id, current_name)
            if row:
                rows.append(row)
                if row['selectable']:
                    token_name_forms.append({'type': row['name_form_type'], 'names': row['value']})
            continue

        raw_value, used = _first_value(record.values, sources)

        if target == IDENTIFIER_TARGET:
            row = _identifier_row(mapping.get('scheme'), raw_value, used, agent_id, institution_id, lang)
            if row:
                rows.append(row)
                if row['selectable']:
                    token_identifiers.append({'scheme': row['scheme'], 'value': row['value']})
            continue

        spec = agent_target_spec(target, fields, lang)
        if spec is None or raw_value is None:
            continue

        value, problem = _coerce(raw_value, spec, lang)
        current = (current_agent if spec['kind'] == 'agent' else current_meta).get(spec['field'])
        base = {
            'key': target,
            'kind': spec['kind'],
            'field': spec['field'],
            'label': spec['label'],
            'source_key': used,
            'current': _display(current),
            'scheme': None,
            'name_form_type': None,
        }

        if value is None:
            if problem:
                rows.append({**base, 'proposed': _display(raw_value), 'value': None,
                             'selectable': False, 'selected': False,
                             'status': 'invalid', 'message': problem})
            continue

        unchanged = to_text(current) == to_text(value)
        selectable = not unchanged
        rows.append({
            **base,
            'proposed': _display(value),
            'value': value,
            'selectable': selectable,
            'selected': selectable and (is_empty(current) or fill_mode == 'overwrite'),
            'status': 'unchanged' if unchanged else None,
            'message': problem,
        })

    token = _serializer().dumps({
        'i': integration.id,
        'inst': institution_id,
        'n': integration.name,
        'p': integration.plugin,
        'x': record.external_id,
        't': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'at': agent_type,
        'ids': token_identifiers,
        'nfs': token_name_forms,
    })

    return {
        'integration_id': integration.id,
        'integration_name': integration.name,
        'external_id': record.external_id,
        'label': record.label,
        'source_url': record.source_url,
        'fill_mode': fill_mode,
        'rows': rows,
        'import_token': token,
    }


# ─── Finalize on agent save ───────────────────────────────────────────

def _attach_agent_identifier(agent: Agent, scheme_name: str, value: str,
                             user_id: Optional[int], note: Optional[str], lang: str) -> None:
    scheme = IdentifierScheme.get_or_create(agent.institution_id, scheme_name)

    already_here = db.session.scalar(sa.select(sa.exists().where(
        AgentIdentifier.agent_id == agent.id,
        AgentIdentifier.scheme_id == scheme.id,
        AgentIdentifier.value == value,
    )))
    if already_here:
        return
    if value_in_use(db.session, scheme.id, value):
        add_warning(msg('identifier_conflict', lang, scheme=scheme_name, value=value))
        return

    has_primary = db.session.scalar(sa.select(sa.exists().where(
        AgentIdentifier.agent_id == agent.id,
        AgentIdentifier.scheme_id == scheme.id,
    )))
    try:
        with db.session.begin_nested():
            db.session.add(AgentIdentifier(
                agent_id=agent.id,
                scheme_id=scheme.id,
                value=value,
                is_primary=not has_primary,
                note=note[:300] if note else None,
                created_by_id=user_id,
            ))
    except IntegrityError:
        add_warning(msg('identifier_conflict', lang, scheme=scheme_name, value=value))


def _name_form_type(institution_id: int, name: str) -> AgentNameFormType:
    existing = AgentNameFormType.query.filter(
        AgentNameFormType.institution_id == institution_id,
        sa.func.lower(AgentNameFormType.name) == name.lower(),
    ).first()
    if existing:
        return existing
    nft = AgentNameFormType(institution_id=institution_id, name=name[:100])
    db.session.add(nft)
    db.session.flush()
    return nft


def _attach_name_forms(agent: Agent, type_name: str, names: list, user_id: Optional[int]) -> None:
    existing = {
        n.strip().lower()
        for n in db.session.execute(
            sa.select(AgentNameForm.name).where(AgentNameForm.agent_id == agent.id)
        ).scalars().all()
        if n
    }
    existing.add((agent.name or '').strip().lower())

    nft = None
    for raw in names[:MAX_NAME_FORMS]:
        name = to_text(raw)
        if not name or name.lower() in existing:
            continue
        if nft is None:
            nft = _name_form_type(agent.institution_id, type_name)
        existing.add(name.lower())
        db.session.add(AgentNameForm(
            agent_id=agent.id,
            type_id=nft.id,
            name=name[:500],
            created_by_id=user_id,
        ))


def finalize_agent_imports(agent: Agent, imports: Any, user_id: Optional[int], lang: str) -> None:
    if not isinstance(imports, list) or not imports:
        return

    spec = dict(agent.metadata_spec or {})
    provenance = [p for p in (spec.get(PROVENANCE_KEY) or []) if isinstance(p, dict)]
    changed = False
    now = datetime.now(timezone.utc).isoformat(timespec='seconds')

    for item in imports[:MAX_IMPORTS_PER_SAVE]:
        if not isinstance(item, dict):
            continue
        payload = read_agent_import_token(item.get('token'))
        if not payload or payload.get('inst') != agent.institution_id:
            add_warning(msg('import_invalid', lang))
            continue

        note = msg('imported_from', lang, source=payload.get('n') or payload.get('p') or '')

        accepted_identifiers = {str(s).strip().lower() for s in item.get('identifiers') or [] if str(s).strip()}
        for ident in payload.get('ids') or []:
            scheme_name = str(ident.get('scheme') or '').strip()
            value = to_text(ident.get('value'))
            if scheme_name and value and scheme_name.lower() in accepted_identifiers:
                _attach_agent_identifier(agent, scheme_name, value, user_id, note, lang)

        accepted_name_forms = {str(s).strip().lower() for s in item.get('name_forms') or [] if str(s).strip()}
        for name_form in payload.get('nfs') or []:
            type_name = str(name_form.get('type') or '').strip()
            if type_name and type_name.lower() in accepted_name_forms:
                _attach_name_forms(agent, type_name, name_form.get('names') or [], user_id)

        provenance = [p for p in provenance if p.get('integration_id') != payload.get('i')]
        provenance.append({
            'integration_id': payload.get('i'),
            'integration_name': payload.get('n'),
            'plugin': payload.get('p'),
            'external_id': payload.get('x'),
            'fetched_at': payload.get('t'),
            'imported_at': now,
            'imported_by_id': user_id,
        })
        changed = True

    if changed:
        spec[PROVENANCE_KEY] = provenance
        agent.metadata_spec = spec