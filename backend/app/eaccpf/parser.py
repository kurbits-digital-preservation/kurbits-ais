"""
EAC-CPF (Encoded Archival Context — Corporate Bodies, Persons, and Families) parser.

Supports:
  - EAC-CPF 2010 (urn:isbn:1-931666-33-4) — most archives
  - EAC-CPF 2022 (https://archivists.org/ns/eac/v2) — newer exports
"""
from __future__ import annotations
from typing import Optional
from lxml import etree


class ParsedAgent:
    def __init__(self):
        self.agent_type: str = 'organization'
        self.name: str = ''
        self.authorized_form: Optional[str] = None
        self.parallel_names: list[str] = []
        self.date_from: Optional[str] = None
        self.date_to: Optional[str] = None
        self.description: Optional[str] = None
        self.identifier: Optional[str] = None
        self.relations: list[dict] = []
        self.source_id: str = ''


class ParseResult:
    def __init__(self):
        self.agents: list[ParsedAgent] = []
        self.warnings: list[str] = []
        self.total: int = 0

    def to_dict(self) -> dict:
        return {
            'total': self.total,
            'agents': [_agent_summary(a) for a in self.agents],
            'warnings': self.warnings,
        }


def _agent_summary(a: ParsedAgent) -> dict:
    return {
        'name': a.name,
        'agent_type': a.agent_type,
        'authorized_form': a.authorized_form,
        'date_from': a.date_from,
        'date_to': a.date_to,
        'identifier': a.identifier,
    }


def _localname(tag_or_el) -> str:
    tag = tag_or_el if isinstance(tag_or_el, str) else tag_or_el.tag
    return tag.split('}')[-1] if '}' in tag else tag


def _find(el: etree._Element, *local_names: str) -> Optional[etree._Element]:
    """Find first descendant matching any of the local names (depth-first)."""
    for child in el:
        ln = _localname(child.tag)
        if ln in local_names:
            return child
        found = _find(child, *local_names)
        if found is not None:
            return found
    return None


def _findall(el: etree._Element, local_name: str) -> list[etree._Element]:
    """Find all direct children with the given local name."""
    return [c for c in el if _localname(c.tag) == local_name]


def _findall_deep(el: etree._Element, local_name: str) -> list[etree._Element]:
    """Find all descendants (any depth) with the given local name."""
    results = []
    for child in el:
        if _localname(child.tag) == local_name:
            results.append(child)
        results.extend(_findall_deep(child, local_name))
    return results


def _text(el: Optional[etree._Element]) -> str:
    if el is None:
        return ''
    parts = []
    if el.text and el.text.strip():
        parts.append(el.text.strip())
    for child in el:
        t = _text(child)
        if t:
            parts.append(t)
        if child.tail and child.tail.strip():
            parts.append(child.tail.strip())
    return ' '.join(parts)


def _p_text(el: Optional[etree._Element]) -> str:
    """Concatenate <p> children as paragraphs."""
    if el is None:
        return ''
    ps = _findall_deep(el, 'p')
    if ps:
        return '\n\n'.join(t for t in [_text(p) for p in ps] if t)
    return _text(el)



_ENTITY_TYPE_MAP = {
    'person':              'person',
    'corporatebody':       'organization',
    'corporate_body':      'organization',
    'corporateBody':       'organization',
    'family':              'family',
    'software':            'software',
    'organization':        'organization',
}


def _parse_entity_type(el: etree._Element) -> str:
    entity_el = _find(el, 'entityType')
    if entity_el is not None:
        raw = (entity_el.text or '').strip()
        return _ENTITY_TYPE_MAP.get(raw, _ENTITY_TYPE_MAP.get(raw.lower(), 'organization'))
    return 'organization'


def _parse_names(identity_el: etree._Element) -> tuple[str, Optional[str], list[str]]:
    """
    Returns (name, authorized_form, parallel_names).
    EAC-CPF 2010: <nameEntry><part> with localType="forename"/"surname" etc.
    EAC-CPF 2022: <nameEntry><part> with localType
    Authorized form: nameEntry with <authorizedForm> child or @localType="authorized"
    """
    name_entries = _findall_deep(identity_el, 'nameEntry')
    authorized_form = None
    name = ''
    parallel_names = []

    for ne in name_entries:
        # Check if  authorized form
        is_authorized = (
            _find(ne, 'authorizedForm') is not None
            or ne.get('localType', '').lower() in ('authorized', 'authorizedform')
            or ne.get('scriptCode') is not None  # 2022 schema
        )

        parts = _findall_deep(ne, 'part')
        if parts:
            full = ' '.join(p.text.strip() for p in parts if p.text and p.text.strip())
        else:
            full = _text(ne).strip()

        if not full:
            continue

        if is_authorized or not authorized_form:
            if is_authorized:
                authorized_form = full
                if not name:
                    name = full
            elif not name:
                name = full
            else:
                parallel_names.append(full)
        else:
            parallel_names.append(full)

    if not name and authorized_form:
        name = authorized_form

    return name, authorized_form, parallel_names


