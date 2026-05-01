"""
EAD 2002 import.

Parses an EAD 2002 XML file and creates new Kurbits nodes.
Always creates new nodes — never updates existing ones.
Agents in <origination> are skipped (will be handled by EAC import later).
"""
from __future__ import annotations
from datetime import date, datetime
from typing import Optional
from lxml import etree
from app.extensions import db
from app.models.node import Node, NodeStatus
from app.models.hierarchy import HierarchyType, HierarchyLevel


EAD_NS = 'urn:isbn:1-931666-22-9'
# Some EAD files have no namespace at all
NSMAP_VARIANTS = [
    f'{{{EAD_NS}}}{{}}',   # namespaced
    '{}',                   # no namespace
]


class EADImportError(Exception):
    pass


class ImportResult:
    def __init__(self):
        self.created: list[dict] = []   # [{'title': ..., 'ref_code': ...}]
        self.warnings: list[str] = []
        self.skipped: list[str] = []

    def to_dict(self) -> dict:
        return {
            'created': self.created,
            'warnings': self.warnings,
            'skipped': self.skipped,
            'total_created': len(self.created),
        }


def _find(el: etree._Element, tag: str) -> Optional[etree._Element]:
    """Find child element, trying with and without EAD namespace."""
    found = el.find(f'{{{EAD_NS}}}{tag}')
    if found is None:
        found = el.find(tag)
    return found


def _findall(el: etree._Element, tag: str) -> list[etree._Element]:
    results = el.findall(f'{{{EAD_NS}}}{tag}')
    if not results:
        results = el.findall(tag)
    return results


def _text(el: Optional[etree._Element]) -> Optional[str]:
    if el is None:
        return None
    # Collect all text including tail text of child elements
    parts = []
    if el.text:
        parts.append(el.text.strip())
    for child in el:
        if child.text:
            parts.append(child.text.strip())
        if child.tail:
            parts.append(child.tail.strip())
    return ' '.join(p for p in parts if p) or None


def _p_text(el: Optional[etree._Element]) -> Optional[str]:
    """Collect text from all <p> children."""
    if el is None:
        return None
    paragraphs = _findall(el, 'p')
    if paragraphs:
        return '\n\n'.join(p for p in [_text(p) for p in paragraphs] if p)
    return _text(el)


def _parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    for fmt in ('%Y-%m-%d', '%Y-%m', '%Y'):
        try:
            return datetime.strptime(s[:len(fmt)], fmt).date()
        except ValueError:
            continue
    return None


def _parse_normal_date(normal: Optional[str]) -> tuple[Optional[date], Optional[date]]:
    """Parse EAD @normal date range like '1920/1945' or '1920-01-01/1945-12-31'."""
    if not normal:
        return None, None
    if '/' in normal:
        parts = normal.split('/', 1)
        return _parse_date(parts[0]), _parse_date(parts[1])
    return _parse_date(normal), None


# EAD level → Kurbits level name (best-effort matching)
EAD_LEVEL_MAP = {
    'fonds':     'Fonds',
    'subfonds':  'Sub-fonds',
    'series':    'Series',
    'subseries': 'Sub-series',
    'file':      'File',
    'item':      'Item',
    'collection':'Collection',
    'recordgrp': 'Fonds',
    'subgrp':    'Sub-fonds',
    'class':     'Class',
}


def _resolve_level(ead_level: str, otherlevel: Optional[str],
                   hierarchy_type: HierarchyType,
                   result: ImportResult) -> Optional[str]:
    """Map EAD @level to a level name that exists in the hierarchy type."""
    available = {l.name.lower(): l.name for l in hierarchy_type.levels}

    # Try otherlevel first (most specific)
    if otherlevel and otherlevel.lower() in available:
        return available[otherlevel.lower()]

    # Try the EAD level map
    mapped = EAD_LEVEL_MAP.get(ead_level.lower())
    if mapped and mapped.lower() in available:
        return available[mapped.lower()]

    # Try the raw EAD level name directly
    if ead_level.lower() in available:
        return available[ead_level.lower()]

    # Fall back to first available level with a warning
    if hierarchy_type.levels:
        fallback = sorted(hierarchy_type.levels, key=lambda l: l.sort_order)[0].name
        result.warnings.append(
            f'EAD level "{ead_level}" not found in hierarchy — using "{fallback}"'
        )
        return fallback

    return None


