from __future__ import annotations
import requests
from app.ai.sources.base import BaseSource, SourceResult, SourceFetchError

HEADERS = {
    'User-Agent': 'KurbitsArchivalSystem/1.0 (archival description software; contact@kurbits.dev)',
    'Accept': 'application/json',
}
TIMEOUT = 8


class GNDSource(BaseSource):

    def fetch(self, gnd_id: str) -> SourceResult:
        gnd_id = gnd_id.strip()
        try:
            resp = requests.get(
                f'https://lobid.org/gnd/{gnd_id}.json',
                headers=HEADERS,
                timeout=TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as e:
            raise SourceFetchError('gnd', f'Request failed: {e}')

        # Name — preferredName is the authorized form
        name = data.get('preferredName', gnd_id)

        # Variant names
        aliases = data.get('variantName', [])
        if isinstance(aliases, str):
            aliases = [aliases]

        # Dates
        birth = data.get('dateOfBirth', [None])[0] if data.get('dateOfBirth') else None
        death = data.get('dateOfDeath', [None])[0] if data.get('dateOfDeath') else None

        # Type
        entity_types = [
            t.get('label', '') for t in data.get('type', [])
            if isinstance(t, dict)
        ]
        if not entity_types:
            entity_types = data.get('type', [])

        # Biographical info
        biography = ' '.join(data.get('biographicalOrHistoricalInformation', []))

        # Occupations / fields
        occupations = [
            o.get('label', '') for o in data.get('professionOrOccupation', [])
            if isinstance(o, dict) and o.get('label')
        ]

        # Places
        places = [
            p.get('label', '') for p in (
                data.get('placeOfBirth', []) + data.get('placeOfDeath', [])
            )
            if isinstance(p, dict) and p.get('label')
        ]

        lines = [f'GND entity: {name} ({gnd_id})']
        if entity_types:
            lines.append(f'Type: {", ".join(str(t) for t in entity_types[:3])}')
        if birth:
            lines.append(f'Born: {birth}')
        if death:
            lines.append(f'Died: {death}')
        if places:
            lines.append(f'Places: {", ".join(places[:3])}')
        if occupations:
            lines.append(f'Occupation: {", ".join(occupations[:3])}')
        if biography:
            lines.append(f'Biography: {biography[:500]}')
        if aliases:
            lines.append(f'Also known as: {", ".join(aliases[:5])}')

        return SourceResult(
            source='gnd',
            label='GND',
            url=f'https://d-nb.info/gnd/{gnd_id}',
            text='\n'.join(lines),
            structured={
                'gnd_id':      gnd_id,
                'name':        name,
                'aliases':     aliases,
                'birth':       birth,
                'death':       death,
                'biography':   biography,
                'occupations': occupations,
            },
            language='en',
        )