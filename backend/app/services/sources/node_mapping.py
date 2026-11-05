from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional

import sqlalchemy as sa
from flask import current_app
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models.integration import ExternalIntegration
from app.models.node import IdentifierScheme, Node, NodeIdentifier
from app.request_feedback import add_warning
from .base import FetchedRecord, SourceError, SourcePlugin, is_empty, localize, to_text
from .registry import get_plugin_class, plugin_for

FILL_MODES = ('empty_only', 'overwrite')
IDENTIFIER_TARGET = 'identifier'
CORE_PREFIX = 'node.'
META_PREFIX = 'meta.'
PROVENANCE_KEY = '_record_sources'
IMPORT_TOKEN_SALT = 'source-import-v1'
IMPORT_TOKEN_MAX_AGE = 60 * 60 * 24
MAX_IMPORTS_PER_SAVE = 10
_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}')

CORE_TARGETS: dict[str, dict] = {
    'title':                   {'label': {'sv': 'Titel', 'en': 'Title'}, 'type': 'text', 'max_length': 500},
    'description':             {'label': {'sv': 'Beskrivning', 'en': 'Description'}, 'type': 'textarea'},
    'scope_and_content':       {'label': {'sv': 'Innehåll och omfattning', 'en': 'Scope and content'}, 'type': 'textarea'},
    'date_start':              {'label': {'sv': 'Startdatum', 'en': 'Start date'}, 'type': 'date'},
    'date_end':                {'label': {'sv': 'Slutdatum', 'en': 'End date'}, 'type': 'date'},
    'extent':                  {'label': {'sv': 'Omfång', 'en': 'Extent'}, 'type': 'text', 'max_length': 200},
    'arrangement':             {'label': {'sv': 'Ordning', 'en': 'Arrangement'}, 'type': 'textarea'},
    'access_conditions':       {'label': {'sv': 'Villkor för åtkomst', 'en': 'Access conditions'}, 'type': 'textarea'},
    'reproduction_conditions': {'label': {'sv': 'Villkor för reproduktion', 'en': 'Reproduction conditions'}, 'type': 'textarea'},
    'language':                {'label': {'sv': 'Språk', 'en': 'Language'}, 'type': 'text', 'max_length': 100},
    'finding_aids':            {'label': {'sv': 'Sökmedel', 'en': 'Finding aids'}, 'type': 'textarea'},
}

MESSAGES = {
    'conflict':            {'sv': 'Används redan av {ref}', 'en': 'Already used by {ref}'},
    'bad_date':            {'sv': 'Kunde inte tolka "{value}" som datum', 'en': 'Could not read "{value}" as a date'},
    'bad_number':          {'sv': 'Kunde inte tolka "{value}" som tal', 'en': 'Could not read "{value}" as a number'},
    'not_option':          {'sv': '"{value}" finns inte bland fältets alternativ', 'en': '"{value}" is not one of the field options'},
    'boolean':             {'sv': 'Ja/nej-fält fylls inte från källor', 'en': 'Yes/no fields are not filled from sources'},
    'truncated':           {'sv': 'Förkortad till {n} tecken', 'en': 'Truncated to {n} characters'},
    'import_invalid':      {'sv': 'En källimport kunde inte verifieras (för gammal eller ogiltig) och registrerades inte.',
                            'en': 'A source import could not be verified (expired or invalid) and was not recorded.'},
    'identifier_conflict': {'sv': '{scheme} {value} används redan av en annan post och lades inte till.',
                            'en': '{scheme} {value} is already used by another record and was not added.'},
    'imported_from':       {'sv': 'Importerad från {source}', 'en': 'Imported from {source}'},
}


def msg(key: str, lang: str, **kwargs) -> str:
    return localize(MESSAGES[key], lang).format(**kwargs)


# ─── Targets ──────────────────────────────────────────────────────────

def core_targets(lang: str) -> list[dict]:
    return [
        {
            'target': f'{CORE_PREFIX}{name}',
            'field': name,
            'label': localize(spec['label'], lang),
            'type': spec['type'],
        }
        for name, spec in CORE_TARGETS.items()
    ]


def target_spec(target: str, level_fields: list, lang: str) -> Optional[dict]:
    if target.startswith(CORE_PREFIX):
        name = target[len(CORE_PREFIX):]
        spec = CORE_TARGETS.get(name)
        if not spec:
            return None
        return {
            'kind': 'node', 'field': name, 'label': localize(spec['label'], lang),
            'type': spec['type'], 'max_length': spec.get('max_length'), 'options': [],
        }
    if target.startswith(META_PREFIX):
        name = target[len(META_PREFIX):]
        for f in level_fields or []:
            if isinstance(f, dict) and f.get('name') == name:
                return {
                    'kind': 'meta', 'field': name, 'label': f.get('label') or name,
                    'type': f.get('type') or 'text', 'max_length': None,
                    'options': f.get('options') or [],
                }
    return None


