from __future__ import annotations

from datetime import date
from typing import List, Optional, TypedDict


class CitationInput(TypedDict, total=False):
    title: str
    ref_code: str
    institution_name: str
    country_code: str
    date_start: Optional[str]
    date_end: Optional[str]
    collection_title: Optional[str]
    creators: List[str]


# --- Helpers ---

def _year(iso_date: Optional[str]) -> Optional[str]:
    return iso_date[:4] if iso_date else None


def _date_display(date_start: Optional[str], date_end: Optional[str]) -> str:
    start = _year(date_start)
    end = _year(date_end)
    if not start and not end:
        return 'n.d.'
    if not end or end == start:
        return start or 'n.d.'
    return f'{start}–{end}'


def _format_creators(creators: List[str], max_named: int = 3) -> str:
    if not creators:
        return ''
    if len(creators) <= max_named:
        return '; '.join(creators)
    return f'{creators[0]} et al.'


# --- Public entry point ---

def build_citation(data: CitationInput, include_access_date: bool = False) -> dict:
    title = data.get('title') or 'Untitled'
    ref_code = data.get('ref_code') or ''
    institution_name = data.get('institution_name') or ''
    collection_title = data.get('collection_title') or ''
    creators = data.get('creators') or []

    date_display = _date_display(data.get('date_start'), data.get('date_end'))
    creators_str = _format_creators(creators)

    access_note = f' Accessed {date.today().isoformat()}.' if include_access_date else ''

    # Chicago, archival note form:
    # Creator. "Item title." Date. Collection title. Ref code. Repository.
    chicago_parts = []
    if creators_str:
        chicago_parts.append(f'{creators_str}.')
    chicago_parts.append(f'"{title}."')
    chicago_parts.append(f'{date_display}.')
    if collection_title and collection_title != title:
        chicago_parts.append(f'{collection_title}.')
    if ref_code:
        chicago_parts.append(f'{ref_code}.')
    if institution_name:
        chicago_parts.append(f'{institution_name}.')
    chicago = ' '.join(chicago_parts) + access_note

    # APA (7th ed.), archival material:
    # Creator. (Date). Title [Archival material]. Repository. Ref code.
    apa_parts = []
    if creators_str:
        apa_parts.append(f'{creators_str}.')
    apa_parts.append(f'({date_display}).')
    apa_parts.append(f'{title} [Archival material].')
    if institution_name:
        apa_parts.append(f'{institution_name}.')
    if ref_code:
        apa_parts.append(f'{ref_code}.')
    apa = ' '.join(apa_parts) + access_note

    # ISAD(G) reference citation:
    # Ref code, Repository, "Title" (Date).
    isad_parts = [p for p in [ref_code, institution_name, f'"{title}"', f'({date_display})'] if p]
    isad = ', '.join(isad_parts) + '.' + access_note

    return {
        'chicago': chicago,
        'apa': apa,
        'isad': isad,
        'fields': {
            'title': title,
            'ref_code': ref_code,
            'institution_name': institution_name,
            'date_display': date_display,
            'creators': creators,
        },
    }