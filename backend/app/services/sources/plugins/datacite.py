from __future__ import annotations

import re
import urllib.parse
from typing import Any, Iterable, Optional

from ..base import ConfigField, FetchedRecord, SearchHit, SourceError, SourceKey, SourcePlugin
from ..registry import register

MAX_HITS = 20
_DOI_RE = re.compile(r'(10\.\d{4,9}/\S+)', re.IGNORECASE)
_FULL_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_ORCID_RE = re.compile(r'(\d{4}-\d{4}-\d{4}-\d{3}[\dX])', re.IGNORECASE)
_QUERY_RESERVED = re.compile(r'([+\-=&|><!(){}\[\]^"~*?:\\/])')

_RECORD = {'sv': 'Post', 'en': 'Record'}
_PEOPLE = {'sv': 'Personer', 'en': 'People'}
_DATES = {'sv': 'Datum', 'en': 'Dates'}
_CONTENT = {'sv': 'Innehåll', 'en': 'Content'}
_ACCESS = {'sv': 'Rättigheter', 'en': 'Rights'}
_FUNDING = {'sv': 'Finansiering', 'en': 'Funding'}
_RELATIONS = {'sv': 'Relationer', 'en': 'Relations'}


def _k(key: str, sv: str, en: str, group: dict) -> SourceKey:
    return SourceKey(key, {'sv': sv, 'en': en}, group)


_SOURCE_KEYS = (
    _k('doi',                   'DOI',                              'DOI',                          _RECORD),
    _k('doi_url',               'DOI-länk',                         'DOI link',                     _RECORD),
    _k('landing_url',           'Landningssida',                    'Landing page',                 _RECORD),
    _k('title',                 'Titel',                            'Title',                        _RECORD),
    _k('title_sv',              'Titel (sv)',                       'Title (sv)',                   _RECORD),
    _k('title_en',              'Titel (en)',                       'Title (en)',                   _RECORD),
    _k('subtitle',              'Undertitel',                       'Subtitle',                     _RECORD),
    _k('publisher',             'Utgivare',                         'Publisher',                    _RECORD),
    _k('resource_type_general', 'Resurstyp (generell)',             'Resource type (general)',      _RECORD),
    _k('resource_type',         'Resurstyp',                        'Resource type',                _RECORD),
    _k('version',               'Version',                          'Version',                      _RECORD),
    _k('creators',              'Upphov med ORCID och affiliering', 'Creators with ORCID and affiliation', _PEOPLE),
    _k('creator_names',         'Upphov (bara namn)',               'Creators (names only)',        _PEOPLE),
    _k('contributors',          'Medverkande med roll',             'Contributors with role',       _PEOPLE),
    _k('publication_year',      'Publiceringsår',                   'Publication year',             _DATES),
    _k('collected_start',       'Insamling start',                  'Collection start',             _DATES),
    _k('collected_end',         'Insamling slut',                   'Collection end',               _DATES),
    _k('created_date',          'Skapad',                           'Created',                      _DATES),
    _k('issued_date',           'Utgiven',                          'Issued',                       _DATES),
    _k('available_date',        'Tillgänglig från',                 'Available from',               _DATES),
    _k('dates',                 'Alla datum (text)',                'All dates (text)',             _DATES),
    _k('abstract',              'Sammanfattning',                   'Abstract',                     _CONTENT),
    _k('abstract_sv',           'Sammanfattning (sv)',              'Abstract (sv)',                _CONTENT),
    _k('abstract_en',           'Sammanfattning (en)',              'Abstract (en)',                _CONTENT),
    _k('methods',               'Metod',                            'Methods',                      _CONTENT),
    _k('technical_info',        'Teknisk information',              'Technical info',               _CONTENT),
    _k('other_description',     'Övrig beskrivning',                'Other description',            _CONTENT),
    _k('subjects',              'Ämnen med schema',                 'Subjects with scheme',         _CONTENT),
    _k('keywords',              'Nyckelord',                        'Keywords',                     _CONTENT),
    _k('language',              'Språk',                            'Language',                     _CONTENT),
    _k('sizes',                 'Storlek',                          'Size',                         _CONTENT),
    _k('formats',               'Format',                           'Formats',                      _CONTENT),
    _k('geo_locations',         'Geografisk täckning',              'Geographic coverage',          _CONTENT),
    _k('rights',                'Licens och rättigheter',           'Licence and rights',           _ACCESS),
    _k('license_uri',           'Licens-URI',                       'Licence URI',                  _ACCESS),
    _k('funding',               'Finansiering',                     'Funding',                      _FUNDING),
    _k('funders',               'Finansiärer',                      'Funders',                      _FUNDING),
    _k('award_numbers',         'Bidragsnummer',                    'Award numbers',                _FUNDING),
    _k('related_identifiers',   'Relaterade identifierare',         'Related identifiers',          _RELATIONS),
)


