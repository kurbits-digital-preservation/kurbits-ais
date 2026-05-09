from __future__ import annotations
import requests
from app.ai.sources.base import BaseSource, SourceResult, SourceFetchError

WIKIDATA_SEARCH = 'https://www.wikidata.org/w/api.php'
WIKIDATA_ENTITY = 'https://www.wikidata.org/wiki/Special:EntityData/{}.json'
HEADERS = {
    'User-Agent': 'KurbitsArchivalSystem/1.0 (archival description software; contact@kurbits.net)',
}
# Property IDs we care about for archival context
PROPS = {
    'P569':  'date of birth',
    'P570':  'date of death',
    'P571':  'inception',
    'P576':  'dissolved',
    'P18':   'image',
    'P21':   'sex or gender',
    'P27':   'country of citizenship',
    'P106':  'occupation',
    'P39':   'position held',
    'P69':   'educated at',
    'P108':  'employer',
    'P166':  'award received',
    'P856':  'official website',
    'P17':   'country',
    'P131':  'located in',
    'P571':  'inception date',
    'P576':  'dissolution date',
}

TIMEOUT = 8


class WikidataSource(BaseSource):

    def fetch(self, query: str) -> SourceResult:
        entity_id = self._search(query)
        if not entity_id:
            raise SourceFetchError('wikidata', f'No entity found for "{query}"')
        return self._fetch_entity(entity_id)

    def _search(self, query: str) -> str | None:
        try:
            resp = requests.get(WIKIDATA_SEARCH, params={
                'action':      'wbsearchentities',
                'search':      query,
                'language':    self.language,
                'fallbacklang': 'en',
                'format':      'json',
                'limit':       1,
                'type':        'item',
            }, headers=HEADERS, timeout=TIMEOUT)
            resp.raise_for_status()
            results = resp.json().get('search', [])
            return results[0]['id'] if results else None
        except requests.RequestException as e:
            raise SourceFetchError('wikidata', f'Search request failed: {e}')

    def _fetch_entity(self, entity_id: str) -> SourceResult:
        try:
            resp = requests.get(
                WIKIDATA_ENTITY.format(entity_id),
                headers=HEADERS, timeout=TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as e:
            raise SourceFetchError('wikidata', f'Entity fetch failed: {e}')

        entity = data['entities'][entity_id]
        lang = self.language

        # ── Labels and description ────────────────────────────────────
        labels = entity.get('labels', {})
        label = (
            labels.get(lang, {}).get('value')
            or labels.get('en', {}).get('value')
            or entity_id
        )

        descriptions = entity.get('descriptions', {})
        description = (
            descriptions.get(lang, {}).get('value')
            or descriptions.get('en', {}).get('value')
            or ''
        )

        # ── Aliases ───────────────────────────────────────────────────
        aliases_raw = entity.get('aliases', {})
        aliases = [
            a['value'] for a in (
                aliases_raw.get(lang, []) or aliases_raw.get('en', [])
            )
        ]

        # ── Claims (properties) ───────────────────────────────────────
        claims = entity.get('claims', {})
        extracted: dict[str, list[str]] = {}

        for prop_id, prop_label in PROPS.items():
            if prop_id not in claims:
                continue
            values = []
            for snak in claims[prop_id]:
                val = self._extract_snak_value(snak.get('mainsnak', {}))
                if val:
                    values.append(val)
            if values:
                extracted[prop_label] = values

        # ── Build plain-text context ──────────────────────────────────
        lines = [f'Wikidata entity: {label} ({entity_id})']
        if description:
            lines.append(f'Description: {description}')
        if aliases:
            lines.append(f'Also known as: {", ".join(aliases[:5])}')
        for prop, vals in extracted.items():
            lines.append(f'{prop.capitalize()}: {", ".join(vals[:3])}')

        structured = {
            'entity_id':   entity_id,
            'label':       label,
            'description': description,
            'aliases':     aliases,
            'properties':  extracted,
        }

        return SourceResult(
            source='wikidata',
            label='Wikidata',
            url=f'https://www.wikidata.org/wiki/{entity_id}',
            text='\n'.join(lines),
            structured=structured,
            language=lang,
        )

    def _extract_snak_value(self, snak: dict) -> str | None:
        datavalue = snak.get('datavalue', {})
        dtype = datavalue.get('type')
        value = datavalue.get('value')

        if dtype == 'string':
            return str(value)
        if dtype == 'monolingualtext':
            return value.get('text')
        if dtype == 'quantity':
            return value.get('amount')
        if dtype == 'time':
            # Format: +1809-02-12T00:00:00Z
            raw = value.get('time', '')
            # Strip leading + and time part
            return raw.lstrip('+').split('T')[0] if raw else None
        if dtype == 'wikibase-entityid':
            # Resolve label for linked entities
            linked_id = value.get('id')
            if linked_id:
                return self._resolve_label(linked_id)
        return None

    def _resolve_label(self, entity_id: str) -> str | None:
        """Fetch the label for a linked entity (e.g. occupation, country)."""
        try:
            resp = requests.get(WIKIDATA_SEARCH, params={
                'action':   'wbgetentities',
                'ids':      entity_id,
                'props':    'labels',
                'languages': f'{self.language}|en',
                'format':   'json',
            }, headers=HEADERS, timeout=4)
            resp.raise_for_status()
            entity = resp.json().get('entities', {}).get(entity_id, {})
            labels = entity.get('labels', {})
            return (
                labels.get(self.language, {}).get('value')
                or labels.get('en', {}).get('value')
            )
        except Exception:
            return entity_id

    def fetch_by_id(self, entity_id: str) -> SourceResult:
        """Fetch directly by Wikidata QID — no search, no ambiguity."""
        return self._fetch_entity(entity_id.strip())