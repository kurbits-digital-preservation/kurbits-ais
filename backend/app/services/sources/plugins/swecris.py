from __future__ import annotations

import re
from typing import Any, Optional

from ..base import ConfigField, FetchedRecord, SearchHit, SourceError, SourceKey, SourcePlugin
from ..registry import register

PI_ROLE = 'principal investigator'
_DATE_RE = re.compile(r'^(\d{4}-\d{2}-\d{2})')

_PROJECT = {'sv': 'Projekt', 'en': 'Project'}
_ORGS = {'sv': 'Organisationer', 'en': 'Organisations'}
_FUNDING = {'sv': 'Finansiering', 'en': 'Funding'}
_PEOPLE = {'sv': 'Personer', 'en': 'People'}
_SUBJECTS = {'sv': 'Ämnen', 'en': 'Subjects'}


def _k(key: str, sv: str, en: str, group: dict) -> SourceKey:
    return SourceKey(key, {'sv': sv, 'en': en}, group)


_SOURCE_KEYS = (
    _k('project_id',             'Projekt-ID',                         'Project ID',                          _PROJECT),
    _k('title_sv',               'Titel (sv)',                         'Title (sv)',                          _PROJECT),
    _k('title_en',               'Titel (en)',                         'Title (en)',                          _PROJECT),
    _k('abstract_sv',            'Sammanfattning (sv)',                'Abstract (sv)',                       _PROJECT),
    _k('abstract_en',            'Sammanfattning (en)',                'Abstract (en)',                       _PROJECT),
    _k('start_date',             'Projektstart',                       'Project start',                       _PROJECT),
    _k('end_date',               'Projektslut',                        'Project end',                         _PROJECT),
    _k('coordinating_org_sv',    'Koordinerande organisation (sv)',    'Coordinating organisation (sv)',      _ORGS),
    _k('coordinating_org_en',    'Koordinerande organisation (en)',    'Coordinating organisation (en)',      _ORGS),
    _k('coordinating_org_id',    'Koordinerande organisation, org.nr', 'Coordinating organisation, org. no.', _ORGS),
    _k('funder_sv',              'Finansiär (sv)',                     'Funder (sv)',                         _FUNDING),
    _k('funder_en',              'Finansiär (en)',                     'Funder (en)',                         _FUNDING),
    _k('funder_id',              'Finansiär, org.nr',                  'Funder, org. no.',                    _FUNDING),
    _k('funding_sek',            'Beviljat belopp (SEK)',              'Amount granted (SEK)',                _FUNDING),
    _k('funding_year',           'Beslutsår',                          'Decision year',                       _FUNDING),
    _k('funding_start_date',     'Finansiering start',                 'Funding start',                       _FUNDING),
    _k('funding_end_date',       'Finansiering slut',                  'Funding end',                         _FUNDING),
    _k('award_type_sv',          'Bidragsform (sv)',                   'Award type (sv)',                     _FUNDING),
    _k('award_type_en',          'Bidragsform (en)',                   'Award type (en)',                     _FUNDING),
    _k('principal_investigator', 'Projektledare',                      'Principal investigator',              _PEOPLE),
    _k('people_sv',              'Personer med roll (sv)',             'People with role (sv)',               _PEOPLE),
    _k('people_en',              'Personer med roll (en)',             'People with role (en)',               _PEOPLE),
    _k('orcids',                 'ORCID-lista',                        'ORCID list',                          _PEOPLE),
    _k('scb_sv',                 'Forskningsämnen SCB (sv)',           'SCB research subjects (sv)',          _SUBJECTS),
    _k('scb_en',                 'Forskningsämnen SCB (en)',           'SCB research subjects (en)',          _SUBJECTS),
    _k('scb_codes',              'SCB-koder',                          'SCB codes',                           _SUBJECTS),
)


# ─── Helpers ──────────────────────────────────────────────────────────

def _str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _date(value: Any) -> Optional[str]:
    match = _DATE_RE.match(_str(value) or '')
    return match.group(1) if match else None


def _lines(items) -> Optional[str]:
    return '\n'.join(i for i in items if i) or None


def _role(person: dict) -> str:
    return (_str(person.get('roleEn')) or '').lower()


def _unique_people(people: list) -> list[dict]:
    seen: set[tuple[str, str]] = set()
    result: list[dict] = []
    for person in people:
        if not isinstance(person, dict):
            continue
        name = _str(person.get('fullName'))
        if not name:
            continue
        key = (_str(person.get('personId')) or name, _role(person))
        if key in seen:
            continue
        seen.add(key)
        result.append(person)
    result.sort(key=lambda p: _role(p) != PI_ROLE)
    return result


def _person_line(person: dict, role_key: Optional[str] = None) -> str:
    name = _str(person.get('fullName'))
    extras = []
    if role_key and _str(person.get(role_key)):
        extras.append(_str(person.get(role_key)))
    orcid = _str(person.get('orcId'))
    if orcid:
        extras.append(f'ORCID {orcid}')
    return f'{name} ({", ".join(extras)})' if extras else name


def _scb_line(scb: dict, lang: str) -> Optional[str]:
    code = _str(scb.get('scb5Id'))
    name = _str(scb.get(f'scb5Name{lang}'))
    if not code:
        return None
    return f'{code} {name}' if name else code


# ─── Plugin ───────────────────────────────────────────────────────────