# ─── Helpers ──────────────────────────────────────────────────────────

def normalize_doi(text: Any) -> Optional[str]:
    match = _DOI_RE.search(str(text or '').strip())
    if not match:
        return None
    return match.group(1).rstrip('.,;').lower()


def _str(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, dict):
        value = value.get('name') or value.get('title')
    text = str(value).strip() if value is not None else ''
    return text or None


def _lines(items: Iterable[Optional[str]]) -> Optional[str]:
    return '\n'.join(i for i in items if i) or None


def _unique(items: Iterable[Optional[str]]) -> list[str]:
    return list(dict.fromkeys(i for i in items if i))


def _dicts(value: Any) -> list[dict]:
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []


def _lang_match(entry: dict, lang: str) -> bool:
    return (_str(entry.get('lang')) or '').lower().startswith(lang)


def _main_titles(titles: list[dict]) -> list[dict]:
    return [t for t in titles if not t.get('titleType')]


def _title_for(titles: list[dict], lang: Optional[str] = None) -> Optional[str]:
    candidates = _main_titles(titles) or titles
    if lang:
        candidates = [t for t in candidates if _lang_match(t, lang)]
    return _str(candidates[0].get('title')) if candidates else None


def _descriptions(descs: list[dict], dtype: str, lang: Optional[str] = None) -> Optional[str]:
    matches = [d for d in descs if (d.get('descriptionType') or 'Other') == dtype]
    if lang:
        matches = [d for d in matches if _lang_match(d, lang)]
    return _lines(_str(d.get('description')) for d in matches)


def _orcid(entry: dict) -> Optional[str]:
    for ident in _dicts(entry.get('nameIdentifiers')):
        scheme = (_str(ident.get('nameIdentifierScheme')) or '').upper()
        value = _str(ident.get('nameIdentifier')) or ''
        if scheme == 'ORCID' or 'orcid.org' in value:
            match = _ORCID_RE.search(value)
            if match:
                return match.group(1).upper()
    return None


def _person_name(entry: dict) -> Optional[str]:
    name = _str(entry.get('name'))
    if name:
        return name
    family, given = _str(entry.get('familyName')), _str(entry.get('givenName'))
    return ', '.join(p for p in (family, given) if p) or None


def _affiliations(entry: dict) -> list[str]:
    raw = entry.get('affiliation') or []
    items = raw if isinstance(raw, list) else [raw]
    return _unique(_str(a) for a in items)


def _person_line(entry: dict, role: Optional[str] = None) -> Optional[str]:
    name = _person_name(entry)
    if not name:
        return None
    extras = []
    if role:
        extras.append(role)
    orcid = _orcid(entry)
    if orcid:
        extras.append(f'ORCID {orcid}')
    affiliations = _affiliations(entry)
    if affiliations:
        extras.append('; '.join(affiliations))
    return f'{name} ({", ".join(extras)})' if extras else name


def _date_parts(dates: list[dict], dtype: str) -> tuple[Optional[str], Optional[str]]:
    for entry in dates:
        if (_str(entry.get('dateType')) or '').lower() != dtype.lower():
            continue
        raw = _str(entry.get('date')) or ''
        start, _, end = raw.partition('/')
        start, end = start.strip(), (end.strip() or start.strip())
        return (start if _FULL_DATE_RE.match(start) else None,
                end if _FULL_DATE_RE.match(end) else None)
    return None, None


def _rights_line(entry: dict) -> Optional[str]:
    text = _str(entry.get('rights'))
    uri = _str(entry.get('rightsUri'))
    if text and uri:
        return f'{text} ({uri})'
    return text or uri


def _funding_line(entry: dict) -> Optional[str]:
    parts = [_str(entry.get('funderName')), _str(entry.get('awardNumber')), _str(entry.get('awardTitle'))]
    return ', '.join(p for p in parts if p) or None


def _related_line(entry: dict) -> Optional[str]:
    ident = _str(entry.get('relatedIdentifier'))
    if not ident:
        return None
    relation = _str(entry.get('relationType'))
    id_type = _str(entry.get('relatedIdentifierType'))
    line = f'{relation}: {ident}' if relation else ident
    return f'{line} ({id_type})' if id_type else line


