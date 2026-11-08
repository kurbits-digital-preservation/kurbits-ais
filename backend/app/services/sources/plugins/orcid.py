from __future__ import annotations

import re
import urllib.parse
from typing import Any, Iterable, Optional

from ..base import ConfigField, FetchedRecord, SearchHit, SourceError, SourceKey, SourcePlugin
from ..registry import register

MAX_HITS = 20
_ORCID_RE = re.compile(r'(\d{4}-\d{4}-\d{4}-\d{3}[\dX])', re.IGNORECASE)

_PERSON = {'sv': 'Person', 'en': 'Person'}
_NAMES = {'sv': 'Namn', 'en': 'Names'}
_WORK = {'sv': 'Anställningar', 'en': 'Employment'}
_IDS = {'sv': 'Identifierare', 'en': 'Identifiers'}


def _k(key: str, sv: str, en: str, group: dict) -> SourceKey:
    return SourceKey(key, {'sv': sv, 'en': en}, group)


_SOURCE_KEYS = (
    _k('orcid',            'ORCID',                         'ORCID',                         _IDS),
    _k('orcid_url',        'ORCID-länk',                    'ORCID link',                    _IDS),
    _k('external_ids',     'Andra identifierare',           'Other identifiers',             _IDS),
    _k('display_name',     'Namn',                          'Name',                          _NAMES),
    _k('inverted_name',    'Namn, efternamn först',         'Name, family name first',       _NAMES),
    _k('given_names',      'Förnamn',                       'Given names',                   _NAMES),
    _k('family_name',      'Efternamn',                     'Family name',                   _NAMES),
    _k('credit_name',      'Publiceringsnamn',              'Published name',                _NAMES),
    _k('other_names',      'Andra namn',                    'Other names',                   _NAMES),
    _k('biography',        'Biografi',                      'Biography',                     _PERSON),
    _k('keywords',         'Nyckelord',                     'Keywords',                      _PERSON),
    _k('countries',        'Länder',                        'Countries',                     _PERSON),
    _k('website',          'Webbplats',                     'Website',                       _PERSON),
    _k('researcher_urls',  'Länkar',                        'Links',                         _PERSON),
    _k('employments',      'Anställningar',                 'Employments',                   _WORK),
    _k('current_employer', 'Nuvarande arbetsgivare',        'Current employer',              _WORK),
)


# ─── Helpers ──────────────────────────────────────────────────────────

def normalize_orcid(text: Any) -> Optional[str]:
    match = _ORCID_RE.search(str(text or ''))
    return match.group(1).upper() if match else None


def _str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _v(obj: Any) -> Optional[str]:
    return _str(obj.get('value')) if isinstance(obj, dict) else _str(obj)


def _lines(items: Iterable[Optional[str]]) -> Optional[str]:
    return '\n'.join(i for i in items if i) or None


def _unique(items: Iterable[Optional[str]]) -> list[str]:
    return list(dict.fromkeys(i for i in items if i))


def _dicts(value: Any) -> list[dict]:
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []


def _section(obj: Any, outer: str, inner: str) -> list[dict]:
    container = obj.get(outer) if isinstance(obj, dict) else None
    return _dicts(container.get(inner)) if isinstance(container, dict) else []


def _orcid_date(value: Any) -> Optional[str]:
    if not isinstance(value, dict):
        return None
    year = _v(value.get('year'))
    if not year:
        return None
    parts = [year, _v(value.get('month')), _v(value.get('day'))]
    return '-'.join(p for p in parts if p)


def _employment_line(summary: dict) -> Optional[str]:
    org = summary.get('organization') if isinstance(summary.get('organization'), dict) else {}
    parts = [_str(org.get('name')), _str(summary.get('department-name')), _str(summary.get('role-title'))]
    text = ', '.join(p for p in parts if p)
    if not text:
        return None
    start = (_orcid_date(summary.get('start-date')) or '')[:4]
    end = (_orcid_date(summary.get('end-date')) or '')[:4]
    if start or end:
        text += f' ({start or "?"}–{end})'
    return text


# ─── Plugin ───────────────────────────────────────────────────────────

