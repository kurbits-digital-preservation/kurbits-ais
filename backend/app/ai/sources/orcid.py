from __future__ import annotations
import requests
from app.ai.sources.base import BaseSource, SourceResult, SourceFetchError

HEADERS = {
    'User-Agent': 'KurbitsArchivalSystem/1.0 (archival description software; contact@kurbits.dev)',
    'Accept': 'application/json',
}
TIMEOUT = 8


class ORCIDSource(BaseSource):

    def fetch(self, orcid_id: str) -> SourceResult:
        orcid_id = orcid_id.strip()
        try:
            resp = requests.get(
                f'https://pub.orcid.org/v3.0/{orcid_id}/record',
                headers=HEADERS,
                timeout=TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as e:
            raise SourceFetchError('orcid', f'Request failed: {e}')

        person = data.get('person', {})
        name_data = person.get('name', {}) or {}
        given  = (name_data.get('given-names') or {}).get('value', '')
        family = (name_data.get('family-name') or {}).get('value', '')
        credit = (name_data.get('credit-name') or {}).get('value', '')
        name   = credit or ' '.join(filter(None, [given, family])) or orcid_id

        biography = (person.get('biography') or {}).get('content', '')

        keywords = [
            kw.get('content', '')
            for kw in (person.get('keywords', {}) or {}).get('keyword', [])
        ]

        employments = data.get('activities-summary', {}) \
                         .get('employments', {}) \
                         .get('affiliation-group', [])
        if isinstance(employments, dict):
            employments = [employments]
        orgs = []
        for emp in employments[:3]:
            summaries = emp.get('summaries', [])
            for s in summaries:
                org = s.get('employment-summary', {}).get('organization', {}).get('name')
                if org:
                    orgs.append(org)

        lines = [f'ORCID record: {name} ({orcid_id})']
        if biography:
            lines.append(f'Biography: {biography[:500]}')
        if keywords:
            lines.append(f'Keywords: {", ".join(keywords[:8])}')
        if orgs:
            lines.append(f'Affiliated with: {", ".join(orgs)}')

        return SourceResult(
            source='orcid',
            label='ORCID',
            url=f'https://orcid.org/{orcid_id}',
            text='\n'.join(lines),
            structured={
                'orcid_id':    orcid_id,
                'name':        name,
                'biography':   biography,
                'keywords':    keywords,
                'affiliations': orgs,
            },
            language='en',
        )