def _parse_dates(description_el: etree._Element) -> tuple[Optional[str], Optional[str]]:
    """Extract existDates / dates as (date_from, date_to)."""
    exist_dates = _find(description_el, 'existDates')
    if exist_dates is None:
        return None, None

    date_range = _find(exist_dates, 'dateRange')
    if date_range is not None:
        from_el = _find(date_range, 'fromDate')
        to_el = _find(date_range, 'toDate')
        date_from = (from_el.get('standardDate') or _text(from_el) or '').strip()[:10] or None
        date_to = (to_el.get('standardDate') or _text(to_el) or '').strip()[:10] or None
        return date_from, date_to

    date_el = _find(exist_dates, 'date')
    if date_el is not None:
        val = (date_el.get('standardDate') or _text(date_el) or '').strip()[:10]
        return val or None, None

    return None, None


def _parse_description(description_el: etree._Element) -> Optional[str]:
    parts = []

    for bh in _findall_deep(description_el, 'biogHist'):
        t = _p_text(bh).strip()
        if t:
            parts.append(t)

    for sg in _findall_deep(description_el, 'structureOrGenealogy'):
        t = _p_text(sg).strip()
        if t:
            parts.append(t)

    for gc in _findall_deep(description_el, 'generalContext'):
        t = _p_text(gc).strip()
        if t:
            parts.append(t)

    for tag in ('mandate', 'occupation', 'function', 'legalStatus'):
        for el in _findall_deep(description_el, tag):
            t = _p_text(el).strip()
            if t:
                parts.append(f'[{tag}] {t}')

    return '\n\n'.join(parts) if parts else None


def _parse_relations(relations_el: Optional[etree._Element]) -> list[dict]:
    if relations_el is None:
        return []

    result = []
    for cpf_rel in _findall_deep(relations_el, 'cpfRelation'):
        rel_type = cpf_rel.get('cpfRelationType', '') or cpf_rel.get('relationType', '')
        href = cpf_rel.get('{http://www.w3.org/1999/xlink}href', '') or cpf_rel.get('href', '')

        related_entry = _find(cpf_rel, 'relationEntry')
        name = _text(related_entry).strip() if related_entry is not None else ''

        if name or href:
            result.append({
                'name': name,
                'relation_type': rel_type or 'associative',
                'identifier': href or None,
            })
    return result


def _parse_identifier(control_el: etree._Element) -> str:
    record_id = _find(control_el, 'recordId')
    if record_id is not None and record_id.text:
        return record_id.text.strip()

    for other in _findall_deep(control_el, 'otherRecordId'):
        if other.text and other.text.strip():
            return other.text.strip()

    return ''


def _parse_eac_element(eac_el: etree._Element, result: ParseResult) -> Optional[ParsedAgent]:
    agent = ParsedAgent()

    control_el = _find(eac_el, 'control')
    if control_el is None:
        result.warnings.append('Record missing <control> — skipped')
        return None

    agent.source_id = _parse_identifier(control_el)


    identity_el = _find(eac_el, 'identity')
    if identity_el is None:
        result.warnings.append(f'Record {agent.source_id} missing <identity> — skipped')
        return None

    agent.agent_type = _parse_entity_type(identity_el)
    agent.name, agent.authorized_form, agent.parallel_names = _parse_names(identity_el)

    if not agent.name:
        result.warnings.append(f'Record {agent.source_id} has no parseable name — skipped')
        return None


    description_el = _find(eac_el, 'description')
    if description_el is not None:
        agent.date_from, agent.date_to = _parse_dates(description_el)
        agent.description = _parse_description(description_el)


    relations_el = _find(eac_el, 'relations')
    agent.relations = _parse_relations(relations_el)

    return agent




def parse_file(xml_bytes: bytes) -> ParseResult:
    """
    Parse EAC-CPF XML (single record or collection) from bytes.

    Handles:
      - Single <eac-cpf> root
      - <eac> root with one <cpfDescription> (2022 schema variant)
      - <eac-cpf-collection> containing multiple <eac-cpf> children
      - Any wrapping element containing <eac-cpf> descendants
    """
    result = ParseResult()

    try:
        root = etree.fromstring(xml_bytes)
    except etree.XMLSyntaxError as e:
        result.warnings.append(f'XML parse error: {e}')
        return result

    root_ln = _localname(root.tag)


    eac_elements = []

    if root_ln in ('eac-cpf', 'eac'):
        eac_elements = [root]
    elif root_ln in ('eac-cpf-collection', 'collection'):
        eac_elements = [c for c in root if _localname(c.tag) in ('eac-cpf', 'eac')]
    else:

        eac_elements = _findall_deep(root, 'eac-cpf') + _findall_deep(root, 'eac')

    if not eac_elements:
        result.warnings.append(
            f'No <eac-cpf> elements found in document (root was <{root_ln}>)'
        )
        return result

    for el in eac_elements:
        agent = _parse_eac_element(el, result)
        if agent:
            result.agents.append(agent)

    result.total = len(result.agents)
    return result