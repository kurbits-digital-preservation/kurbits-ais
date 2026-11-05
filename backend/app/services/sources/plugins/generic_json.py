from __future__ import annotations

from typing import Any, Optional

from ..base import (
    ConfigField, FetchedRecord, SearchHit, SourceError, SourceKey, SourcePlugin,
    is_empty, resolve_path, to_text,
)
from ..registry import register

MAX_HITS = 25


@register
class GenericJsonPlugin(SourcePlugin):
    key = 'generic_json'
    version = '1.0'
    label = {'sv': 'Generiskt JSON-API', 'en': 'Generic JSON API'}
    description = {
        'sv': 'Valfritt JSON-API med en sökning och ett anrop per post. Källnycklar definieras i fältmappningen.',
        'en': 'Any JSON API with one search call and one call per record. Source keys are defined in the field mapping.',
    }
    search_hint = {'sv': 'Sök…', 'en': 'Search…'}
    config_schema = (
        ConfigField('base_url', {'sv': 'Bas-URL', 'en': 'Base URL'}, type='url', required=True,
                    placeholder='https://api.example.com'),
        ConfigField('search_path', {'sv': 'Söksökväg', 'en': 'Search path'}, required=True,
                    placeholder='search?q={query}',
                    help={'sv': 'Använd {query} som platshållare.', 'en': 'Use {query} as placeholder.'}),
        ConfigField('result_path', {'sv': 'Resultatsökväg', 'en': 'Result path'},
                    placeholder='hits.items',
                    help={'sv': 'Punktsökväg till listan med träffar. Tomt om svaret redan är en lista.',
                          'en': 'Dot-path to the list of hits. Empty if the response already is a list.'}),
        ConfigField('id_path', {'sv': 'ID-sökväg', 'en': 'ID path'}, required=True, placeholder='id',
                    help={'sv': 'Punktsökväg till postens ID i varje träff.',
                          'en': 'Dot-path to the record ID in each hit.'}),
        ConfigField('label_path', {'sv': 'Etikettsökväg', 'en': 'Label path'}, placeholder='title'),
        ConfigField('fetch_path', {'sv': 'Hämtsökväg', 'en': 'Fetch path'}, placeholder='records/{id}',
                    help={'sv': 'Använd {id} som platshållare. Tomt betyder att posten tas från sökträffen.',
                          'en': 'Use {id} as placeholder. Empty means the record is taken from the search hit.'}),
        ConfigField('headers', {'sv': 'Headers (JSON)', 'en': 'Headers (JSON)'}, type='json', secret=True,
                    placeholder='{"Authorization": "Bearer …"}'),
        ConfigField('field_mappings', {'sv': 'Källnycklar (JSON)', 'en': 'Source keys (JSON)'},
                    type='json', required=True,
                    placeholder='{\n  "title": "project.title",\n  "start_date": "project.start"\n}',
                    help={'sv': 'Varje nyckel blir en källnyckel som kan mappas på hierarkinivåer. Värdet är en punktsökväg i posten.',
                          'en': 'Each key becomes a source key that can be mapped on hierarchy levels. The value is a dot-path in the record.'}),
    )

    def request_headers(self) -> dict:
        headers = self.config.get('headers')
        return headers if isinstance(headers, dict) else {}

    def _mappings(self) -> dict[str, str]:
        raw = self.config.get('field_mappings')
        if not isinstance(raw, dict):
            return {}
        return {
            str(k).strip(): str(v).strip()
            for k, v in raw.items()
            if str(k).strip() and v not in (None, '')
        }

    def source_keys(self) -> list[SourceKey]:
        return [SourceKey(key, key) for key in self._mappings()]

    def search(self, query: str) -> list[SearchHit]:
        q = (query or '').strip()
        if not q:
            return []
        raw = self.get_json(self.url(str(self.config['search_path']).replace('{query}', self.quote(q))))

        hits: list[SearchHit] = []
        for item in self._items(raw):
            external_id = to_text(resolve_path(item, self.config.get('id_path')))
            if not external_id:
                continue
            label = to_text(resolve_path(item, self.config.get('label_path'))) or external_id
            hits.append(SearchHit(external_id, label))
            if len(hits) >= MAX_HITS:
                break
        return hits

    def fetch(self, external_id: str) -> FetchedRecord:
        ext = (external_id or '').strip()
        if not ext:
            raise SourceError('external_id is required', 400)
        item = self._fetch_item(ext)
        if item is None:
            raise SourceError(f'Record {ext} not found', 404)

        values = {}
        for key, path in self._mappings().items():
            value = resolve_path(item, path)
            if not is_empty(value):
                values[key] = value

        label = to_text(resolve_path(item, self.config.get('label_path'))) or ext
        return FetchedRecord(external_id=ext, label=label, values=values)

    def _fetch_item(self, ext: str) -> Optional[dict]:
        fetch_path = self.config.get('fetch_path')
        if fetch_path:
            raw = self.get_json(self.url(str(fetch_path).replace('{id}', self.quote(ext))), allow_missing=True)
            return raw if isinstance(raw, dict) else None

        raw = self.get_json(self.url(str(self.config['search_path']).replace('{query}', self.quote(ext))))
        for item in self._items(raw):
            if to_text(resolve_path(item, self.config.get('id_path'))) == ext:
                return item
        return None

    def _items(self, raw: Any) -> list[dict]:
        result_path = self.config.get('result_path')
        items = resolve_path(raw, result_path) if result_path else raw
        if isinstance(items, dict):
            items = [items]
        if not isinstance(items, list):
            return []
        return [i for i in items if isinstance(i, dict)]