@register
class OrcidPlugin(SourcePlugin):
    key = 'orcid'
    version = '1.0'
    label = 'ORCID'
    description = {
        'sv': 'Personuppgifter från forskares ORCID-profiler: namn, biografi, länkar och anställningar. Publikt API, nyckel valfri.',
        'en': 'Person data from researchers’ ORCID profiles: names, biography, links and employments. Public API, key optional.',
    }
    search_hint = {'sv': 'Namn eller ORCID-id', 'en': 'Name or ORCID iD'}
    supports = frozenset({'agent'})
    agent_types = frozenset({'person'})
    config_schema = (
        ConfigField(
            'base_url', {'sv': 'Bas-URL', 'en': 'Base URL'},
            type='url', default='https://pub.orcid.org/v3.0',
        ),
        ConfigField(
            'token', {'sv': 'API-token', 'en': 'API token'}, secret=True,
            help={
                'sv': 'Valfritt. En token för ORCID:s publika API ger högre gränser för antal anrop.',
                'en': 'Optional. A token for the ORCID public API gives higher rate limits.',
            },
        ),
    )
    suggested_agent_mappings = {
        'person': (
            {'target': 'agent.name',            'sources': ['display_name']},
            {'target': 'agent.authorized_form', 'sources': ['inverted_name']},
            {'target': 'agent.description',     'sources': ['biography']},
            {'target': 'agent.website',         'sources': ['website']},
            {'target': 'identifier',            'sources': ['orcid'], 'scheme': 'ORCID'},
            {'target': 'name_form',             'sources': ['other_names', 'credit_name'], 'name_form_type': 'Alternativt namn'},
        ),
    }

    def request_headers(self) -> dict:
        headers = {'Accept': 'application/json'}
        if self.config.get('token'):
            headers['Authorization'] = f'Bearer {self.config["token"]}'
        return headers

    def source_keys(self) -> list[SourceKey]:
        return list(_SOURCE_KEYS)

    def search(self, query: str) -> list[SearchHit]:
        q = (query or '').strip()
        if len(q) < 2:
            return []

        orcid = normalize_orcid(q)
        if orcid:
            person = self._get_person(orcid)
            if person is None:
                return []
            record = self._to_record(orcid, person, [])
            return [SearchHit(orcid, record.label, record.values.get('current_employer'))]

        params = {'q': q, 'rows': MAX_HITS}
        data = self.get_json(f'{self.url("expanded-search/")}?{urllib.parse.urlencode(params)}')
        items = _dicts(data.get('expanded-result')) if isinstance(data, dict) else []

        hits: list[SearchHit] = []
        for item in items[:MAX_HITS]:
            orcid = normalize_orcid(item.get('orcid-id'))
            if not orcid:
                continue
            given = _str(item.get('given-names'))
            family = _str(item.get('family-names'))
            name = _str(item.get('credit-name')) or ' '.join(p for p in (given, family) if p) or orcid
            institutions = _unique(_str(i) for i in item.get('institution-name') or [])
            hits.append(SearchHit(orcid, name, ', '.join(institutions[:2]) or None))
        return hits

    def fetch(self, external_id: str) -> FetchedRecord:
        orcid = normalize_orcid(external_id)
        person = self._get_person(orcid) if orcid else None
        if person is None:
            raise SourceError(f'ORCID {external_id} not found', 404)
        try:
            employments = self._get_employments(orcid)
        except SourceError:
            employments = []
        return self._to_record(orcid, person, employments)

    # ─── Internals ────────────────────────────────────────────────────

    def _get_person(self, orcid: str) -> Optional[dict]:
        data = self.get_json(self.url(f'{orcid}/person'), allow_missing=True)
        return data if isinstance(data, dict) else None

    def _get_employments(self, orcid: str) -> list[dict]:
        data = self.get_json(self.url(f'{orcid}/employments'), allow_missing=True)
        summaries: list[dict] = []
        for group in _dicts((data or {}).get('affiliation-group')):
            for summary in _dicts(group.get('summaries')):
                employment = summary.get('employment-summary')
                if isinstance(employment, dict):
                    summaries.append(employment)
        return summaries

    def _to_record(self, orcid: str, person: dict, employments: list[dict]) -> FetchedRecord:
        name = person.get('name') if isinstance(person.get('name'), dict) else {}
        given = _v(name.get('given-names'))
        family = _v(name.get('family-name'))
        credit = _v(name.get('credit-name'))
        display = ' '.join(p for p in (given, family) if p) or credit
        inverted = ', '.join(p for p in (family, given) if p) or None

        other_names = _unique(_str(o.get('content')) for o in _section(person, 'other-names', 'other-name'))
        urls = _section(person, 'researcher-urls', 'researcher-url')
        url_values = _unique(_v(u.get('url')) for u in urls)
        biography = person.get('biography') if isinstance(person.get('biography'), dict) else {}
        keywords = _unique(_str(k.get('content')) for k in _section(person, 'keywords', 'keyword'))
        countries = _unique(_v(a.get('country')) for a in _section(person, 'addresses', 'address'))
        external = _section(person, 'external-identifiers', 'external-identifier')

        current = [e for e in employments if not e.get('end-date')]
        current_org = None
        if current:
            org = current[0].get('organization') if isinstance(current[0].get('organization'), dict) else {}
            current_org = _str(org.get('name'))

        values = {
            'orcid':            orcid,
            'orcid_url':        f'https://orcid.org/{orcid}',
            'external_ids':     _lines(
                f'{_str(e.get("external-id-type"))}: {_str(e.get("external-id-value"))}'
                for e in external if _str(e.get('external-id-value'))
            ),
            'display_name':     display,
            'inverted_name':    inverted,
            'given_names':      given,
            'family_name':      family,
            'credit_name':      credit if credit and credit != display else None,
            'other_names':      _lines(other_names),
            'biography':        _str(biography.get('content')),
            'keywords':         _lines(keywords),
            'countries':        ', '.join(countries) or None,
            'website':          url_values[0] if url_values else None,
            'researcher_urls':  _lines(
                f'{_str(u.get("url-name"))}: {_v(u.get("url"))}' if _str(u.get('url-name')) else _v(u.get('url'))
                for u in urls
            ),
            'employments':      _lines(_employment_line(e) for e in employments),
            'current_employer': current_org,
        }
        values = {k: v for k, v in values.items() if v is not None}
        return FetchedRecord(
            external_id=orcid,
            label=display or orcid,
            values=values,
            source_url=values['orcid_url'],
        )