# ─── Level configuration ──────────────────────────────────────────────

def level_sources(level) -> list[dict]:
    schema = level.metadata_schema if isinstance(level.metadata_schema, dict) else {}
    sources = schema.get('record_sources')
    return sources if isinstance(sources, list) else []


def find_level_source(level, integration_id: int) -> Optional[dict]:
    for entry in level_sources(level):
        if isinstance(entry, dict) and entry.get('integration_id') == integration_id:
            return entry
    return None


def suggested_for_level(plugin_cls: type[SourcePlugin], level_fields: list) -> list[dict]:
    field_names = {f.get('name') for f in level_fields or [] if isinstance(f, dict)}
    result = []
    for mapping in plugin_cls.suggested_mappings:
        target = mapping.get('target', '')
        if target == IDENTIFIER_TARGET:
            result.append(dict(mapping))
        elif target.startswith(CORE_PREFIX) and target[len(CORE_PREFIX):] in CORE_TARGETS:
            result.append(dict(mapping))
        elif target.startswith(META_PREFIX) and target[len(META_PREFIX):] in field_names:
            result.append(dict(mapping))
    return result


def _known_source_keys(integration) -> Optional[set[str]]:
    try:
        return {k.key for k in plugin_for(integration).source_keys()}
    except SourceError:
        return None


def validate_level_sources(raw: Any, level_fields: list, institution_id: int) -> tuple[list, list[str]]:
    if raw in (None, ''):
        return [], []
    if not isinstance(raw, list):
        return [], ['record_sources must be a list']

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
        if plugin_cls is None or 'node' not in plugin_cls.supports:
            errors.append(f'{prefix}: plugin "{integration.plugin}" cannot describe records')
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
            else:
                if target_spec(target, level_fields, 'en') is None:
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


# ─── Coercion & display ───────────────────────────────────────────────

def _coerce(value: Any, spec: dict, lang: str) -> tuple[Any, Optional[str]]:
    ftype = spec['type']

    if ftype == 'date':
        text = to_text(value)
        match = _DATE_RE.match(text or '')
        if not match:
            return None, (msg('bad_date', lang, value=text) if text else None)
        return match.group(0), None

    if ftype == 'number':
        if isinstance(value, bool):
            return None, msg('bad_number', lang, value=value)
        if isinstance(value, (int, float)):
            return value, None
        text = (to_text(value) or '').replace('\u00a0', '').replace(' ', '').replace(',', '.')
        try:
            num = float(text)
        except ValueError:
            return None, msg('bad_number', lang, value=to_text(value))
        return (int(num) if num.is_integer() else num), None

    if ftype == 'boolean':
        return None, msg('boolean', lang)

    if ftype == 'multiselect':
        items = value if isinstance(value, list) else (to_text(value) or '').split('\n')
        vals = [t for t in (to_text(v) for v in items) if t]
        return (vals or None), None

    if ftype == 'integration':
        text = to_text(value)
        return ({'label': text} if text else None), None

    text = to_text(value)
    if ftype == 'select' and text and spec.get('options') and text not in spec['options']:
        return None, msg('not_option', lang, value=text)
    max_length = spec.get('max_length')
    if text and max_length and len(text) > max_length:
        return text[:max_length - 1].rstrip() + '…', msg('truncated', lang, n=max_length)
    return text, None


def _display(value: Any) -> str:
    if isinstance(value, list):
        return ', '.join(t for t in (to_text(v) for v in value) if t)
    return to_text(value) or ''


def _first_value(values: dict, sources: list[str]) -> tuple[Any, Optional[str]]:
    for key in sources:
        value = values.get(key)
        if not is_empty(value):
            return value, key
    return None, None


# ─── Import tokens ────────────────────────────────────────────────────

def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config['SECRET_KEY'], salt=IMPORT_TOKEN_SALT)


def make_import_token(payload: dict) -> str:
    return _serializer().dumps(payload)


def read_import_token(token: Any) -> Optional[dict]:
    if not isinstance(token, str) or not token:
        return None
    try:
        data = _serializer().loads(token, max_age=IMPORT_TOKEN_MAX_AGE)
    except BadSignature:
        return None
    return data if isinstance(data, dict) else None


# ─── Preview ──────────────────────────────────────────────────────────

