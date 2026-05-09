from __future__ import annotations
import requests
from app.ai.sources.base import BaseSource, SourceResult, SourceFetchError

HEADERS = {
    'User-Agent': 'KurbitsArchivalSystem/1.0 (archival description software; contact@kurbits.dev)',
}
TIMEOUT = 8


class VIAFSource(BaseSource):

    def fetch(self, viaf_id: str) -> SourceResult:
        viaf_id = viaf_id.strip()
        try:
            resp = requests.get(
                f'https://viaf.org/viaf/{viaf_id}/viaf.json',
                headers=HEADERS,
                timeout=TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as e:
            raise SourceFetchError('viaf', f'Request failed: {e}')

        # Name
        headings = data.get('mainHeadings', {}).get('data', [])
        if isinstance(headings, list) and headings:
            name = headings[0].get('text', '')
        elif isinstance(headings, dict):
            name = headings.get('text', '')
        else:
            name = f'VIAF {viaf_id}'

        name_type = data.get('nameType', 'Personal')
        birth = data.get('birthDate', '')
        death = data.get('deathDate', '')

        # Alternate names
        x400 = data.get('x400s', {}).get('x400', [])
        if isinstance(x400, dict):
            x400 = [x400]
        aliases = [
            x.get('datafield', {}).get('subfield', {}).get('#text', '')
            for x in x400[:5]
            if isinstance(x, dict)
        ]
        aliases = [a for a in aliases if a and a != name]

        lines = [
            f'VIAF entity: {name} ({viaf_id})',
            f'Type: {name_type}',
        ]
        if birth:
            lines.append(f'Born: {birth}')
        if death:
            lines.append(f'Died: {death}')
        if aliases:
            lines.append(f'Also known as: {", ".join(aliases[:5])}')

        return SourceResult(
            source='viaf',
            label='VIAF',
            url=f'https://viaf.org/viaf/{viaf_id}',
            text='\n'.join(lines),
            structured={
                'viaf_id':   viaf_id,
                'name':      name,
                'name_type': name_type,
                'birth':     birth,
                'death':     death,
                'aliases':   aliases,
            },
            language='en',
        )