@register
class SweCrisPlugin(SourcePlugin):
    key = 'swecris'
    version = '1.0'
    label = 'SweCRIS'
    description = {
        'sv': 'Forskningsprojekt från Vetenskapsrådets SweCRIS. Hämtas via projekt-ID.',
        'en': 'Research projects from the Swedish Research Council’s SweCRIS. Looked up by project ID.',
    }
    search_hint = {
        'sv': 'Projekt-ID, t.ex. 2021-00157_VR',
        'en': 'Project ID, e.g. 2021-00157_VR',
    }
    config_schema = (
        ConfigField(
            'base_url', {'sv': 'Bas-URL', 'en': 'Base URL'},
            type='url', default='https://swecris-api.vr.se/v1',
        ),
        ConfigField(
            'token', {'sv': 'API-token', 'en': 'API token'},
            required=True, secret=True,
            help={
                'sv': 'Vetenskapsrådet publicerar en publik token på vr.se. Den byts ut regelbundet.',
                'en': 'The Swedish Research Council publishes a public token on vr.se. It is rotated regularly.',
            },
        ),
    )
    suggested_mappings = (
        {'target': 'node.title',             'sources': ['title_sv', 'title_en']},
        {'target': 'node.date_start',        'sources': ['start_date']},
        {'target': 'node.date_end',          'sources': ['end_date']},
        {'target': 'node.scope_and_content', 'sources': ['abstract_sv', 'abstract_en']},
        {'target': 'identifier',             'sources': ['project_id'], 'scheme': 'SweCRIS'},
    )

    def request_headers(self) -> dict:
        return {'Authorization': f'Bearer {self.config.get("token") or ""}'}

    def source_keys(self) -> list[SourceKey]:
        return list(_SOURCE_KEYS)

    def search(self, query: str) -> list[SearchHit]:
        project_id = (query or '').strip()
        if len(project_id) < 3:
            return []
        raw = self._get_project(project_id)
        if raw is None:
            return []
        record = self._to_record(raw)
        values = record.values
        span = '–'.join(d[:4] for d in (values.get('start_date'), values.get('end_date')) if d)
        description = ' · '.join(
            p for p in (values.get('funder_sv'), values.get('coordinating_org_sv'), span) if p
        )
        return [SearchHit(record.external_id, record.label, description or None)]

    def fetch(self, external_id: str) -> FetchedRecord:
        project_id = (external_id or '').strip()
        raw = self._get_project(project_id) if project_id else None
        if raw is None:
            raise SourceError(f'Project {external_id} not found in SweCRIS', 404)
        return self._to_record(raw)

    def _get_project(self, project_id: str) -> Optional[dict]:
        data = self.get_json(self.url(f'projects/{self.quote(project_id)}'), allow_missing=True)
        if not isinstance(data, dict) or not data.get('projectId'):
            return None
        return data

    def _to_record(self, raw: dict) -> FetchedRecord:
        people = _unique_people(raw.get('peopleList') or [])
        pis = [p for p in people if _role(p) == PI_ROLE]
        scbs = [s for s in (raw.get('scbs') or []) if isinstance(s, dict)]
        orcids = list(dict.fromkeys(o for o in (_str(p.get('orcId')) for p in people) if o))
        funding = raw.get('fundingsSek')

        values = {
            'project_id':          _str(raw.get('projectId')),
            'title_sv':            _str(raw.get('projectTitleSv')),
            'title_en':            _str(raw.get('projectTitleEn')),
            'abstract_sv':         _str(raw.get('projectAbstractSv')),
            'abstract_en':         _str(raw.get('projectAbstractEn')),
            'start_date':          _date(raw.get('projectStartDate')),
            'end_date':            _date(raw.get('projectEndDate')),
            'coordinating_org_sv': _str(raw.get('coordinatingOrganisationNameSv')),
            'coordinating_org_en': _str(raw.get('coordinatingOrganisationNameEn')),
            'coordinating_org_id': _str(raw.get('coordinatingOrganisationId')),
            'funder_sv':           _str(raw.get('fundingOrganisationNameSv')),
            'funder_en':           _str(raw.get('fundingOrganisationNameEn')),
            'funder_id':           _str(raw.get('fundingOrganisationId')),
            'funding_sek':         funding if isinstance(funding, (int, float)) and not isinstance(funding, bool) else None,
            'funding_year':        _str(raw.get('fundingYear')),
            'funding_start_date':  _date(raw.get('fundingStartDate')),
            'funding_end_date':    _date(raw.get('fundingEndDate')),
            'award_type_sv':       _str(raw.get('typeOfAwardDescrSv')),
            'award_type_en':       _str(raw.get('typeOfAwardDescrEn')),
            'principal_investigator': _lines(_person_line(p) for p in pis),
            'people_sv':           _lines(_person_line(p, 'roleSv') for p in people),
            'people_en':           _lines(_person_line(p, 'roleEn') for p in people),
            'orcids':              ', '.join(orcids) or None,
            'scb_sv':              _lines(_scb_line(s, 'Sv') for s in scbs),
            'scb_en':              _lines(_scb_line(s, 'En') for s in scbs),
            'scb_codes':           ', '.join(c for c in (_str(s.get('scb5Id')) for s in scbs) if c) or None,
        }
        values = {k: v for k, v in values.items() if v is not None}

        project_id = values['project_id']
        label = values.get('title_sv') or values.get('title_en') or project_id
        return FetchedRecord(external_id=project_id, label=label, values=values)