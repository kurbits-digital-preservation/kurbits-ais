from __future__ import annotations

import re
import urllib.parse
from typing import Any, Iterable, Optional

from ..base import ConfigField, FetchedRecord, SearchHit, SourceError, SourceKey, SourcePlugin
from ..registry import register

MAX_HITS = 20
_FULL_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_OPENAIRE_ID_RE = re.compile(r'^[\w.-]+::[\w.:-]+$')
_GRANT_CODE_RE = re.compile(r'^\d{4,}$')
_EXPLORE_URL = 'https://explore.openaire.eu/search/project?projectId={id}'

_PROJECT = {'sv': 'Projekt', 'en': 'Project'}
_DATES = {'sv': 'Datum', 'en': 'Dates'}
_CONTENT = {'sv': 'Innehåll', 'en': 'Content'}
_FUNDING = {'sv': 'Finansiering', 'en': 'Funding'}
_POLICY = {'sv': 'Öppen tillgång', 'en': 'Open access'}


def _k(key: str, sv: str, en: str, group: dict) -> SourceKey:
    return SourceKey(key, {'sv': sv, 'en': en}, group)


_SOURCE_KEYS = (
    _k('openaire_id',          'OpenAIRE-id',                         'OpenAIRE ID',                       _PROJECT),
    _k('openaire_url',         'Länk till OpenAIRE',                  'OpenAIRE link',                     _PROJECT),
    _k('code',                 'Bidragsnummer',                       'Grant code',                        _PROJECT),
    _k('acronym',              'Akronym',                             'Acronym',                           _PROJECT),
    _k('title',                'Titel',                               'Title',                             _PROJECT),
    _k('call_identifier',      'Utlysning',                           'Call identifier',                   _PROJECT),
    _k('website_url',          'Webbplats',                           'Website',                           _PROJECT),
    _k('start_date',           'Projektstart',                        'Project start',                     _DATES),
    _k('end_date',             'Projektslut',                         'Project end',                       _DATES),
    _k('summary',              'Sammanfattning',                      'Summary',                           _CONTENT),
    _k('keywords',             'Nyckelord',                           'Keywords',                          _CONTENT),
    _k('subjects',             'Ämnen',                               'Subjects',                          _CONTENT),
    _k('funding',              'Finansiering (sammanställd)',         'Funding (summary)',                 _FUNDING),
    _k('funders',              'Finansiärer',                         'Funders',                           _FUNDING),
    _k('funder_short_names',   'Finansiärer, förkortning',            'Funders, short name',               _FUNDING),
    _k('funding_streams',      'Finansieringsströmmar',               'Funding streams',                   _FUNDING),
    _k('programmes',           'Program (Horizon 2020)',              'Programmes (Horizon 2020)',         _FUNDING),
    _k('funded_amount',        'Beviljat belopp',                     'Funded amount',                     _FUNDING),
    _k('total_cost',           'Total kostnad',                       'Total cost',                        _FUNDING),
    _k('currency',             'Valuta',                              'Currency',                          _FUNDING),
    _k('funded_amount_text',   'Beviljat belopp med valuta',          'Funded amount with currency',       _FUNDING),
    _k('oa_mandate_publications', 'Krav på öppen tillgång, publikationer', 'Open access mandate, publications', _POLICY),
    _k('oa_mandate_datasets',  'Krav på öppen tillgång, data',        'Open access mandate, data',         _POLICY),
)


# ─── Helpers ──────────────────────────────────────────────────────────

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


def _date(value: Any) -> Optional[str]:
    text = (_str(value) or '')[:10]
    return text if _FULL_DATE_RE.match(text) else None


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return value if value > 0 else None
    try:
        num = float(str(value).replace(' ', '').replace(',', '.'))
    except ValueError:
        return None
    return num if num > 0 else None


def _format_amount(amount: Optional[float], currency: Optional[str]) -> Optional[str]:
    if amount is None:
        return None
    whole = f'{int(round(amount)):,}'.replace(',', ' ')
    return f'{whole} {currency}' if currency else whole


