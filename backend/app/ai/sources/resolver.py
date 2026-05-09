from __future__ import annotations
import re
from app.ai.sources.base import SourceResult, SourceFetchError


def resolve_identifier(identifier: str, language: str = 'en') -> SourceResult:
    """
    Resolve a prefixed external identifier to source data.

    Supported formats:
      wikidata:Q42
      viaf:12345
      orcid:0000-0001-2345-6789
      gnd:118540238
      Q42  (bare Wikidata QID, legacy)
    """
    identifier = identifier.strip()

    # Parse prefix:value format
    if ':' in identifier:
        prefix, value = identifier.split(':', 1)
        prefix = prefix.lower().strip()
        value = value.strip()
    else:
        # Legacy bare QID
        prefix = 'wikidata' if re.match(r'^Q\d+$', identifier, re.IGNORECASE) else None
        value = identifier

    if prefix == 'wikidata':
        from app.ai.sources.wikidata import WikidataSource
        return WikidataSource(language=language).fetch_by_id(value)

    if prefix == 'viaf':
        from app.ai.sources.viaf import VIAFSource
        return VIAFSource(language=language).fetch(value)

    if prefix == 'orcid':
        from app.ai.sources.orcid import ORCIDSource
        return ORCIDSource(language=language).fetch(value)

    if prefix == 'gnd':
        from app.ai.sources.gnd import GNDSource
        return GNDSource(language=language).fetch(value)

    raise SourceFetchError(
        identifier,
        f'Unsupported identifier format "{identifier}". '
        'Supported: wikidata:Q42, viaf:12345, orcid:0000-..., gnd:118540238'
    )