def _geo_line(entry: dict) -> Optional[str]:
    return _str(entry.get('geoLocationPlace'))


def _escape_query(text: str) -> str:
    return _QUERY_RESERVED.sub(r'\\\1', text)


# ─── Plugin ───────────────────────────────────────────────────────────

@register
class DataCitePlugin(SourcePlugin):
    key = 'datacite'
    version = '1.0'
    label = 'DataCite'
    description = {
        'sv': 'Forskningsdata och andra resurser med DOI registrerade hos DataCite (t.ex. SND, Zenodo och lärosätenas repositorier). Öppet API utan nyckel.',
        'en': 'Research data and other resources with DOIs registered at DataCite (e.g. SND, Zenodo and institutional repositories). Open API, no key required.',
    }
    search_hint = {
        'sv': 'DOI eller sökord, t.ex. 10.5878/abcd-1234',
        'en': 'DOI or keywords, e.g. 10.5878/abcd-1234',
    }
    config_schema = (
        ConfigField(
            'base_url', {'sv': 'Bas-URL', 'en': 'Base URL'},
            type='url', default='https://api.datacite.org',
        ),
        ConfigField(
            'client_id', {'sv': 'Begränsa till repository', 'en': 'Limit to repository'},
            placeholder='cern.zenodo',
            help={
                'sv': 'Valfritt. DataCites repository-ID om sökningen bara ska omfatta ett repository.',
                'en': 'Optional. DataCite repository ID if search should be limited to one repository.',
            },
        ),
        ConfigField(
            'prefix', {'sv': 'Begränsa till DOI-prefix', 'en': 'Limit to DOI prefix'},
            placeholder='10.5878',
            help={
                'sv': 'Valfritt. Begränsar sökningen till DOI:er med detta prefix.',
                'en': 'Optional. Limits search to DOIs with this prefix.',
            },
        ),
    )
    suggested_mappings = (
        {'target': 'node.title',                   'sources': ['title_sv', 'title_en', 'title']},
        {'target': 'node.scope_and_content',       'sources': ['abstract_sv', 'abstract_en', 'abstract']},
        {'target': 'node.date_start',              'sources': ['collected_start', 'created_date']},
        {'target': 'node.date_end',                'sources': ['collected_end']},
        {'target': 'node.language',                'sources': ['language']},
        {'target': 'node.extent',                  'sources': ['sizes']},
        {'target': 'node.reproduction_conditions', 'sources': ['rights']},
        {'target': 'identifier',                   'sources': ['doi'], 'scheme': 'DOI'},
    )

    def source_keys(self) -> list[SourceKey]:
        return list(_SOURCE_KEYS)

    def search(self, query: str) -> list[SearchHit]:
        q = (query or '').strip()
        if len(q) < 2:
            return []

        doi = normalize_doi(q)
        if doi:
            raw = self._get_doi(doi)
            return [self._hit(raw)] if raw else []

        params = {'query': _escape_query(q), 'page[size]': MAX_HITS}
        if self.config.get('client_id'):
            params['client-id'] = self.config['client_id']
        if self.config.get('prefix'):
            params['prefix'] = self.config['prefix']

        data = self.get_json(f'{self.url("dois")}?{urllib.parse.urlencode(params)}')
        items = _dicts(data.get('data')) if isinstance(data, dict) else []
        return [self._hit(item) for item in items[:MAX_HITS]]

    def fetch(self, external_id: str) -> FetchedRecord:
        doi = normalize_doi(external_id)
        raw = self._get_doi(doi) if doi else None
        if raw is None:
            raise SourceError(f'DOI {external_id} not found in DataCite', 404)
        return self._to_record(raw)

    # ─── Internals ────────────────────────────────────────────────────

    def _get_doi(self, doi: str) -> Optional[dict]:
        data = self.get_json(self.url(f'dois/{urllib.parse.quote(doi, safe="/")}'), allow_missing=True)
        item = data.get('data') if isinstance(data, dict) else None
        return item if isinstance(item, dict) and isinstance(item.get('attributes'), dict) else None

    def _hit(self, item: dict) -> SearchHit:
        attrs = item.get('attributes') or {}
        doi = _str(attrs.get('doi')) or _str(item.get('id')) or ''
        titles = _dicts(attrs.get('titles'))
        creators = [_person_name(c) for c in _dicts(attrs.get('creators'))]
        names = [n for n in creators if n]
        who = names[0] + (' m.fl.' if len(names) > 1 else '') if names else None
        description = ' · '.join(p for p in (
            who, _str(attrs.get('publisher')), _str(attrs.get('publicationYear')),
        ) if p)
        return SearchHit(doi, _title_for(titles) or doi, description or None)

    def _to_record(self, item: dict) -> FetchedRecord:
        attrs = item.get('attributes') or {}
        doi = (_str(attrs.get('doi')) or _str(item.get('id')) or '').lower()

        titles = _dicts(attrs.get('titles'))
        descs = _dicts(attrs.get('descriptions'))
        creators = _dicts(attrs.get('creators'))
        contributors = _dicts(attrs.get('contributors'))
        dates = _dicts(attrs.get('dates'))
        subjects = _dicts(attrs.get('subjects'))
        rights = _dicts(attrs.get('rightsList'))
        funding = _dicts(attrs.get('fundingReferences'))
        related = _dicts(attrs.get('relatedIdentifiers'))
        geo = _dicts(attrs.get('geoLocations'))
        types = attrs.get('types') if isinstance(attrs.get('types'), dict) else {}

        collected_start, collected_end = _date_parts(dates, 'Collected')
        created_date, _ = _date_parts(dates, 'Created')
        issued_date, _ = _date_parts(dates, 'Issued')
        available_date, _ = _date_parts(dates, 'Available')
        subtitles = [t for t in titles if (t.get('titleType') or '') == 'Subtitle']

        values = {
            'doi':                   doi or None,
            'doi_url':               f'https://doi.org/{doi}' if doi else None,
            'landing_url':           _str(attrs.get('url')),
            'title':                 _title_for(titles),
            'title_sv':              _title_for(titles, 'sv'),
            'title_en':              _title_for(titles, 'en'),
            'subtitle':              _str(subtitles[0].get('title')) if subtitles else None,
            'publisher':             _str(attrs.get('publisher')),
            'resource_type_general': _str(types.get('resourceTypeGeneral')),
            'resource_type':         _str(types.get('resourceType')),
            'version':               _str(attrs.get('version')),
            'creators':              _lines(_person_line(c) for c in creators),
            'creator_names':         _lines(_person_name(c) for c in creators),
            'contributors':          _lines(_person_line(c, _str(c.get('contributorType'))) for c in contributors),
            'publication_year':      _str(attrs.get('publicationYear')),
            'collected_start':       collected_start,
            'collected_end':         collected_end,
            'created_date':          created_date,
            'issued_date':           issued_date,
            'available_date':        available_date,
            'dates':                 _lines(
                f'{_str(d.get("dateType")) or "Date"}: {_str(d.get("date"))}' for d in dates if _str(d.get('date'))
            ),
            'abstract':              _descriptions(descs, 'Abstract'),
            'abstract_sv':           _descriptions(descs, 'Abstract', 'sv'),
            'abstract_en':           _descriptions(descs, 'Abstract', 'en'),
            'methods':               _descriptions(descs, 'Methods'),
            'technical_info':        _descriptions(descs, 'TechnicalInfo'),
            'other_description':     _descriptions(descs, 'Other'),
            'subjects':              _lines(
                f'{_str(s.get("subject"))} ({_str(s.get("subjectScheme"))})' if _str(s.get('subjectScheme'))
                else _str(s.get('subject'))
                for s in subjects if _str(s.get('subject'))
            ),
            'keywords':              ', '.join(_unique(_str(s.get('subject')) for s in subjects)) or None,
            'language':              _str(attrs.get('language')),
            'sizes':                 ', '.join(_unique(_str(s) for s in attrs.get('sizes') or [])) or None,
            'formats':               ', '.join(_unique(_str(f) for f in attrs.get('formats') or [])) or None,
            'geo_locations':         _lines(_unique(_geo_line(g) for g in geo)),
            'rights':                _lines(_rights_line(r) for r in rights),
            'license_uri':           next((_str(r.get('rightsUri')) for r in rights if _str(r.get('rightsUri'))), None),
            'funding':               _lines(_funding_line(f) for f in funding),
            'funders':               _lines(_unique(_str(f.get('funderName')) for f in funding)),
            'award_numbers':         ', '.join(_unique(_str(f.get('awardNumber')) for f in funding)) or None,
            'related_identifiers':   _lines(_related_line(r) for r in related),
        }
        values = {k: v for k, v in values.items() if v is not None}

        label = values.get('title_sv') or values.get('title_en') or values.get('title') or doi
        return FetchedRecord(
            external_id=doi,
            label=label,
            values=values,
            source_url=values.get('doi_url'),
        )