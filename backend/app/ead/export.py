"""
EAD 2002 export.

Produces valid EAD 2002 XML from a Kurbits node (with optional descendants).
Spec: https://www.loc.gov/ead/ead2002.xsd
"""
from __future__ import annotations
from typing import Optional
from lxml import etree
from app.models.node import Node


EAD_NS = 'urn:isbn:1-931666-22-9'
XLINK_NS = 'http://www.w3.org/1999/xlink'
XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance'

# Map Kurbits level names to EAD @level attribute values
LEVEL_MAP = {
    'fonds':        'fonds',
    'sub-fonds':    'subfonds',
    'series':       'series',
    'sub-series':   'subseries',
    'file':         'file',
    'item':         'item',
    'collection':   'collection',
    'recordgrp':    'recordgrp',
    'subgrp':       'subgrp',
    'class':        'class',
}


def _ead_level(level_name: str) -> str:
    return LEVEL_MAP.get(level_name.lower(), 'otherlevel')


def _otherlevel_attr(level_name: str) -> Optional[str]:
    if _ead_level(level_name) == 'otherlevel':
        return level_name
    return None


def _text_el(parent: etree._Element, tag: str, text: str,
             attrib: Optional[dict] = None) -> etree._Element:
    el = etree.SubElement(parent, tag, attrib or {})
    el.text = text
    return el


def _build_did(c: etree._Element, node: Node) -> None:
    did = etree.SubElement(c, 'did')

    _text_el(did, 'unitid', node.local_ref,
             {'label': 'Ref', 'type': 'persistent'})

    _text_el(did, 'unittitle', node.title)

    if node.date_start or node.date_end:
        attrs: dict = {}
        if node.date_start:
            attrs['normal'] = node.date_start.strftime('%Y-%m-%d')
            if node.date_end:
                attrs['normal'] = (
                    f'{node.date_start.strftime("%Y-%m-%d")}/'
                    f'{node.date_end.strftime("%Y-%m-%d")}'
                )
        if node.date_certainty:
            attrs['certainty'] = node.date_certainty
        label = ''
        if node.date_start:
            label = node.date_start.strftime('%Y')
            if node.date_end and node.date_end.year != node.date_start.year:
                label += f'–{node.date_end.strftime("%Y")}'
        _text_el(did, 'unitdate', label, attrs)

    if node.extent:
        physdesc = etree.SubElement(did, 'physdesc')
        _text_el(physdesc, 'extent', node.extent)

    if node.language:
        langmaterial = etree.SubElement(did, 'langmaterial')
        _text_el(langmaterial, 'language', node.language,
                 {'langcode': node.language[:3].lower()})

    # ref_code as abstract / repository identifier
    if node.ref_code:
        _text_el(did, 'unitid', node.ref_code,
                 {'label': 'Full reference code', 'type': 'local'})


def _build_component(parent: etree._Element, node: Node,
                     include_children: bool = True) -> etree._Element:
    level = _ead_level(node.level_of_description)
    attrs = {'level': level}
    ol = _otherlevel_attr(node.level_of_description)
    if ol:
        attrs['otherlevel'] = ol

    # Root element is <archdesc>, nested are <c> (component)
    tag = 'archdesc' if parent.tag in ('archdesc', 'ead') else 'c'
    # Actually archdesc is only the top level; nested are always <c>
    # We handle this at call site
    tag = 'c'
    c = etree.SubElement(parent, tag, attrs)

    _build_did(c, node)

    if node.scope_and_content:
        scopecontent = etree.SubElement(c, 'scopecontent')
        _text_el(scopecontent, 'p', node.scope_and_content)

    if node.arrangement:
        arrangement = etree.SubElement(c, 'arrangement')
        _text_el(arrangement, 'p', node.arrangement)

    if node.access_conditions:
        accessrestrict = etree.SubElement(c, 'accessrestrict')
        _text_el(accessrestrict, 'p', node.access_conditions)

    if node.reproduction_conditions:
        userestrict = etree.SubElement(c, 'userestrict')
        _text_el(userestrict, 'p', node.reproduction_conditions)

    if node.finding_aids:
        otherfindaid = etree.SubElement(c, 'otherfindaid')
        _text_el(otherfindaid, 'p', node.finding_aids)

    # Notes
    for note in node.notes:
        if note.is_public or True:  # include all notes in export
            odd = etree.SubElement(c, 'odd')
            odd.set('type', note.note_type)
            _text_el(odd, 'p', note.content)

    if include_children:
        children = node.children.order_by(Node.local_ref).all()
        if children:
            dsc = etree.SubElement(c, 'dsc')
            for child in children:
                _build_component(dsc, child, include_children=True)

    return c