def _split_keywords(value: Any) -> list[str]:
    if isinstance(value, list):
        parts = value
    else:
        parts = re.split(r'[,;]', _str(value) or '')
    return _unique(_str(p) for p in parts)


def _yes_no(value: Any) -> Optional[str]:
    if value is True:
        return 'Ja'
    if value is False:
        return 'Nej'
    return None


def _funding_line(funding: dict, code: Optional[str], amount_text: Optional[str]) -> Optional[str]:
    name = _str(funding.get('name'))
    short = _str(funding.get('shortName'))
    funder = f'{name} ({short})' if name and short and short != name else (name or short)
    stream = funding.get('fundingStream') if isinstance(funding.get('fundingStream'), dict) else {}
    parts = [funder, _str(stream.get('description')), code, amount_text]
    return ', '.join(p for p in parts if p) or None


# ─── Plugin ───────────────────────────────────────────────────────────

@register
class OpenAirePlugin(SourcePlugin):
    key = 'openaire'
    version = '1.0'
    label = 'OpenAIRE'
    description = {
        'sv': 'Forskningsprojekt från OpenAIRE Graph, framför allt EU-finansierade (Horisont Europa, Horisont 2020 m.fl.). Öppet API utan nyckel.',
        'en': 'Research projects from the OpenAIRE Graph, mainly EU-funded (Horizon Europe, Horizon 2020 etc.). Open API, no key required.',
    }
    search_hint = {
        'sv': 'Titel, akronym, bidragsnummer eller OpenAIRE-id',
        'en': 'Title, acronym, grant code or OpenAIRE ID',
    }
    config_schema = (
        ConfigField(
            'base_url', {'sv': 'Bas-URL', 'en': 'Base URL'},
            type='url', default='https://api.openaire.eu/graph/v3',
        ),
        ConfigField(
            'funder_short_name', {'sv': 'Begränsa till finansiär', 'en': 'Limit to funder'},
            placeholder='EC',
            help={
                'sv': 'Valfritt. Finansiärens förkortning i OpenAIRE, t.ex. EC för Europeiska kommissionen.',
                'en': 'Optional. The funder short name in OpenAIRE, e.g. EC for the European Commission.',
            },
        ),
        ConfigField(
            'organization_country', {'sv': 'Begränsa till land', 'en': 'Limit to country'},
            placeholder='SE',
            help={
                'sv': 'Valfritt. Landskod för deltagande organisationer, t.ex. SE för projekt med svenska deltagare.',
                'en': 'Optional. Country code of participating organisations, e.g. SE for projects with Swedish participants.',
            },
        ),
    )
    suggested_mappings = (
        {'target': 'node.title',             'sources': ['title']},
        {'target': 'node.scope_and_content', 'sources': ['summary']},
        {'target': 'node.date_start',        'sources': ['start_date']},
        {'target': 'node.date_end',          'sources': ['end_date']},
        {'target': 'meta.akronym',           'sources': ['acronym']},
        {'target': 'meta.finansiering',      'sources': ['funding']},
        {'target': 'meta.nyckelord',         'sources': ['keywords']},
        {'target': 'meta.webbplats',         'sources': ['website_url']},
        {'target': 'identifier',             'sources': ['openaire_id'], 'scheme': 'OpenAIRE'},
    )

    def source_keys(self) -> list[SourceKey]:
        return list(_SOURCE_KEYS)

    def search(self, query: str) -> list[SearchHit]:
        q = (query or '').strip()
        if len(q) < 2:
            return []

        if _OPENAIRE_ID_RE.match(q):
            raw = self._get_project(q)
            return [self._hit(raw)] if raw else []

        params: dict[str, Any] = {'pageSize': MAX_HITS}
        if _GRANT_CODE_RE.match(q):
            params['code'] = q
        else:
            params['search'] = q
        if self.config.get('funder_short_name'):
            params['fundingShortName'] = self.config['funder_short_name']
        if self.config.get('organization_country'):
            params['relOrganizationCountryCode'] = str(self.config['organization_country']).upper()

        data = self.get_json(f'{self.url("projects")}?{urllib.parse.urlencode(params)}')
        items = _dicts(data.get('results')) if isinstance(data, dict) else []
        return [self._hit(item) for item in items[:MAX_HITS] if _str(item.get('id'))]

    def fetch(self, external_id: str) -> FetchedRecord:
        project_id = (external_id or '').strip()
        raw = self._get_project(project_id) if project_id else None
        if raw is None:
            raise SourceError(f'Project {external_id} not found in OpenAIRE', 404)
        return self._to_record(raw)

    # ─── Internals ────────────────────────────────────────────────────

    def _get_project(self, project_id: str) -> Optional[dict]:
        data = self.get_json(
            self.url(f'projects/{urllib.parse.quote(project_id, safe=":")}'),
            allow_missing=True,
        )
        if isinstance(data, dict) and isinstance(data.get('results'), list):
            items = _dicts(data['results'])
            data = items[0] if items else None
        return data if isinstance(data, dict) and _str(data.get('id')) else None

    def _hit(self, item: dict) -> SearchHit:
        title = _str(item.get('title'))
        acronym = _str(item.get('acronym'))
        label = f'{title} ({acronym})' if title and acronym else (title or acronym or _str(item.get('id')))
        funders = _unique(_str(f.get('shortName')) or _str(f.get('name')) for f in _dicts(item.get('fundings')))
        span = '–'.join(d[:4] for d in (_date(item.get('startDate')), _date(item.get('endDate'))) if d)
        description = ' · '.join(p for p in (', '.join(funders) or None, _str(item.get('code')), span) if p)
        return SearchHit(_str(item.get('id')), label, description or None)

    def _to_record(self, raw: dict) -> FetchedRecord:
        project_id = _str(raw.get('id'))
        code = _str(raw.get('code'))
        fundings = _dicts(raw.get('fundings'))
        granted = raw.get('granted') if isinstance(raw.get('granted'), dict) else {}
        programmes = _dicts(raw.get('h2020Programmes'))

        currency = _str(granted.get('currency'))
        funded = _number(granted.get('fundedAmount'))
        total = _number(granted.get('totalCost'))
        funded_text = _format_amount(funded, currency)
        keywords = _split_keywords(raw.get('keywords'))
        subjects = _unique(_str(s) for s in raw.get('subjects') or [])

        values = {
            'openaire_id':             project_id,
            'openaire_url':            _EXPLORE_URL.format(id=urllib.parse.quote(project_id, safe='')) if project_id else None,
            'code':                    code,
            'acronym':                 _str(raw.get('acronym')),
            'title':                   _str(raw.get('title')),
            'call_identifier':         _str(raw.get('callIdentifier')),
            'website_url':             _str(raw.get('websiteUrl')),
            'start_date':              _date(raw.get('startDate')),
            'end_date':                _date(raw.get('endDate')),
            'summary':                 _str(raw.get('summary')),
            'keywords':                _lines(keywords),
            'subjects':                _lines(subjects),
            'funding':                 _lines(_funding_line(f, code, funded_text) for f in fundings),
            'funders':                 _lines(_unique(_str(f.get('name')) for f in fundings)),
            'funder_short_names':      ', '.join(_unique(_str(f.get('shortName')) for f in fundings)) or None,
            'funding_streams':         _lines(_unique(
                _str((f.get('fundingStream') or {}).get('description'))
                for f in fundings if isinstance(f.get('fundingStream'), dict)
            )),
            'programmes':              _lines(
                ' '.join(p for p in (_str(pr.get('code')), _str(pr.get('description'))) if p)
                for pr in programmes
            ),
            'funded_amount':           funded,
            'total_cost':              total,
            'currency':                currency,
            'funded_amount_text':      funded_text,
            'oa_mandate_publications': _yes_no(raw.get('openAccessMandateForPublications')),
            'oa_mandate_datasets':     _yes_no(raw.get('openAccessMandateForDataset')),
        }
        values = {k: v for k, v in values.items() if v is not None}

        title = values.get('title')
        acronym = values.get('acronym')
        label = f'{title} ({acronym})' if title and acronym else (title or acronym or project_id)
        return FetchedRecord(
            external_id=project_id,
            label=label,
            values=values,
            source_url=values.get('openaire_url'),
        )