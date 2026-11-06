from __future__ import annotations

import re
import urllib.parse
from typing import Any, Iterable, Optional

from ..base import ConfigField, FetchedRecord, SearchHit, SourceError, SourceKey, SourcePlugin
from ..registry import register

MAX_HITS = 20
MAX_LABEL_LOOKUPS = 50
OTHER_LANGS = ('sv', 'en', 'de', 'fr', 'nb', 'da', 'fi')
_QID_RE = re.compile(r'(?:wikidata\.org/(?:wiki|entity)/)?(Q\d+)$', re.IGNORECASE)
_TIME_RE = re.compile(r'^([+-])(\d+)-(\d{2})-(\d{2})')

_ITEM = {'sv': 'Objekt', 'en': 'Item'}
_NAMES = {'sv': 'Namn', 'en': 'Names'}
_DATES = {'sv': 'Datum', 'en': 'Dates'}
_FACTS = {'sv': 'Uppgifter', 'en': 'Facts'}
_IDS = {'sv': 'Identifierare', 'en': 'Identifiers'}


def _k(key: str, sv: str, en: str, group: dict) -> SourceKey:
    return SourceKey(key, {'sv': sv, 'en': en}, group)


_SOURCE_KEYS = (
    _k('wikidata_id',    'Wikidata-id',                 'Wikidata ID',                 _IDS),
    _k('wikidata_url',   'Wikidata-länk',               'Wikidata link',               _IDS),
    _k('viaf',           'VIAF',                        'VIAF',                        _IDS),
    _k('isni',           'ISNI',                        'ISNI',                        _IDS),
    _k('orcid',          'ORCID',                       'ORCID',                       _IDS),
    _k('ror',            'ROR-id',                      'ROR ID',                      _IDS),
    _k('libris',         'Libris-id',                   'Libris ID',                   _IDS),
    _k('gnd',            'GND',                         'GND',                         _IDS),
    _k('lc',             'Library of Congress',         'Library of Congress',         _IDS),
    _k('label',          'Namn',                        'Name',                        _NAMES),
    _k('label_sv',       'Namn (sv)',                   'Name (sv)',                   _NAMES),
    _k('label_en',       'Namn (en)',                   'Name (en)',                   _NAMES),
    _k('labels_other',   'Namn på andra språk',         'Names in other languages',    _NAMES),
    _k('aliases',        'Alternativa namn',            'Aliases',                     _NAMES),
    _k('description',    'Kort beskrivning',            'Short description',           _ITEM),
    _k('description_sv', 'Kort beskrivning (sv)',       'Short description (sv)',      _ITEM),
    _k('description_en', 'Kort beskrivning (en)',       'Short description (en)',      _ITEM),
    _k('instance_of',    'Typ av objekt',               'Instance of',                 _ITEM),
    _k('birth_date',     'Födelsedatum',                'Date of birth',               _DATES),
    _k('death_date',     'Dödsdatum',                   'Date of death',               _DATES),
    _k('inception',      'Grundad',                     'Inception',                   _DATES),
    _k('dissolved',      'Upplöst',                     'Dissolved',                   _DATES),
    _k('date_from',      'Från (född eller grundad)',   'From (born or founded)',      _DATES),
    _k('date_to',        'Till (död eller upplöst)',    'To (died or dissolved)',      _DATES),
    _k('occupations',    'Yrken',                       'Occupations',                 _FACTS),
    _k('employers',      'Arbetsgivare',                'Employers',                   _FACTS),
    _k('citizenship',    'Medborgarskap',               'Citizenship',                 _FACTS),
    _k('country',        'Land',                        'Country',                     _FACTS),
    _k('headquarters',   'Säte',                        'Headquarters',                _FACTS),
    _k('website',        'Webbplats',                   'Website',                     _FACTS),
)

_IDENTIFIER_SUGGESTIONS = (
    {'target': 'identifier', 'sources': ['wikidata_id'], 'scheme': 'Wikidata'},
    {'target': 'identifier', 'sources': ['viaf'], 'scheme': 'VIAF'},
    {'target': 'identifier', 'sources': ['isni'], 'scheme': 'ISNI'},
)


# ─── Helpers ──────────────────────────────────────────────────────────