def _identifier_row(scheme_name: str, raw_value: Any, source_key: Optional[str],
                    node_id: Optional[int], institution_id: int, lang: str) -> Optional[dict]:
    value = to_text(raw_value)
    if not value or not scheme_name:
        return None

    status = None
    message = None
    scheme = IdentifierScheme._find_by_name(institution_id, scheme_name)
    if scheme:
        existing = db.session.execute(
            sa.select(NodeIdentifier).where(
                NodeIdentifier.scheme_id == scheme.id,
                NodeIdentifier.value == value,
            )
        ).scalars().first()
        if existing:
            if node_id and existing.node_id == node_id:
                status = 'attached'
            else:
                other = db.session.get(Node, existing.node_id)
                status = 'conflict'
                message = msg('conflict', lang, ref=other.ref_code if other else existing.node_id)

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
        'selectable': selectable,
        'selected': selectable,
        'status': status,
        'message': message,
    }


def build_preview(entry: dict, record: FetchedRecord, integration, level_fields: list,
                  current_node: dict, current_meta: dict, node_id: Optional[int],
                  institution_id: int, lang: str) -> dict:
    fill_mode = entry.get('fill_mode') or 'empty_only'
    rows: list[dict] = []
    token_identifiers: list[dict] = []

    for mapping in entry.get('mappings') or []:
        target = mapping.get('target') or ''
        raw_value, used = _first_value(record.values, mapping.get('sources') or [])

        if target == IDENTIFIER_TARGET:
            row = _identifier_row(mapping.get('scheme'), raw_value, used, node_id, institution_id, lang)
            if row:
                rows.append(row)
                if row['selectable']:
                    token_identifiers.append({'scheme': row['scheme'], 'value': row['value']})
            continue

        spec = target_spec(target, level_fields, lang)
        if spec is None or raw_value is None:
            continue

        value, problem = _coerce(raw_value, spec, lang)
        current = (current_node if spec['kind'] == 'node' else current_meta).get(spec['field'])
        base = {
            'key': target,
            'kind': spec['kind'],
            'field': spec['field'],
            'label': spec['label'],
            'source_key': used,
            'current': _display(current),
            'scheme': None,
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

    token = make_import_token({
        'i': integration.id,
        'inst': institution_id,
        'n': integration.name,
        'p': integration.plugin,
        'x': record.external_id,
        't': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'ids': token_identifiers,
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


# ─── Finalize on node save ────────────────────────────────────────────

def _attach_identifier(node: Node, scheme_name: str, value: str,
                       user_id: Optional[int], note: Optional[str], lang: str) -> None:
    scheme = IdentifierScheme.get_or_create(node.institution_id, scheme_name)
    existing = db.session.execute(
        sa.select(NodeIdentifier).where(
            NodeIdentifier.scheme_id == scheme.id,
            NodeIdentifier.value == value,
        )
    ).scalars().first()
    if existing:
        if existing.node_id != node.id:
            add_warning(msg('identifier_conflict', lang, scheme=scheme_name, value=value))
        return

    try:
        with db.session.begin_nested():
            db.session.add(NodeIdentifier(
                node_id=node.id,
                scheme_id=scheme.id,
                value=value,
                is_primary=False,
                note=note[:300] if note else None,
                created_by_id=user_id,
            ))
    except IntegrityError:
        add_warning(msg('identifier_conflict', lang, scheme=scheme_name, value=value))


def finalize_imports(node: Node, imports: Any, user_id: Optional[int], lang: str) -> None:
    if not isinstance(imports, list) or not imports:
        return

    spec = dict(node.metadata_spec or {})
    provenance = [p for p in (spec.get(PROVENANCE_KEY) or []) if isinstance(p, dict)]
    changed = False
    now = datetime.now(timezone.utc).isoformat(timespec='seconds')

    for item in imports[:MAX_IMPORTS_PER_SAVE]:
        if not isinstance(item, dict):
            continue
        payload = read_import_token(item.get('token'))
        if not payload or payload.get('inst') != node.institution_id:
            add_warning(msg('import_invalid', lang))
            continue

        accepted = {str(s).strip().lower() for s in item.get('identifiers') or [] if str(s).strip()}
        note = msg('imported_from', lang, source=payload.get('n') or payload.get('p') or '')
        for ident in payload.get('ids') or []:
            scheme_name = str(ident.get('scheme') or '').strip()
            value = to_text(ident.get('value'))
            if scheme_name and value and scheme_name.lower() in accepted:
                _attach_identifier(node, scheme_name, value, user_id, note, lang)

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
        node.metadata_spec = spec