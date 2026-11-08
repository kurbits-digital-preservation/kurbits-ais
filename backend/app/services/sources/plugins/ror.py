from __future__ import annotations

import re
import urllib.parse
from typing import Any, Iterable, Optional

from ..base import ConfigField, FetchedRecord, SearchHit, SourceError, SourceKey, SourcePlugin
from ..registry import register

MAX_HITS = 20
_ROR_ID_RE = re.compile(r'(?:https?://)?(?:ror\.org/)?(0[a-z0-9]{6}[0-9]{2})/?$', re.IGNORECASE)

_ORG = {'sv': 'Organisation', 'en': 'Organisation'}
_NAMES = {'sv': 'Namn', 'en': 'Names'}
_PLACE = {'sv': 'Plats', 'en': 'Location'}
_IDS = {'sv': 'Identifierare', 'en': 'Identifiers'}


def _k(key: str, sv: str, en: str, group: dict) -> SourceKey:
    return SourceKey(key, {'sv': sv, 'en': en}, group)


_SOURCE_KEYS = (
    _k('ror_id',        'ROR-id',                        'ROR ID',                        _IDS),
    _k('ror_url',       'ROR-länk',                      'ROR link',                      _IDS),
    _k('isni',          'ISNI',                          'ISNI',                          _IDS),
    _k('wikidata',      'Wikidata-id',                   'Wikidata ID',                   _IDS),
    _k('fundref',       'Crossref Funder ID',            'Crossref Funder ID',            _IDS),
    _k('grid',          'GRID',                          'GRID',                          _IDS),
    _k('display_name',  'Namn (ROR:s visningsnamn)',     'Name (ROR display name)',       _NAMES),
    _k('name_sv',       'Namn (sv)',                     'Name (sv)',                     _NAMES),
    _k('name_en',       'Namn (en)',                     'Name (en)',                     _NAMES),
    _k('labels',        'Namn på andra språk',           'Names in other languages',      _NAMES),
    _k('aliases',       'Alternativa namn',              'Aliases',                       _NAMES),
    _k('acronyms',      'Akronymer',                     'Acronyms',                      _NAMES),
    _k('established',   'Grundad',                       'Established',                   _ORG),
    _k('status',        'Status',                        'Status',                        _ORG),
    _k('types',         'Organisationstyp',              'Organisation type',             _ORG),
    _k('website',       'Webbplats',                     'Website',                       _ORG),
    _k('wikipedia',     'Wikipedia',                     'Wikipedia',                     _ORG),
    _k('domains',       'Domäner',                       'Domains',                       _ORG),
    _k('relationships', 'Relaterade organisationer',     'Related organisations',         _ORG),
    _k('city',          'Ort',                           'City',                          _PLACE),
    _k('country',       'Land',                          'Country',                       _PLACE),
    _k('country_code',  'Landskod',                      'Country code',                  _PLACE),
)


# ─── Helpers ──────────────────────────────────────────────────────────

def normalize_ror_id(text: Any) -> Optional[str]:
    match = _ROR_ID_RE.search(str(text or '').strip())
    return match.group(1).lower() if match else None


def _str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _lines(items: Iterable[Optional[str]]) -> Optional[str]:
    return '\n'.join(i for i in items if i) or None


def _unique(items: Iterable[Optional[str]]) -> list[str]:
    return list(dict.fromkeys(i for i in items if i))


def _dicts(value: Any) -> list[dict]:
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []


def _names_of(org: dict, name_type: str) -> list[dict]:
    return [n for n in _dicts(org.get('names')) if name_type in (n.get('types') or [])]


def _display_name(org: dict) -> Optional[str]:
    display = _names_of(org, 'ror_display')
    if display:
        return _str(display[0].get('value'))
    names = _dicts(org.get('names'))
    return _str(names[0].get('value')) if names else None


def _name_in(org: dict, lang: str) -> Optional[str]:
    for n in _dicts(org.get('names')):
        types = n.get('types') or []
        if (_str(n.get('lang')) or '').lower() == lang and ('label' in types or 'ror_display' in types):
            return _str(n.get('value'))
    return None


def _external_id(org: dict, id_type: str) -> Optional[str]:
    for ext in _dicts(org.get('external_ids')):
        if (_str(ext.get('type')) or '').lower() == id_type:
            values = ext.get('all') or []
            return _str(ext.get('preferred')) or (_str(values[0]) if values else None)
    return None


def _link(org: dict, link_type: str) -> Optional[str]:
    for link in _dicts(org.get('links')):
        if (_str(link.get('type')) or '').lower() == link_type:
            return _str(link.get('value'))
    return None


def _location(org: dict) -> dict:
    locations = _dicts(org.get('locations'))
    details = locations[0].get('geonames_details') if locations else None
    return details if isinstance(details, dict) else {}


# ─── Plugin ───────────────────────────────────────────────────────────

