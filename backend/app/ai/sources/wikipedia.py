from __future__ import annotations
import requests
from app.ai.sources.base import BaseSource, SourceResult, SourceFetchError

WIKIPEDIA_API = 'https://{lang}.wikipedia.org/w/api.php'
SUMMARY_CHARS = 1500
TIMEOUT = 8

HEADERS = {
    'User-Agent': 'KurbitsArchivalSystem/1.0 (archival description software; contact@kurbits.dev)',
}

class WikipediaSource(BaseSource):

    def fetch(self, query: str) -> SourceResult:
        # Try preferred language first, fall back to English
        for lang in self._langs():
            try:
                return self._fetch_in_lang(query, lang)
            except SourceFetchError:
                continue
        raise SourceFetchError('wikipedia', f'No article found for "{query}"')

    def _langs(self) -> list[str]:
        if self.language == 'en':
            return ['en']
        return [self.language, 'en']

    def _fetch_in_lang(self, query: str, lang: str) -> SourceResult:
        base = WIKIPEDIA_API.format(lang=lang)

        # Search for the best matching article title
        try:
            search_resp = requests.get(base, params={
                'action':   'query',
                'list':     'search',
                'srsearch': query,
                'srlimit':  1,
                'format':   'json',
            },headers=HEADERS, timeout=TIMEOUT)
            search_resp.raise_for_status()
            results = search_resp.json().get('query', {}).get('search', [])
        except requests.RequestException as e:
            raise SourceFetchError('wikipedia', f'Search failed: {e}')

        if not results:
            raise SourceFetchError('wikipedia', f'No results in {lang} for "{query}"')

        title = results[0]['title']

        # Fetch the extract
        try:
            extract_resp = requests.get(base, params={
                'action':      'query',
                'prop':        'extracts|info',
                'titles':      title,
                'exintro':     True,
                'explaintext': True,
                'inprop':      'url',
                'format':      'json',
            }, headers=HEADERS, timeout=TIMEOUT)
            extract_resp.raise_for_status()
            pages = extract_resp.json().get('query', {}).get('pages', {})
        except requests.RequestException as e:
            raise SourceFetchError('wikipedia', f'Extract fetch failed: {e}')

        page = next(iter(pages.values()))
        if 'missing' in page:
            raise SourceFetchError('wikipedia', f'Article "{title}" not found in {lang}')

        extract = page.get('extract', '').strip()
        # Trim to avoid blowing out the context window
        if len(extract) > SUMMARY_CHARS:
            extract = extract[:SUMMARY_CHARS].rsplit(' ', 1)[0] + '…'

        canonical_url = page.get('canonicalurl', f'https://{lang}.wikipedia.org/wiki/{title}')

        return SourceResult(
            source='wikipedia',
            label=f'Wikipedia ({lang})',
            url=canonical_url,
            text=f'Wikipedia article: {title}\n\n{extract}',
            structured={
                'title':    title,
                'extract':  extract,
                'language': lang,
            },
            language=lang,
        )