"""
EAC-CPF export for a single agent.

Produces EAC-CPF 2010 XML (urn:isbn:1-931666-33-4). The output is designed to
round-trip through this system's own EAC-CPF importer: entityType, nameEntry/
authorizedForm, existDates, and biogHist all map back to the same fields.
"""
from datetime import datetime, timezone
from lxml import etree

EAC_NS = 'urn:isbn:1-931666-33-4'
XLINK_NS = 'http://www.w3.org/1999/xlink'
NSMAP = {None: EAC_NS, 'xlink': XLINK_NS}

# AgentType (model) -> EAC-CPF entityType
_ENTITY_TYPE = {
    'person': 'person',
    'organization': 'corporateBody',
    'family': 'family',
    'software': 'corporateBody',   # no EAC entityType for software; nearest is corporateBody
}


def _sub(parent, tag, text=None, **attrs):
    el = etree.SubElement(parent, f'{{{EAC_NS}}}{tag}')
    if text is not None:
        el.text = str(text)
    for k, v in attrs.items():
        el.set(k, str(v))
    return el


def _agent_type_value(agent) -> str:
    t = getattr(agent, 'agent_type', None)
    return t.value if hasattr(t, 'value') else (t or 'organization')


def export_agent_eac(agent, institution=None) -> bytes:
    """Serialize one agent to EAC-CPF 2010 XML bytes."""
    atype = _agent_type_value(agent)

    root = etree.Element(f'{{{EAC_NS}}}eac-cpf', nsmap=NSMAP)

    # ── control ──
    control = _sub(root, 'control')
    _sub(control, 'recordId', f'kurbits-agent-{agent.id}')
    maint_status = _sub(control, 'maintenanceStatus', 'new')
    if institution is not None and getattr(institution, 'name', None):
        agency = _sub(control, 'maintenanceAgency')
        _sub(agency, 'agencyName', institution.name)
    maint_hist = _sub(control, 'maintenanceHistory')
    event = _sub(maint_hist, 'maintenanceEvent')
    _sub(event, 'eventType', 'created')
    _sub(event, 'eventDateTime', datetime.now(timezone.utc).isoformat())
    _sub(event, 'agentType', 'machine')
    _sub(event, 'agent', 'Kurbits')

    # ── cpfDescription ──
    cpf = _sub(root, 'cpfDescription')

    # identity
    identity = _sub(cpf, 'identity')
    _sub(identity, 'entityType', _ENTITY_TYPE.get(atype, 'corporateBody'))

    # authorized name
    name_entry = _sub(identity, 'nameEntry')
    _sub(name_entry, 'part', getattr(agent, 'authorized_form', None) or getattr(agent, 'name', ''))
    _sub(name_entry, 'authorizedForm', 'kurbits')

    # parallel / other name forms, if the model has them
    for parallel in (getattr(agent, 'parallel_forms', None) or []):
        if parallel:
            pe = _sub(identity, 'nameEntry')
            _sub(pe, 'part', parallel)
            _sub(pe, 'alternativeForm', 'parallel')
    for other in (getattr(agent, 'other_forms', None) or []):
        if other:
            oe = _sub(identity, 'nameEntry')
            _sub(oe, 'part', other)
            _sub(oe, 'alternativeForm', 'other')

    # description
    description = _sub(cpf, 'description')

    date_from = getattr(agent, 'date_from', None)
    date_to = getattr(agent, 'date_to', None)
    if date_from or date_to:
        exist = _sub(description, 'existDates')
        drange = _sub(exist, 'dateRange')
        if date_from:
            _sub(drange, 'fromDate', str(date_from), standardDate=str(date_from))
        if date_to:
            _sub(drange, 'toDate', str(date_to), standardDate=str(date_to))

    if getattr(agent, 'description', None):
        biog = _sub(description, 'biogHist')
        for para in str(agent.description).split('\n\n'):
            para = para.strip()
            if para:
                _sub(biog, 'p', para)

    # ── Notes ─────────────────────────────────────────────────────────
    # Map each note type to a standard EAC-CPF element so they round-trip
    # and remain meaningful in other EAC-CPF tools.
    notes = list(getattr(agent, 'notes', None) or [])

    def _note_paras(parent, text):
        for para in str(text or '').split('\n\n'):
            para = para.strip()
            if para:
                _sub(parent, 'p', para)

    for note in notes:
        ntype = getattr(note, 'note_type', 'general') or 'general'
        content = getattr(note, 'content', '') or ''
        if not content.strip():
            continue

        if ntype == 'history':
            bh = _sub(description, 'biogHist')
            _note_paras(bh, content)
        elif ntype == 'general':
            gc = _sub(description, 'generalContext')
            _note_paras(gc, content)
        elif ntype == 'sources':
            # collected into control/sources below (see note_sources)
            pass
        else:
            # maintenance / internal → maintenanceHistory event note
            pass

    # external identifiers as <source> links in control, plus a note
    ids = []
    for attr, label in (('isni', 'ISNI'), ('viaf', 'VIAF'),
                        ('wikidata', 'Wikidata'), ('orcid', 'ORCID'),
                        ('identifier', 'Identifier')):
        val = getattr(agent, attr, None)
        if val:
            ids.append((label, val))
    # Source notes -> control/sources (alongside identifier sources)
    source_notes = [n for n in notes
                    if (getattr(n, 'note_type', '') or '') == 'sources'
                    and (getattr(n, 'content', '') or '').strip()]
    if ids or source_notes:
        sources = _sub(control, 'sources')
        for label, val in ids:
            s = _sub(sources, 'source')
            s.set(f'{{{XLINK_NS}}}href', str(val))
            _sub(s, 'sourceEntry', f'{label}: {val}')
        for n in source_notes:
            s = _sub(sources, 'source')
            de = _sub(s, 'descriptiveNote')
            for para in str(n.content).split('\n\n'):
                para = para.strip()
                if para:
                    _sub(de, 'p', para)

    # maintenance / internal notes -> maintenanceHistory events
    for n in notes:
        ntype = getattr(n, 'note_type', '') or ''
        content = getattr(n, 'content', '') or ''
        if ntype in ('maintenance', 'internal') and content.strip():
            ev = _sub(maint_hist, 'maintenanceEvent')
            _sub(ev, 'eventType', 'updated')
            _sub(ev, 'eventDateTime',
                 getattr(n, 'created_at', None).isoformat()
                 if getattr(n, 'created_at', None) else datetime.now(timezone.utc).isoformat())
            _sub(ev, 'agentType', 'human')
            _sub(ev, 'agent', getattr(n, 'created_by', None) or 'Kurbits')
            desc_ev = _sub(ev, 'eventDescription', content.strip()[:500])

    return etree.tostring(
        root, xml_declaration=True, encoding='UTF-8', pretty_print=True
    )
