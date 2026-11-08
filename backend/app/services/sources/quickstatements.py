from __future__ import annotations

import re
from datetime import date
from typing import Iterable, Optional

import sqlalchemy as sa

from app.extensions import db
from app.models.agent import Agent, agent_node_association
from app.models.integration import ExternalIntegration
from .base import localize

TYPE_ITEMS = {
    'person': 'Q5',
    'organization': 'Q43229',
    'family': 'Q8436',
    'software': 'Q7397',
}
DATE_PROPS = {
    'person': ('P569', 'P570'),
    'organization': ('P571', 'P576'),
    'software': ('P571', None),
    'family': (None, None),
}
IDENTIFIER_PROPS = {
    'viaf': 'P214',
    'isni': 'P213',
    'orcid': 'P496',
    'ror': 'P6782',
    'libris': 'P906',
    'gnd': 'P227',
    'lc': 'P244',
    'library of congress': 'P244',
}
WIKIDATA_SCHEME = 'wikidata'
P_INSTANCE_OF = 'P31'
P_WEBSITE = 'P856'
P_ARCHIVES_AT = 'P485'
S_REFERENCE_URL = 'S854'
S_RETRIEVED = 'S813'
MAX_AGENTS = 200

_QID_RE = re.compile(r'(Q\d+)$', re.IGNORECASE)
_DATE_RE = re.compile(r'^(-?)(\d{1,4})(?:-(\d{2}))?(?:-(\d{2}))?$')

MESSAGES = {
    'no_qid':        {'sv': 'Saknar Wikidata-id och skapas inte, eftersom nya objekt inte är valda.',
                      'en': 'Has no Wikidata ID and is not created, since new items are not selected.'},
    'creates_item':  {'sv': 'Skapar ett nytt objekt. Sök först i Wikidata så att det inte redan finns.',
                      'en': 'Creates a new item. Search Wikidata first so that it does not already exist.'},
    'bad_date':      {'sv': 'Datumet "{value}" kan inte tolkas och exporteras inte.',
                      'en': 'The date "{value}" cannot be read and is not exported.'},
    'no_reference':  {'sv': 'Ingen länkmall för portalen är inställd, så påståendena får ingen källhänvisning.',
                      'en': 'No portal URL template is set, so the statements get no reference.'},
    'nothing':       {'sv': 'Inget att exportera.', 'en': 'Nothing to export.'},
}


def _msg(key: str, lang: str, **kwargs) -> str:
    return localize(MESSAGES[key], lang).format(**kwargs)


# ─── Value formatting ─────────────────────────────────────────────────

def _string(text: str) -> str:
    clean = ' '.join(str(text).replace('"', "'").split())
    return f'"{clean}"'


def _time(text: Optional[str]) -> Optional[str]:
    match = _DATE_RE.match((text or '').strip())
    if not match:
        return None
    sign, year, month, day = match.groups()
    prefix = '-' if sign else '+'
    year = year.zfill(4)
    if month and day:
        return f'{prefix}{year}-{month}-{day}T00:00:00Z/11'
    if month:
        return f'{prefix}{year}-{month}-00T00:00:00Z/10'
    return f'{prefix}{year}-00-00T00:00:00Z/9'


def _qid(value: Optional[str]) -> Optional[str]:
    match = _QID_RE.search((value or '').strip())
    return match.group(1).upper() if match else None


def _identifier_value(prop: str, value: str) -> Optional[str]:
    value = (value or '').strip()
    if not value:
        return None
    if prop == 'P213':
        compact = re.sub(r'[^0-9Xx]', '', value).upper()
        if len(compact) == 16:
            value = ' '.join(compact[i:i + 4] for i in range(0, 16, 4))
    if prop == 'P6782':
        value = value.rstrip('/').rsplit('/', 1)[-1]
    if prop == 'P496':
        match = re.search(r'(\d{4}-\d{4}-\d{4}-\d{3}[\dX])', value, re.IGNORECASE)
        value = match.group(1).upper() if match else value
    return _string(value)


# ─── Settings and lookups ─────────────────────────────────────────────

def wikidata_settings(institution_id: int) -> dict:
    integration = db.session.execute(
        sa.select(ExternalIntegration)
        .where(
            ExternalIntegration.institution_id == institution_id,
            ExternalIntegration.entity_type == 'source',
            ExternalIntegration.plugin == 'wikidata',
            ExternalIntegration.is_active.is_(True),
        )
        .order_by(ExternalIntegration.id)
    ).scalars().first()
    config = (integration.config or {}) if integration else {}
    return {
        'language': (str(config.get('language') or 'sv').strip().lower() or 'sv')[:10],
        'institution_qid': _qid(config.get('institution_qid')),
        'agent_url_template': (str(config.get('agent_url_template') or '').strip() or None),
    }