@register
class RorPlugin(SourcePlugin):
    key = 'ror'
    version = '1.0'
    label = 'ROR'
    description = {
        'sv': 'Research Organization Registry: forskningsorganisationer, lärosäten och finansiärer med namn på flera språk, grundandeår och identifierare. Öppet API utan nyckel.',
        'en': 'Research Organization Registry: research organisations, universities and funders with multilingual names, founding year and identifiers. Open API, no key required.',
    }
    search_hint = {'sv': 'Organisationens namn eller ROR-id', 'en': 'Organisation name or ROR ID'}
    supports = frozenset({'agent'})
    agent_types = frozenset({'organization'})
    config_schema = (
        ConfigField(
            'base_url', {'sv': 'Bas-URL', 'en': 'Base URL'},
            type='url', default='https://api.ror.org/v2',
        ),
        ConfigField(
            'client_id', {'sv': 'Klient-ID', 'en': 'Client ID'}, secret=True,
            help={
                'sv': 'Valfritt. ROR:s klient-ID om ni har registrerat ett, för högre gränser för antal anrop.',
                'en': 'Optional. ROR client ID if you have registered one, for higher rate limits.',
            },
        ),
    )
    suggested_agent_mappings = {
        'organization': (
            {'target': 'agent.name',      'sources': ['name_sv', 'display_name']},
            {'target': 'agent.date_from', 'sources': ['established']},
            {'target': 'agent.website',   'sources': ['website']},
            {'target': 'identifier',      'sources': ['ror_id'], 'scheme': 'ROR'},
            {'target': 'identifier',      'sources': ['isni'], 'scheme': 'ISNI'},
            {'target': 'name_form',       'sources': ['labels', 'name_en'], 'name_form_type': 'Namn på annat språk'},
            {'target': 'name_form',       'sources': ['aliases'], 'name_form_type': 'Alternativt namn'},
            {'target': 'name_form',       'sources': ['acronyms'], 'name_form_type': 'Akronym'},
        ),
    }

    def request_headers(self) -> dict:
        return {'Client-Id': str(self.config['client_id'])} if self.config.get('client_id') else {}

    def source_keys(self) -> list[SourceKey]:
        return list(_SOURCE_KEYS)

    def search(self, query: str) -> list[SearchHit]:
        q = (query or '').strip()
        if len(q) < 2:
            return []

        ror_id = normalize_ror_id(q)
        if ror_id:
            org = self._get_org(ror_id)
            return [self._hit(org)] if org else []

        data = self.get_json(f'{self.url("organizations")}?{urllib.parse.urlencode({"query": q})}')
        items = _dicts(data.get('items')) if isinstance(data, dict) else []
        return [self._hit(item) for item in items[:MAX_HITS] if normalize_ror_id(item.get('id'))]

    def fetch(self, external_id: str) -> FetchedRecord:
        ror_id = normalize_ror_id(external_id)
        org = self._get_org(ror_id) if ror_id else None
        if org is None:
            raise SourceError(f'ROR ID {external_id} not found', 404)
        return self._to_record(org)

    # ─── Internals ────────────────────────────────────────────────────

    def _get_org(self, ror_id: str) -> Optional[dict]:
        data = self.get_json(self.url(f'organizations/{ror_id}'), allow_missing=True)
        return data if isinstance(data, dict) and data.get('id') else None

    def _hit(self, org: dict) -> SearchHit:
        loc = _location(org)
        place = ', '.join(p for p in (_str(loc.get('name')), _str(loc.get('country_name'))) if p)
        types = ', '.join(_unique(_str(t) for t in org.get('types') or []))
        description = ' · '.join(p for p in (place, types) if p)
        ror_id = normalize_ror_id(org.get('id')) or ''
        return SearchHit(ror_id, _display_name(org) or ror_id, description or None)

    def _to_record(self, org: dict) -> FetchedRecord:
        ror_id = normalize_ror_id(org.get('id'))
        display = _display_name(org)
        loc = _location(org)

        labels = [
            f'{_str(n.get("value"))} ({_str(n.get("lang"))})' if _str(n.get('lang')) else _str(n.get('value'))
            for n in _names_of(org, 'label')
            if _str(n.get('value')) and _str(n.get('value')) != display
        ]
        established = org.get('established')

        values = {
            'ror_id':        ror_id,
            'ror_url':       f'https://ror.org/{ror_id}' if ror_id else None,
            'isni':          _external_id(org, 'isni'),
            'wikidata':      _external_id(org, 'wikidata'),
            'fundref':       _external_id(org, 'fundref'),
            'grid':          _external_id(org, 'grid'),
            'display_name':  display,
            'name_sv':       _name_in(org, 'sv'),
            'name_en':       _name_in(org, 'en'),
            'labels':        _lines(_unique(labels)),
            'aliases':       _lines(_unique(_str(n.get('value')) for n in _names_of(org, 'alias'))),
            'acronyms':      _lines(_unique(_str(n.get('value')) for n in _names_of(org, 'acronym'))),
            'established':   str(established) if isinstance(established, int) else _str(established),
            'status':        _str(org.get('status')),
            'types':         ', '.join(_unique(_str(t) for t in org.get('types') or [])) or None,
            'website':       _link(org, 'website'),
            'wikipedia':     _link(org, 'wikipedia'),
            'domains':       ', '.join(_unique(_str(d) for d in org.get('domains') or [])) or None,
            'relationships': _lines(
                f'{_str(r.get("type"))}: {_str(r.get("label"))}'
                for r in _dicts(org.get('relationships')) if _str(r.get('label'))
            ),
            'city':          _str(loc.get('name')),
            'country':       _str(loc.get('country_name')),
            'country_code':  _str(loc.get('country_code')),
        }
        values = {k: v for k, v in values.items() if v is not None}
        return FetchedRecord(
            external_id=ror_id,
            label=values.get('name_sv') or display or ror_id,
            values=values,
            source_url=values.get('ror_url'),
        )