def export_node(node: Node, include_children: bool = True) -> bytes:
    """
    Export a node (and optionally its descendants) as EAD 2002 XML bytes.
    """
    nsmap = {
        None: EAD_NS,
        'xlink': XLINK_NS,
        'xsi': XSI_NS,
    }
    ead = etree.Element('ead', nsmap=nsmap)
    ead.set(
        f'{{{XSI_NS}}}schemaLocation',
        f'{EAD_NS} http://www.loc.gov/ead/ead.xsd'
    )

    # ── eadheader ──────────────────────────────────────────────────────
    eadheader = etree.SubElement(ead, 'eadheader',
                                  {'langencoding': 'iso639-2b',
                                   'countryencoding': 'iso3166-1',
                                   'dateencoding': 'iso8601',
                                   'repositoryencoding': 'iso15511',
                                   'scriptencoding': 'iso15924'})

    eadid = etree.SubElement(eadheader, 'eadid')
    eadid.text = node.ref_code

    filedesc = etree.SubElement(eadheader, 'filedesc')
    titlestmt = etree.SubElement(filedesc, 'titlestmt')
    _text_el(titlestmt, 'titleproper', node.title)

    profiledesc = etree.SubElement(eadheader, 'profiledesc')
    creation = etree.SubElement(profiledesc, 'creation')
    creation.text = 'Exported from Kurbits AIS'

    # ── archdesc ───────────────────────────────────────────────────────
    level = _ead_level(node.level_of_description)
    attrs = {'level': level}
    ol = _otherlevel_attr(node.level_of_description)
    if ol:
        attrs['otherlevel'] = ol

    archdesc = etree.SubElement(ead, 'archdesc', attrs)
    _build_did(archdesc, node)

    if node.scope_and_content:
        scopecontent = etree.SubElement(archdesc, 'scopecontent')
        _text_el(scopecontent, 'p', node.scope_and_content)

    if node.arrangement:
        arrangement = etree.SubElement(archdesc, 'arrangement')
        _text_el(arrangement, 'p', node.arrangement)

    if node.access_conditions:
        accessrestrict = etree.SubElement(archdesc, 'accessrestrict')
        _text_el(accessrestrict, 'p', node.access_conditions)

    if node.reproduction_conditions:
        userestrict = etree.SubElement(archdesc, 'userestrict')
        _text_el(userestrict, 'p', node.reproduction_conditions)

    if node.finding_aids:
        otherfindaid = etree.SubElement(archdesc, 'otherfindaid')
        _text_el(otherfindaid, 'p', node.finding_aids)

    for note in node.notes:
        odd = etree.SubElement(archdesc, 'odd')
        odd.set('type', note.note_type)
        _text_el(odd, 'p', note.content)

    if include_children:
        children = node.children.order_by(Node.local_ref).all()
        if children:
            dsc = etree.SubElement(archdesc, 'dsc')
            for child in children:
                _build_component(dsc, child, include_children=True)

    return etree.tostring(
        ead,
        pretty_print=True,
        xml_declaration=True,
        encoding='UTF-8',
    )