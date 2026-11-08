from __future__ import annotations

import re
import urllib.parse
from typing import Any, Iterable, Optional

from ..base import ConfigField, FetchedRecord, SearchHit, SourceError, SourceKey, SourcePlugin
from ..registry import register
from .crossref import normalize_doi

_FULL_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}')

OA_STATUS_SV = {
    'gold': 'Guld (öppen tidskrift)',
    'diamond': 'Diamant (öppen tidskrift utan avgift)',
    'hybrid': 'Hybrid (öppen artikel i prenumerationstidskrift)',
    'bronze': 'Brons (fritt läsbar hos förlaget, utan licens)',
    'green': 'Grön (öppen kopia i repositorium)',
    'closed': 'Stängd',
}
VERSION_SV = {
    'publishedVersion': 'Publicerad version',
    'acceptedVersion': 'Accepterat manus',
    'submittedVersion': 'Inskickat manus',
}
HOST_TYPE_SV = {
    'publisher': 'Förlag',
    'repository': 'Repositorium',
}
ACCESS_OPEN = 'Öppen tillgång'
ACCESS_EMBARGO = 'Embargo'
ACCESS_CLOSED = 'Ej öppet tillgänglig'

_WORK = {'sv': 'Publikation', 'en': 'Publication'}
_ACCESS = {'sv': 'Öppen tillgång', 'en': 'Open access'}
_BEST = {'sv': 'Bästa öppna version', 'en': 'Best open version'}
_JOURNAL = {'sv': 'Tidskrift', 'en': 'Journal'}


def _k(key: str, sv: str, en: str, group: dict) -> SourceKey:
    return SourceKey(key, {'sv': sv, 'en': en}, group)


_SOURCE_KEYS = (
    _k('doi',               'DOI',                                     'DOI',                                  _WORK),
    _k('doi_url',           'DOI-länk',                                'DOI link',                             _WORK),
    _k('title',             'Titel',                                   'Title',                                _WORK),
    _k('genre',             'Typ',                                     'Genre',                                _WORK),
    _k('year',              'Publiceringsår',                          'Publication year',                     _WORK),
    _k('published_date',    'Publiceringsdatum',                       'Publication date',                     _WORK),
    _k('authors',           'Författare',                              'Authors',                              _WORK),
    _k('is_oa',             'Öppet tillgänglig (Ja/Nej)',              'Open access (yes/no)',                 _ACCESS),
    _k('oa_status',         'OA-status',                               'OA status',                            _ACCESS),
    _k('oa_status_sv',      'OA-status (förklarad)',                   'OA status (explained)',                _ACCESS),
    _k('access_sv',         'Tillgänglighet (mallens alternativ)',     'Access (template options)',            _ACCESS),
    _k('embargo_until',     'Embargo till',                            'Embargo until',                        _ACCESS),
    _k('all_locations',     'Alla öppna versioner',                    'All open versions',                    _ACCESS),
    _k('best_pdf_url',      'PDF-länk',                                'PDF link',                             _BEST),
    _k('best_url',          'Länk',                                    'Link',                                 _BEST),
    _k('best_landing_page', 'Landningssida',                           'Landing page',                         _BEST),
    _k('best_version',      'Version',                                 'Version',                              _BEST),
    _k('best_version_sv',   'Version (mallens alternativ)',            'Version (template options)',           _BEST),
    _k('best_license',      'Licens',                                  'Licence',                              _BEST),
    _k('best_license_text', 'Licens (läsbar)',                         'Licence (readable)',                   _BEST),
    _k('best_host_type',    'Var den finns',                           'Host type',                            _BEST),
    _k('best_repository',   'Repositoriets institution',               'Repository institution',               _BEST),
    _k('best_oa_date',      'Öppen sedan',                             'Open since',                           _BEST),
    _k('journal_name',      'Tidskrift',                               'Journal',                              _JOURNAL),
    _k('journal_issns',     'ISSN',                                    'ISSN',                                 _JOURNAL),
    _k('journal_is_oa',     'Öppen tidskrift (Ja/Nej)',                'Open journal (yes/no)',                _JOURNAL),
    _k('journal_in_doaj',   'Finns i DOAJ (Ja/Nej)',                   'Listed in DOAJ (yes/no)',              _JOURNAL),
    _k('publisher',         'Förlag',                                  'Publisher',                            _JOURNAL),
)


# ─── Helpers ──────────────────────────────────────────────────────────

def _str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _lines(items: Iterable[Optional[str]]) -> Optional[str]:
    return '\n'.join(i for i in items if i) or None


def _dicts(value: Any) -> list[dict]:
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []


def _yes_no(value: Any) -> Optional[str]:
    if value is True:
        return 'Ja'
    if value is False:
        return 'Nej'
    return None


def _full_date(value: Any) -> Optional[str]:
    text = _str(value) or ''
    return text[:10] if _FULL_DATE_RE.match(text) else None


def _license_text(license_key: Optional[str]) -> Optional[str]:
    if not license_key:
        return None
    if license_key.lower().startswith('cc'):
        return license_key.upper().replace('-', ' ')
    return license_key


def _author_name(author: dict) -> Optional[str]:
    family, given = _str(author.get('family')), _str(author.get('given'))
    return ', '.join(p for p in (family, given) if p) or _str(author.get('name'))


def _location_line(location: dict) -> Optional[str]:
    url = _str(location.get('url_for_pdf')) or _str(location.get('url'))
    if not url:
        return None
    details = [
        HOST_TYPE_SV.get(_str(location.get('host_type')) or '', _str(location.get('host_type'))),
        VERSION_SV.get(_str(location.get('version')) or '', _str(location.get('version'))),
        _license_text(_str(location.get('license'))),
        _str(location.get('repository_institution')),
    ]
    details = [d for d in details if d]
    return f'{url} ({", ".join(details)})' if details else url


