from __future__ import annotations

import html
import re
import urllib.parse
from typing import Any, Iterable, Optional

from ..base import ConfigField, FetchedRecord, SearchHit, SourceError, SourceKey, SourcePlugin
from ..registry import register

MAX_HITS = 20
_DOI_RE = re.compile(r'(10\.\d{4,9}/\S+)', re.IGNORECASE)
_ORCID_RE = re.compile(r'(\d{4}-\d{4}-\d{4}-\d{3}[\dX])', re.IGNORECASE)
_TAG_RE = re.compile(r'<[^>]+>')
_SEARCH_FIELDS = 'DOI,title,author,container-title,issued,type,publisher'

TYPE_LABELS_SV = {
    'journal-article': 'Vetenskaplig artikel',
    'proceedings-article': 'Konferensbidrag',
    'book': 'Bok',
    'monograph': 'Bok',
    'edited-book': 'Bok',
    'reference-book': 'Bok',
    'book-chapter': 'Bokkapitel',
    'book-section': 'Bokkapitel',
    'book-part': 'Bokkapitel',
    'report': 'Rapport',
    'report-component': 'Rapport',
    'dissertation': 'Doktorsavhandling',
    'posted-content': 'Preprint',
}
DEFAULT_TYPE_SV = 'Annan publikation'

_WORK = {'sv': 'Publikation', 'en': 'Publication'}
_PEOPLE = {'sv': 'Personer', 'en': 'People'}
_SOURCE = {'sv': 'Tidskrift och utgivning', 'en': 'Journal and publishing'}
_DATES = {'sv': 'Datum', 'en': 'Dates'}
_CONTENT = {'sv': 'Innehåll', 'en': 'Content'}
_RIGHTS = {'sv': 'Rättigheter', 'en': 'Rights'}
_FUNDING = {'sv': 'Finansiering', 'en': 'Funding'}


def _k(key: str, sv: str, en: str, group: dict) -> SourceKey:
    return SourceKey(key, {'sv': sv, 'en': en}, group)


_SOURCE_KEYS = (
    _k('doi',                  'DOI',                                  'DOI',                                 _WORK),
    _k('doi_url',              'DOI-länk',                             'DOI link',                            _WORK),
    _k('title',                'Titel (med undertitel)',               'Title (with subtitle)',               _WORK),
    _k('title_only',           'Titel',                                'Title',                               _WORK),
    _k('subtitle',             'Undertitel',                           'Subtitle',                            _WORK),
    _k('type',                 'Typ (Crossref)',                       'Type (Crossref)',                     _WORK),
    _k('publication_type_sv',  'Publikationstyp (svensk benämning)',   'Publication type (Swedish label)',    _WORK),
    _k('reference',            'Bibliografisk referens',               'Bibliographic reference',             _WORK),
    _k('authors',              'Författare med ORCID och affiliering', 'Authors with ORCID and affiliation',  _PEOPLE),
    _k('author_names',         'Författare (bara namn)',               'Authors (names only)',                _PEOPLE),
    _k('first_author',         'Förste författare',                    'First author',                        _PEOPLE),
    _k('editors',              'Redaktörer',                           'Editors',                             _PEOPLE),
    _k('container_title',      'Tidskrift eller serie',                'Journal or series',                   _SOURCE),
    _k('short_container_title','Tidskrift, förkortning',               'Journal, abbreviation',               _SOURCE),
    _k('volume',               'Volym',                                'Volume',                              _SOURCE),
    _k('issue',                'Nummer',                               'Issue',                               _SOURCE),
    _k('pages',                'Sidor',                                'Pages',                               _SOURCE),
    _k('article_number',       'Artikelnummer',                        'Article number',                      _SOURCE),
    _k('volume_issue_pages',   'Volym, nummer och sidor',              'Volume, issue and pages',             _SOURCE),
    _k('issn',                 'ISSN',                                 'ISSN',                                _SOURCE),
    _k('isbn',                 'ISBN',                                 'ISBN',                                _SOURCE),
    _k('issn_isbn',            'ISSN eller ISBN',                      'ISSN or ISBN',                        _SOURCE),
    _k('publisher',            'Förlag',                               'Publisher',                           _SOURCE),
    _k('publication_year',     'Publiceringsår',                       'Publication year',                    _DATES),
    _k('published_date',       'Publiceringsdatum',                    'Publication date',                    _DATES),
    _k('published_online',     'Publicerad online',                    'Published online',                    _DATES),
    _k('published_print',      'Publicerad i tryck',                   'Published in print',                  _DATES),
    _k('abstract',             'Sammanfattning',                       'Abstract',                            _CONTENT),
    _k('language',             'Språk',                                'Language',                            _CONTENT),
    _k('cited_by_count',       'Antal citeringar',                     'Citation count',                      _CONTENT),
    _k('license',              'Licens',                               'Licence',                             _RIGHTS),
    _k('license_uri',          'Licens-URI',                           'Licence URI',                         _RIGHTS),
    _k('funding',              'Finansiering',                         'Funding',                             _FUNDING),
    _k('funders',              'Finansiärer',                          'Funders',                             _FUNDING),
    _k('award_numbers',        'Bidragsnummer',                        'Award numbers',                       _FUNDING),
)