def _parse_did(did: etree._Element) -> dict:
    """Extract fields from a <did> element."""
    data: dict = {}

    # Title
    unittitle = _find(did, 'unittitle')
    data['title'] = _text(unittitle) or 'Untitled'

    # Unit IDs — prefer the one without a label, or the first one
    unitids = _findall(did, 'unitid')
    local_ref = None
    for uid in unitids:
        label = uid.get('label', '').lower()
        if label in ('', 'ref', 'local reference', 'local ref'):
            local_ref = (uid.text or '').strip()
            break
    if not local_ref and unitids:
        local_ref = (unitids[0].text or '').strip()
    data['local_ref'] = local_ref or ''

    # Date
    unitdate = _find(did, 'unitdate')
    if unitdate is not None:
        normal = unitdate.get('normal')
        date_start, date_end = _parse_normal_date(normal)
        if not date_start:
            # Try parsing the text content as a year
            date_start = _parse_date((unitdate.text or '').strip()[:4])
        data['date_start'] = date_start
        data['date_end'] = date_end
        certainty = unitdate.get('certainty')
        if certainty:
            data['date_certainty'] = certainty

    # Extent
    physdesc = _find(did, 'physdesc')
    if physdesc is not None:
        extent_el = _find(physdesc, 'extent')
        data['extent'] = _text(extent_el) or _text(physdesc)

    # Language
    langmaterial = _find(did, 'langmaterial')
    if langmaterial is not None:
        lang_el = _find(langmaterial, 'language')
        if lang_el is not None:
            data['language'] = lang_el.text or lang_el.get('langcode', '')
        else:
            data['language'] = _text(langmaterial)

    return data