def _creator_agent_ids(agent_ids: list[int]) -> set[int]:
    from app.api.v1.nodes.serializers import CREATOR_RELATION_TYPES
    creator_types = {str(t).strip().lower() for t in CREATOR_RELATION_TYPES}
    rows = db.session.execute(
        sa.select(agent_node_association.c.agent_id, agent_node_association.c.relation_type)
        .where(agent_node_association.c.agent_id.in_(agent_ids))
    ).all()
    return {row.agent_id for row in rows if (row.relation_type or '').strip().lower() in creator_types}


def _wikidata_qid(agent: Agent) -> Optional[str]:
    for ident in agent.identifiers:
        if ident.scheme and (ident.scheme.name or '').strip().lower() == WIKIDATA_SCHEME:
            qid = _qid(ident.value)
            if qid:
                return qid
    return None


# ─── Commands per agent ───────────────────────────────────────────────

def _agent_commands(agent: Agent, settings: dict, options: dict, is_creator: bool,
                    today: str, lang: str) -> dict:
    agent_type = agent.agent_type.value
    qid = _wikidata_qid(agent)
    warnings: list[str] = []
    lines: list[str] = []

    if not qid and not options['create_missing']:
        return {'action': 'skip', 'qid': None, 'lines': [], 'warnings': [_msg('no_qid', lang)]}

    subject = qid or 'LAST'
    label_lang = settings['language']

    reference: list[str] = []
    if settings['agent_url_template']:
        url = settings['agent_url_template'].replace('{id}', str(agent.id))
        reference = [S_REFERENCE_URL, _string(url), S_RETRIEVED, today]

    def statement(prop: str, value: str, referenced: bool = False) -> None:
        parts = [subject, prop, value]
        if referenced:
            parts += reference
        lines.append('\t'.join(parts))

    if not qid:
        lines.append('CREATE')
        lines.append('\t'.join([subject, f'L{label_lang}', _string(agent.name)]))
        type_item = TYPE_ITEMS.get(agent_type)
        if type_item:
            statement(P_INSTANCE_OF, type_item)
        warnings.append(_msg('creates_item', lang))

    start_prop, end_prop = DATE_PROPS.get(agent_type, (None, None))
    for prop, raw in ((start_prop, agent.date_from), (end_prop, agent.date_to)):
        if not prop or not (raw or '').strip():
            continue
        value = _time(raw)
        if value:
            statement(prop, value, referenced=True)
        else:
            warnings.append(_msg('bad_date', lang, value=raw))

    if (agent.website or '').strip():
        statement(P_WEBSITE, _string(agent.website.strip()))

    for ident in agent.identifiers:
        scheme = (ident.scheme.name if ident.scheme else '').strip().lower()
        prop = IDENTIFIER_PROPS.get(scheme)
        value = _identifier_value(prop, ident.value) if prop else None
        if value:
            statement(prop, value)

    if options['include_archives_at'] and is_creator and settings['institution_qid']:
        statement(P_ARCHIVES_AT, settings['institution_qid'], referenced=True)

    if options['include_aliases']:
        for name_form in agent.name_forms:
            if (name_form.name or '').strip() and name_form.name.strip() != agent.name:
                lines.append('\t'.join([subject, f'A{label_lang}', _string(name_form.name)]))

    has_content = any(line != 'CREATE' for line in lines)
    if not has_content:
        return {'action': 'skip', 'qid': qid, 'lines': [], 'warnings': warnings + [_msg('nothing', lang)]}

    referenced_lines = any(S_REFERENCE_URL in line for line in lines)
    if not reference and (start_prop or is_creator):
        if not referenced_lines:
            warnings.append(_msg('no_reference', lang))

    return {
        'action': 'update' if qid else 'create',
        'qid': qid,
        'lines': lines,
        'warnings': warnings,
    }


def build_quickstatements(agents: Iterable[Agent], institution_id: int, options: dict, lang: str) -> dict:
    agents = list(agents)[:MAX_AGENTS]
    settings = wikidata_settings(institution_id)
    creators = _creator_agent_ids([a.id for a in agents]) if agents else set()
    today = f'+{date.today().isoformat()}T00:00:00Z/11'

    commands: list[str] = []
    summary: list[dict] = []
    for agent in agents:
        result = _agent_commands(agent, settings, options, agent.id in creators, today, lang)
        commands.extend(result['lines'])
        summary.append({
            'id': agent.id,
            'name': agent.name,
            'qid': result['qid'],
            'action': result['action'],
            'statements': sum(1 for line in result['lines'] if line != 'CREATE'),
            'warnings': result['warnings'],
        })

    return {
        'commands': '\n'.join(commands),
        'agents': summary,
        'settings': {
            'has_institution_qid': bool(settings['institution_qid']),
            'has_reference_template': bool(settings['agent_url_template']),
            'language': settings['language'],
        },
    }