# ─── Helpers ──────────────────────────────────────────────────────────

_PREPRINT_SUFFIX_RE = re.compile(r'(?:v\d+)?(?:\.full(?:-text)?)?(?:\.pdf)?/?$', re.IGNORECASE)


def normalize_doi(text: Any) -> Optional[str]:
    match = _DOI_RE.search(str(text or '').strip())
    if not match:
        return None
    doi = match.group(1).rstrip('.,;').lower()
    if doi.startswith('10.1101/'):
        doi = _PREPRINT_SUFFIX_RE.sub('', doi)
    return doi


def _str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _first(value: Any) -> Optional[str]:
    if isinstance(value, list):
        return next((_str(v) for v in value if _str(v)), None)
    return _str(value)


def _lines(items: Iterable[Optional[str]]) -> Optional[str]:
    return '\n'.join(i for i in items if i) or None


def _unique(items: Iterable[Optional[str]]) -> list[str]:
    return list(dict.fromkeys(i for i in items if i))


def _dicts(value: Any) -> list[dict]:
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []


def _date_parts(value: Any) -> list[int]:
    if not isinstance(value, dict):
        return []
    parts = value.get('date-parts')
    if not isinstance(parts, list) or not parts or not isinstance(parts[0], list):
        return []
    return [p for p in parts[0] if isinstance(p, int)]


def _format_date(parts: list[int]) -> Optional[str]:
    if not parts:
        return None
    if len(parts) >= 3:
        return f'{parts[0]:04d}-{parts[1]:02d}-{parts[2]:02d}'
    if len(parts) == 2:
        return f'{parts[0]:04d}-{parts[1]:02d}'
    return f'{parts[0]:04d}'


def _full_date(parts: list[int]) -> Optional[str]:
    return _format_date(parts) if len(parts) >= 3 else None


def _clean_abstract(value: Any) -> Optional[str]:
    text = _str(value)
    if not text:
        return None
    text = re.sub(r'</(jats:)?p>', '\n\n', text)
    text = html.unescape(_TAG_RE.sub('', text))
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n\s*\n+', '\n\n', text).strip()
    text = re.sub(r'^(abstract|sammanfattning)\s*[:.]?\s*', '', text, flags=re.IGNORECASE)
    return text or None


def _person_name(entry: dict, inverted: bool = False) -> Optional[str]:
    given, family = _str(entry.get('given')), _str(entry.get('family'))
    if family:
        if inverted:
            return ', '.join(p for p in (family, given) if p)
        return ' '.join(p for p in (given, family) if p)
    return _str(entry.get('name'))


def _orcid(entry: dict) -> Optional[str]:
    match = _ORCID_RE.search(_str(entry.get('ORCID')) or '')
    return match.group(1).upper() if match else None


def _person_line(entry: dict) -> Optional[str]:
    name = _person_name(entry, inverted=True)
    if not name:
        return None
    extras = []
    orcid = _orcid(entry)
    if orcid:
        extras.append(f'ORCID {orcid}')
    affiliations = _unique(_str(a.get('name')) for a in _dicts(entry.get('affiliation')))
    if affiliations:
        extras.append('; '.join(affiliations))
    return f'{name} ({", ".join(extras)})' if extras else name


def _issn_lines(work: dict) -> list[str]:
    typed = _dicts(work.get('issn-type'))
    if typed:
        return _unique(
            f'{_str(i.get("value"))} ({_str(i.get("type"))})' if _str(i.get('type')) else _str(i.get('value'))
            for i in typed if _str(i.get('value'))
        )
    return _unique(_str(i) for i in work.get('ISSN') or [])


def _volume_issue_pages(volume: Optional[str], issue: Optional[str],
                        pages: Optional[str], article_number: Optional[str]) -> Optional[str]:
    text = volume or ''
    if issue:
        text += f'({issue})'
    location = (pages or '').replace('-', '–') or (f'art. {article_number}' if article_number else '')
    if location:
        text = f'{text}, {location}' if text else location
    return text or None