def _parse_component(el: etree._Element, institution_id: int,
                     hierarchy_type: HierarchyType,
                     parent_node: Optional[Node],
                     created_by_id: int,
                     result: ImportResult,
                     depth: int = 0) -> Optional[Node]:
    """Recursively parse an <archdesc> or <c> element into a Node."""

    ead_level = el.get('level', 'otherlevel')
    otherlevel = el.get('otherlevel')

    level_name = _resolve_level(ead_level, otherlevel, hierarchy_type, result)
    if not level_name:
        result.warnings.append(f'Could not resolve level for element, skipping')
        return None

    did = _find(el, 'did')
    if did is None:
        result.warnings.append(f'Component has no <did>, skipping')
        return None

    did_data = _parse_did(did)

    # Build ref code
    local_ref = did_data.get('local_ref') or f'imported-{datetime.now().timestamp():.0f}'

    # Ensure local_ref is unique under parent
    existing_siblings = (
        Node.query.filter_by(parent_id=parent_node.id if parent_node else None,
                             institution_id=institution_id)
        .with_entities(Node.local_ref).all()
    )
    sibling_refs = {r[0] for r in existing_siblings}
    if local_ref in sibling_refs:
        base = local_ref
        i = 1
        while f'{base}-{i}' in sibling_refs:
            i += 1
        local_ref = f'{base}-{i}'
        result.warnings.append(
            f'Local ref "{did_data.get("local_ref")}" already exists — using "{local_ref}"'
        )

    node = Node(
        institution_id=institution_id,
        title=did_data['title'],
        local_ref=local_ref,
        level_of_description=level_name,
        hierarchy_type_id=hierarchy_type.id,
        parent=parent_node,
        date_start=did_data.get('date_start'),
        date_end=did_data.get('date_end'),
        date_certainty=did_data.get('date_certainty'),
        extent=did_data.get('extent'),
        language=did_data.get('language'),
        status=NodeStatus.DRAFT,
        created_by_id=created_by_id,
        updated_by_id=created_by_id,
        metadata_spec={},
    )

    # Narrative fields from archdesc/c children
    scopecontent = _find(el, 'scopecontent')
    node.scope_and_content = _p_text(scopecontent)

    arrangement = _find(el, 'arrangement')
    node.arrangement = _p_text(arrangement)

    accessrestrict = _find(el, 'accessrestrict')
    node.access_conditions = _p_text(accessrestrict)

    userestrict = _find(el, 'userestrict')
    node.reproduction_conditions = _p_text(userestrict)

    # bioghist → description
    bioghist = _find(el, 'bioghist')
    if bioghist is not None:
        node.description = _p_text(bioghist)

    # <odd> → notes
    odds = _findall(el, 'odd')

    # Compute ref_code BEFORE add — ref_code is NOT NULL
    from app.models import Institution
    institution = db.session.get(Institution, institution_id)
    if parent_node:
        node.ref_code = f'{parent_node.ref_code}/{local_ref}'
    else:
        node.ref_code = f'{institution.ref_prefix}/{local_ref}'

    db.session.add(node)
    db.session.flush()

    # Add notes
    from app.models.node import NodeNote
    for odd in odds:
        note_type = odd.get('type', 'general')
        content = _p_text(odd)
        if content:
            note = NodeNote(
                node_id=node.id,
                note_type=note_type,
                content=content,
                is_public=False,
                created_by_id=created_by_id,
            )
            db.session.add(note)

    # Record creation change
    node.record_change(
        change_type='create',
        description=f'Imported from EAD',
        created_by_id=created_by_id,
        before_data={},
        after_data=node.to_dict(),
    )

    result.created.append({'title': node.title, 'ref_code': node.ref_code})

    # Recurse into <dsc> children
    dsc = _find(el, 'dsc')
    if dsc is not None:
        for child_el in dsc:
            local_tag = child_el.tag.replace(f'{{{EAD_NS}}}', '')
            if local_tag in ('c', 'c01', 'c02', 'c03', 'c04',
                             'c05', 'c06', 'c07', 'c08', 'c09', 'c10',
                             'c11', 'c12'):
                _parse_component(child_el, institution_id, hierarchy_type,
                                 node, created_by_id, result, depth + 1)

    # Also handle numbered <c01>…<c12> directly under the component
    for child_el in el:
        local_tag = child_el.tag.replace(f'{{{EAD_NS}}}', '')
        if local_tag in ('c01', 'c02', 'c03', 'c04', 'c05',
                         'c06', 'c07', 'c08', 'c09', 'c10', 'c11', 'c12'):
            _parse_component(child_el, institution_id, hierarchy_type,
                             node, created_by_id, result, depth + 1)

    return node


def import_ead(xml_bytes: bytes, institution_id: int,
               hierarchy_type_id: int, parent_node_id: Optional[int],
               created_by_id: int) -> ImportResult:
    """
    Parse EAD 2002 XML and create nodes under the given parent (or at root).
    Returns an ImportResult describing what was created.
    """
    result = ImportResult()

    try:
        root = etree.fromstring(xml_bytes)
    except etree.XMLSyntaxError as e:
        raise EADImportError(f'Invalid XML: {e}')

    # Normalise root tag (handle namespaced and bare EAD)
    local_root = root.tag.replace(f'{{{EAD_NS}}}', '')
    if local_root != 'ead':
        raise EADImportError(f'Root element must be <ead>, got <{local_root}>')

    hierarchy_type = HierarchyType.query.filter_by(
        id=hierarchy_type_id, institution_id=institution_id
    ).first()
    if not hierarchy_type:
        raise EADImportError('Hierarchy type not found')

    parent_node = None
    if parent_node_id:
        parent_node = Node.query.filter_by(
            id=parent_node_id, institution_id=institution_id
        ).first()
        if not parent_node:
            raise EADImportError('Parent node not found')

    archdesc = _find(root, 'archdesc')
    if archdesc is None:
        raise EADImportError('EAD file has no <archdesc> element')

    try:
        _parse_component(archdesc, institution_id, hierarchy_type,
                         parent_node, created_by_id, result)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        raise EADImportError(f'Import failed: {e}')

    return result