# ─── Plugin ───────────────────────────────────────────────────────────

@register
class UnpaywallPlugin(SourcePlugin):
    key = 'unpaywall'
    version = '1.0'
    label = 'Unpaywall'
    description = {
        'sv': 'Visar om en publikation finns öppet tillgänglig, var, i vilken version och under vilken licens. Slår upp på DOI. Öppet API, kräver bara en e-postadress.',
        'en': 'Shows whether a publication is openly available, where, in which version and under which licence. Looks up by DOI. Open API, only requires an email address.',
    }
    search_hint = {'sv': 'DOI', 'en': 'DOI'}
    config_schema = (
        ConfigField(
            'base_url', {'sv': 'Bas-URL', 'en': 'Base URL'},
            type='url', default='https://api.unpaywall.org/v2',
        ),
        ConfigField(
            'email', {'sv': 'E-postadress', 'en': 'Email address'},
            required=True, placeholder='arkiv@example.se',
            help={
                'sv': 'Krävs av Unpaywall för alla anrop.',
                'en': 'Required by Unpaywall for all requests.',
            },
        ),
    )
    suggested_mappings = (
        {'target': 'meta.oppen_tillgang',          'sources': ['access_sv']},
        {'target': 'meta.embargo_till',            'sources': ['embargo_until']},
        {'target': 'meta.arkiverad_version',       'sources': ['best_version_sv']},
        {'target': 'node.reproduction_conditions', 'sources': ['best_license_text']},
        {'target': 'identifier',                   'sources': ['doi'], 'scheme': 'DOI'},
    )

    def source_keys(self) -> list[SourceKey]:
        return list(_SOURCE_KEYS)

    def search(self, query: str) -> list[SearchHit]:
        doi = normalize_doi(query)
        if not doi:
            return []
        work = self._get_work(doi)
        if work is None:
            return []
        description = ' · '.join(p for p in (
            OA_STATUS_SV.get(_str(work.get('oa_status')) or ''),
            _str(work.get('journal_name')),
            _str(work.get('year')),
        ) if p)
        return [SearchHit(doi, _str(work.get('title')) or doi, description or None)]

    def fetch(self, external_id: str) -> FetchedRecord:
        doi = normalize_doi(external_id)
        work = self._get_work(doi) if doi else None
        if work is None:
            raise SourceError(f'DOI {external_id} not found in Unpaywall', 404)
        return self._to_record(work)

    # ─── Internals ────────────────────────────────────────────────────

    def _get_work(self, doi: str) -> Optional[dict]:
        email = _str(self.config.get('email'))
        if not email:
            raise SourceError('Unpaywall requires an email address in the source configuration', 400)
        url = f'{self.url(urllib.parse.quote(doi, safe="/"))}?{urllib.parse.urlencode({"email": email})}'
        data = self.get_json(url, allow_missing=True)
        return data if isinstance(data, dict) and data.get('doi') else None

    def _to_record(self, work: dict) -> FetchedRecord:
        doi = normalize_doi(work.get('doi'))
        best = work.get('best_oa_location') if isinstance(work.get('best_oa_location'), dict) else {}
        locations = _dicts(work.get('oa_locations'))
        embargoed = _dicts(work.get('oa_locations_embargoed'))
        is_oa = work.get('is_oa') is True

        oa_status = _str(work.get('oa_status'))
        version = _str(best.get('version'))
        license_key = _str(best.get('license'))

        if is_oa:
            access = ACCESS_OPEN
        elif embargoed:
            access = ACCESS_EMBARGO
        else:
            access = ACCESS_CLOSED
        embargo_until = next((_full_date(e.get('oa_date')) for e in embargoed if _full_date(e.get('oa_date'))), None)

        values = {
            'doi':               doi,
            'doi_url':           f'https://doi.org/{doi}' if doi else None,
            'title':             _str(work.get('title')),
            'genre':             _str(work.get('genre')),
            'year':              _str(work.get('year')),
            'published_date':    _full_date(work.get('published_date')),
            'authors':           _lines(_author_name(a) for a in _dicts(work.get('z_authors'))),
            'is_oa':             _yes_no(work.get('is_oa')),
            'oa_status':         oa_status,
            'oa_status_sv':      OA_STATUS_SV.get(oa_status or ''),
            'access_sv':         access,
            'embargo_until':     embargo_until if not is_oa else None,
            'all_locations':     _lines(_location_line(loc) for loc in locations),
            'best_pdf_url':      _str(best.get('url_for_pdf')),
            'best_url':          _str(best.get('url')),
            'best_landing_page': _str(best.get('url_for_landing_page')),
            'best_version':      version,
            'best_version_sv':   VERSION_SV.get(version or ''),
            'best_license':      license_key,
            'best_license_text': _license_text(license_key),
            'best_host_type':    HOST_TYPE_SV.get(_str(best.get('host_type')) or ''),
            'best_repository':   _str(best.get('repository_institution')),
            'best_oa_date':      _full_date(best.get('oa_date')),
            'journal_name':      _str(work.get('journal_name')),
            'journal_issns':     _str(work.get('journal_issns')),
            'journal_is_oa':     _yes_no(work.get('journal_is_oa')),
            'journal_in_doaj':   _yes_no(work.get('journal_is_in_doaj')),
            'publisher':         _str(work.get('publisher')),
        }
        values = {k: v for k, v in values.items() if v is not None}

        return FetchedRecord(
            external_id=doi,
            label=values.get('title') or doi,
            values=values,
            source_url=values.get('best_pdf_url') or values.get('best_url') or values.get('doi_url'),
        )