def _reference(authors: list[str], year: Optional[str], title: Optional[str], container: Optional[str],
               volume_issue_pages: Optional[str], publisher: Optional[str], doi: Optional[str]) -> Optional[str]:
    if not title:
        return None
    if len(authors) > 3:
        who = f'{authors[0]} m.fl.'
    else:
        who = ', '.join(authors)
    parts = []
    head = ' '.join(p for p in (who, f'({year})' if year else None) if p)
    if head:
        parts.append(head + '.')
    parts.append(title.rstrip('.') + '.')
    if container:
        parts.append(f'{container}{", " + volume_issue_pages if volume_issue_pages else ""}.')
    elif publisher:
        parts.append(f'{publisher}.')
    if doi:
        parts.append(f'https://doi.org/{doi}')
    return ' '.join(parts)


# ─── Plugin ───────────────────────────────────────────────────────────

@register
class CrossrefPlugin(SourcePlugin):
    key = 'crossref'
    version = '1.0'
    label = 'Crossref'
    description = {
        'sv': 'Vetenskapliga artiklar, konferensbidrag och böcker med DOI registrerade hos Crossref. Öppet API utan nyckel.',
        'en': 'Journal articles, conference papers and books with DOIs registered at Crossref. Open API, no key required.',
    }
    search_hint = {
        'sv': 'DOI, titel eller författare',
        'en': 'DOI, title or author',
    }
    config_schema = (
        ConfigField(
            'base_url', {'sv': 'Bas-URL', 'en': 'Base URL'},
            type='url', default='https://api.crossref.org',
        ),
        ConfigField(
            'mailto', {'sv': 'Kontaktadress', 'en': 'Contact address'},
            placeholder='arkiv@example.se',
            help={
                'sv': 'Rekommenderat. Crossref ger stabilare svarstider åt anrop som anger en kontaktadress.',
                'en': 'Recommended. Crossref gives more reliable response times to requests that include a contact address.',
            },
        ),
        ConfigField(
            'filter', {'sv': 'Filter för sökning', 'en': 'Search filter'},
            placeholder='type:journal-article',
            help={
                'sv': 'Valfritt. Crossrefs filtersyntax, t.ex. type:journal-article eller from-pub-date:2020.',
                'en': 'Optional. Crossref filter syntax, e.g. type:journal-article or from-pub-date:2020.',
            },
        ),
    )
    suggested_mappings = (
        {'target': 'node.title',                   'sources': ['title']},
        {'target': 'node.scope_and_content',       'sources': ['abstract']},
        {'target': 'node.date_start',              'sources': ['published_date']},
        {'target': 'node.language',                'sources': ['language']},
        {'target': 'node.reproduction_conditions', 'sources': ['license']},
        {'target': 'meta.publikationstyp',         'sources': ['publication_type_sv']},
        {'target': 'meta.forfattare',              'sources': ['authors']},
        {'target': 'meta.publiceringsar',          'sources': ['publication_year']},
        {'target': 'meta.tidskrift',               'sources': ['container_title']},
        {'target': 'meta.volym_nummer_sidor',      'sources': ['volume_issue_pages']},
        {'target': 'meta.issn_isbn',               'sources': ['issn_isbn']},
        {'target': 'meta.forlag',                  'sources': ['publisher']},
        {'target': 'meta.referens',                'sources': ['reference']},
        {'target': 'identifier',                   'sources': ['doi'], 'scheme': 'DOI'},
    )

    def request_headers(self) -> dict:
        mailto = _str(self.config.get('mailto'))
        agent = 'Kurbits/1.0 (archival description system' + (f'; mailto:{mailto}' if mailto else '') + ')'
        return {'User-Agent': agent}

    def source_keys(self) -> list[SourceKey]:
        return list(_SOURCE_KEYS)

    def search(self, query: str) -> list[SearchHit]:
        q = (query or '').strip()
        if len(q) < 2:
            return []

        doi = normalize_doi(q)
        if doi:
            work = self._get_work(doi)
            return [self._hit(work)] if work else []

        params = {'query.bibliographic': q, 'rows': MAX_HITS, 'select': _SEARCH_FIELDS}
        if self.config.get('filter'):
            params['filter'] = self.config['filter']
        data = self.get_json(f'{self.url("works")}?{urllib.parse.urlencode(params)}')
        message = data.get('message') if isinstance(data, dict) else None
        items = _dicts(message.get('items')) if isinstance(message, dict) else []
        return [self._hit(item) for item in items[:MAX_HITS] if normalize_doi(item.get('DOI'))]

    def fetch(self, external_id: str) -> FetchedRecord:
        doi = normalize_doi(external_id)
        work = self._get_work(doi) if doi else None
        if work is None:
            raise SourceError(f'DOI {external_id} not found in Crossref', 404)
        return self._to_record(work)

    # ─── Internals ────────────────────────────────────────────────────

    def _get_work(self, doi: str) -> Optional[dict]:
        data = self.get_json(self.url(f'works/{urllib.parse.quote(doi, safe="/")}'), allow_missing=True)
        message = data.get('message') if isinstance(data, dict) else None
        return message if isinstance(message, dict) and message.get('DOI') else None

    def _hit(self, work: dict) -> SearchHit:
        doi = normalize_doi(work.get('DOI')) or ''
        title = _first(work.get('title')) or doi
        names = [n for n in (_person_name(a) for a in _dicts(work.get('author'))) if n]
        who = names[0] + (' m.fl.' if len(names) > 1 else '') if names else None
        year = _format_date(_date_parts(work.get('issued')))[:4] if _date_parts(work.get('issued')) else None
        description = ' · '.join(p for p in (
            who, _first(work.get('container-title')) or _str(work.get('publisher')), year,
        ) if p)
        return SearchHit(doi, title, description or None)

    def _to_record(self, work: dict) -> FetchedRecord:
        doi = normalize_doi(work.get('DOI'))
        title_only = _first(work.get('title'))
        subtitle = _first(work.get('subtitle'))
        title = f'{title_only}: {subtitle}' if title_only and subtitle else title_only

        authors = _dicts(work.get('author'))
        author_names = [n for n in (_person_name(a, inverted=True) for a in authors) if n]
        editors = _dicts(work.get('editor'))

        issued = _date_parts(work.get('published')) or _date_parts(work.get('issued'))
        year = f'{issued[0]:04d}' if issued else None

        volume = _str(work.get('volume'))
        issue = _str(work.get('issue'))
        pages = _str(work.get('page'))
        article_number = _str(work.get('article-number'))
        vip = _volume_issue_pages(volume, issue, pages, article_number)

        issn = _issn_lines(work)
        isbn = _unique(_str(i) for i in work.get('ISBN') or [])
        container = _first(work.get('container-title'))
        publisher = _str(work.get('publisher'))
        crossref_type = _str(work.get('type'))

        licenses = _dicts(work.get('license'))
        license_uris = _unique(_str(lic.get('URL')) for lic in licenses)
        funders = _dicts(work.get('funder'))

        values = {
            'doi':                   doi,
            'doi_url':               f'https://doi.org/{doi}' if doi else None,
            'title':                 title,
            'title_only':            title_only,
            'subtitle':              subtitle,
            'type':                  crossref_type,
            'publication_type_sv':   TYPE_LABELS_SV.get(crossref_type or '', DEFAULT_TYPE_SV),
            'reference':             _reference(author_names, year, title, container, vip, publisher, doi),
            'authors':               _lines(_person_line(a) for a in authors),
            'author_names':          _lines(_person_name(a) for a in authors),
            'first_author':          author_names[0] if author_names else None,
            'editors':               _lines(_person_line(e) for e in editors),
            'container_title':       container,
            'short_container_title': _first(work.get('short-container-title')),
            'volume':                volume,
            'issue':                 issue,
            'pages':                 pages,
            'article_number':        article_number,
            'volume_issue_pages':    vip,
            'issn':                  ', '.join(issn) or None,
            'isbn':                  ', '.join(isbn) or None,
            'issn_isbn':             ', '.join(issn + isbn) or None,
            'publisher':             publisher,
            'publication_year':      year,
            'published_date':        _full_date(issued),
            'published_online':      _format_date(_date_parts(work.get('published-online'))),
            'published_print':       _format_date(_date_parts(work.get('published-print'))),
            'abstract':              _clean_abstract(work.get('abstract')),
            'language':              _str(work.get('language')),
            'cited_by_count':        work.get('is-referenced-by-count') if isinstance(work.get('is-referenced-by-count'), int) else None,
            'license':               _lines(license_uris),
            'license_uri':           license_uris[0] if license_uris else None,
            'funding':               _lines(
                ', '.join(p for p in [_str(f.get('name'))] + _unique(_str(a) for a in f.get('award') or []) if p)
                for f in funders
            ),
            'funders':               _lines(_unique(_str(f.get('name')) for f in funders)),
            'award_numbers':         ', '.join(_unique(
                _str(a) for f in funders for a in f.get('award') or []
            )) or None,
        }
        values = {k: v for k, v in values.items() if v is not None}

        return FetchedRecord(
            external_id=doi,
            label=title or doi,
            values=values,
            source_url=values.get('doi_url'),
        )