def normalize_qid(text: Any) -> Optional[str]:
    match = _QID_RE.search(str(text or '').strip())
    return match.group(1).upper() if match else None


def _str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _lines(items: Iterable[Optional[str]]) -> Optional[str]:
    return '\n'.join(i for i in items if i) or None


def _unique(items: Iterable[Optional[str]]) -> list[str]:
    return list(dict.fromkeys(i for i in items if i))


def _claims(entity: dict, prop: str) -> list:
    claims = (entity.get('claims') or {}).get(prop) or []
    ordered = sorted(
        [c for c in claims if isinstance(c, dict) and c.get('rank') != 'deprecated'],
        key=lambda c: 0 if c.get('rank') == 'preferred' else 1,
    )
    values = []
    for claim in ordered:
        snak = claim.get('mainsnak') or {}
        if snak.get('snaktype') != 'value':
            continue
        value = (snak.get('datavalue') or {}).get('value')
        if value is not None:
            values.append(value)
    return values


def _strings(entity: dict, prop: str) -> list[str]:
    return _unique(_str(v) for v in _claims(entity, prop) if isinstance(v, str))


def _first_string(entity: dict, prop: str) -> Optional[str]:
    values = _strings(entity, prop)
    return values[0] if values else None


def _item_ids(entity: dict, prop: str) -> list[str]:
    return _unique(_str(v.get('id')) for v in _claims(entity, prop) if isinstance(v, dict))


def _format_time(value: Any) -> Optional[str]:
    if not isinstance(value, dict):
        return None
    match = _TIME_RE.match(str(value.get('time') or ''))
    if not match:
        return None
    sign, year, month, day = match.groups()
    year_num = int(year)
    if year_num == 0:
        return None
    year_text = f'-{year_num}' if sign == '-' else str(year_num).zfill(4)
    precision = value.get('precision') if isinstance(value.get('precision'), int) else 11
    if precision >= 11 and month != '00' and day != '00':
        return f'{year_text}-{month}-{day}'
    if precision == 10 and month != '00':
        return f'{year_text}-{month}'
    return year_text


def _first_time(entity: dict, prop: str) -> Optional[str]:
    for value in _claims(entity, prop):
        formatted = _format_time(value)
        if formatted:
            return formatted
    return None


def _text_in(container: Any, lang: str) -> Optional[str]:
    if not isinstance(container, dict):
        return None
    entry = container.get(lang)
    return _str(entry.get('value')) if isinstance(entry, dict) else None


# ─── Plugin ───────────────────────────────────────────────────────────

@register
class WikidataPlugin(SourcePlugin):
    key = 'wikidata'
    version = '1.0'
    label = 'Wikidata'
    description = {
        'sv': 'Personer, organisationer och familjer från Wikidata, med namn på flera språk, levnads- och verksamhetsdatum och länkar till andra auktoriteter. Öppet API utan nyckel.',
        'en': 'People, organisations and families from Wikidata, with multilingual names, dates and links to other authorities. Open API, no key required.',
    }
    search_hint = {'sv': 'Namn eller Wikidata-id (Q…)', 'en': 'Name or Wikidata ID (Q…)'}
    supports = frozenset({'agent'})
    config_schema = (
        ConfigField(
            'base_url', {'sv': 'Bas-URL', 'en': 'Base URL'},
            type='url', default='https://www.wikidata.org',
        ),
        ConfigField(
            'language', {'sv': 'Föredraget språk', 'en': 'Preferred language'},
            default='sv', placeholder='sv',
            help={
                'sv': 'Språkkod för namn och beskrivningar. Engelska används om det föredragna språket saknas.',
                'en': 'Language code for names and descriptions. English is used if the preferred language is missing.',
            },
        ),
        ConfigField(
            'contact', {'sv': 'Kontaktadress', 'en': 'Contact address'},
            placeholder='arkiv@example.se',
            help={
                'sv': 'Valfritt men rekommenderat. Wikimedia vill att anrop identifierar sig med en kontaktuppgift.',
                'en': 'Optional but recommended. Wikimedia asks that requests identify themselves with contact details.',
            },
        ),
    )
    suggested_agent_mappings = {
        'person': (
            {'target': 'agent.name',        'sources': ['label']},
            {'target': 'agent.description', 'sources': ['description']},
            {'target': 'agent.date_from',   'sources': ['birth_date']},
            {'target': 'agent.date_to',     'sources': ['death_date']},
            {'target': 'agent.website',     'sources': ['website']},
            {'target': 'identifier',        'sources': ['orcid'], 'scheme': 'ORCID'},
            {'target': 'name_form',         'sources': ['aliases'], 'name_form_type': 'Alternativt namn'},
            *_IDENTIFIER_SUGGESTIONS,
        ),
        'organization': (
            {'target': 'agent.name',        'sources': ['label']},
            {'target': 'agent.description', 'sources': ['description']},
            {'target': 'agent.date_from',   'sources': ['inception']},
            {'target': 'agent.date_to',     'sources': ['dissolved']},
            {'target': 'agent.website',     'sources': ['website']},
            {'target': 'identifier',        'sources': ['ror'], 'scheme': 'ROR'},
            {'target': 'name_form',         'sources': ['labels_other'], 'name_form_type': 'Namn på annat språk'},
            {'target': 'name_form',         'sources': ['aliases'], 'name_form_type': 'Alternativt namn'},
            *_IDENTIFIER_SUGGESTIONS,
        ),
        'family': (
            {'target': 'agent.name',        'sources': ['label']},
            {'target': 'agent.description', 'sources': ['description']},
            {'target': 'identifier',        'sources': ['wikidata_id'], 'scheme': 'Wikidata'},
            {'target': 'name_form',         'sources': ['aliases'], 'name_form_type': 'Alternativt namn'},
        ),
        'software': (
            {'target': 'agent.name',        'sources': ['label']},
            {'target': 'agent.description', 'sources': ['description']},
            {'target': 'agent.date_from',   'sources': ['inception']},
            {'target': 'agent.website',     'sources': ['website']},
            {'target': 'identifier',        'sources': ['wikidata_id'], 'scheme': 'Wikidata'},
        ),
    }

    @property
    def lang(self) -> str:
        return (str(self.config.get('language') or 'sv').strip().lower() or 'sv')[:10]

    def request_headers(self) -> dict:
        contact = _str(self.config.get('contact'))
        agent = 'Kurbits/1.0 (archival description system' + (f'; {contact}' if contact else '') + ')'
        return {'User-Agent': agent}

    def source_keys(self) -> list[SourceKey]:
        return list(_SOURCE_KEYS)

    def search(self, query: str) -> list[SearchHit]:
        q = (query or '').strip()
        if len(q) < 2:
            return []

        qid = normalize_qid(q)
        if qid:
            entity = self._get_entity(qid)
            if entity is None:
                return []
            label = self._label(entity) or qid
            return [SearchHit(qid, label, self._description(entity))]

        params = {
            'action': 'wbsearchentities', 'search': q, 'language': self.lang,
            'uselang': self.lang, 'type': 'item', 'limit': MAX_HITS, 'format': 'json',
        }
        data = self.get_json(f'{self.url("w/api.php")}?{urllib.parse.urlencode(params)}')
        items = data.get('search') if isinstance(data, dict) else None
        hits: list[SearchHit] = []
        for item in items or []:
            if not isinstance(item, dict):
                continue
            qid = normalize_qid(item.get('id'))
            if qid:
                hits.append(SearchHit(qid, _str(item.get('label')) or qid, _str(item.get('description'))))
        return hits

    def fetch(self, external_id: str) -> FetchedRecord:
        qid = normalize_qid(external_id)
        entity = self._get_entity(qid) if qid else None
        if entity is None:
            raise SourceError(f'Wikidata item {external_id} not found', 404)
        return self._to_record(entity)

    # ─── Internals ────────────────────────────────────────────────────

    def _get_entity(self, qid: str) -> Optional[dict]:
        data = self.get_json(self.url(f'wiki/Special:EntityData/{qid}.json'), allow_missing=True)
        entities = data.get('entities') if isinstance(data, dict) else None
        if not isinstance(entities, dict):
            return None
        for entity in entities.values():
            if isinstance(entity, dict) and entity.get('id'):
                return entity
        return None

    def _label(self, entity: dict) -> Optional[str]:
        labels = entity.get('labels')
        return _text_in(labels, self.lang) or _text_in(labels, 'en') or next(
            (_str(v.get('value')) for v in (labels or {}).values() if isinstance(v, dict)), None
        )

    def _description(self, entity: dict) -> Optional[str]:
        descriptions = entity.get('descriptions')
        return _text_in(descriptions, self.lang) or _text_in(descriptions, 'en')

    def _labels_for(self, qids: list[str]) -> dict[str, str]:
        qids = _unique(qids)[:MAX_LABEL_LOOKUPS]
        if not qids:
            return {}
        params = {
            'action': 'wbgetentities', 'ids': '|'.join(qids), 'props': 'labels',
            'languages': f'{self.lang}|en', 'format': 'json',
        }
        try:
            data = self.get_json(f'{self.url("w/api.php")}?{urllib.parse.urlencode(params)}')
        except SourceError:
            return {}
        result: dict[str, str] = {}
        for qid, entity in ((data or {}).get('entities') or {}).items():
            if isinstance(entity, dict):
                label = _text_in(entity.get('labels'), self.lang) or _text_in(entity.get('labels'), 'en')
                if label:
                    result[qid] = label
        return result

    def _to_record(self, entity: dict) -> FetchedRecord:
        qid = _str(entity.get('id'))
        label = self._label(entity)
        labels = entity.get('labels') if isinstance(entity.get('labels'), dict) else {}
        aliases = entity.get('aliases') if isinstance(entity.get('aliases'), dict) else {}

        alias_values = _unique(
            _str(a.get('value'))
            for lang in (self.lang, 'en')
            for a in aliases.get(lang) or [] if isinstance(a, dict)
        )
        other_labels = _unique(
            f'{_text_in(labels, lang)} ({lang})'
            for lang in OTHER_LANGS
            if _text_in(labels, lang) and _text_in(labels, lang) != label
        )

        refs = {
            'instance_of':  _item_ids(entity, 'P31'),
            'occupations':  _item_ids(entity, 'P106'),
            'employers':    _item_ids(entity, 'P108'),
            'citizenship':  _item_ids(entity, 'P27'),
            'country':      _item_ids(entity, 'P17'),
            'headquarters': _item_ids(entity, 'P159'),
        }
        names = self._labels_for([q for ids in refs.values() for q in ids])

        def labelled(key: str) -> Optional[str]:
            return _lines(names.get(q, q) for q in refs[key])

        birth = _first_time(entity, 'P569')
        death = _first_time(entity, 'P570')
        inception = _first_time(entity, 'P571')
        dissolved = _first_time(entity, 'P576')

        values = {
            'wikidata_id':    qid,
            'wikidata_url':   f'https://www.wikidata.org/wiki/{qid}' if qid else None,
            'viaf':           _first_string(entity, 'P214'),
            'isni':           _first_string(entity, 'P213'),
            'orcid':          _first_string(entity, 'P496'),
            'ror':            _first_string(entity, 'P6782'),
            'libris':         _first_string(entity, 'P906'),
            'gnd':            _first_string(entity, 'P227'),
            'lc':             _first_string(entity, 'P244'),
            'label':          label,
            'label_sv':       _text_in(labels, 'sv'),
            'label_en':       _text_in(labels, 'en'),
            'labels_other':   _lines(other_labels),
            'aliases':        _lines(alias_values),
            'description':    self._description(entity),
            'description_sv': _text_in(entity.get('descriptions'), 'sv'),
            'description_en': _text_in(entity.get('descriptions'), 'en'),
            'instance_of':    labelled('instance_of'),
            'birth_date':     birth,
            'death_date':     death,
            'inception':      inception,
            'dissolved':      dissolved,
            'date_from':      birth or inception,
            'date_to':        death or dissolved,
            'occupations':    labelled('occupations'),
            'employers':      labelled('employers'),
            'citizenship':    labelled('citizenship'),
            'country':        labelled('country'),
            'headquarters':   labelled('headquarters'),
            'website':        _first_string(entity, 'P856'),
        }
        values = {k: v for k, v in values.items() if v is not None}
        return FetchedRecord(
            external_id=qid,
            label=label or qid,
            values=values,
            source_url=values.get('wikidata_url'),
        )