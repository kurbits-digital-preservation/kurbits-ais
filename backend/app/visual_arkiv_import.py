"""
Visual Arkiv 7 XML import.

Usage:
    flask import-visual-arkiv --institution-id 1 --file export.xml
    flask import-visual-arkiv --institution-id 1 --file export.xml --force-agents
    flask import-visual-arkiv --institution-id 1 --file export.xml --dry-run
    flask import-visual-arkiv --institution-id 1 --file export.xml --parse-codes

Structure mapping (Allmänna Arkivschemat):
    Arkivbildare  → Agent
    Arkiv         → Node level=Fonds
    SerieAA (Y)         → Node level=Series
    SerieAA (Y+Z)       → Node level=Sub-series    (--parse-codes: child of Y)
    SerieAA (Y+Z+A)     → Node level=Sub-sub-series (--parse-codes: child of Y+Z)
    Volym               → Node level=Volume

Structure mapping (Verksamhetsbaserad / classification-based):
    Arkivbildare          → Agent
    Arkiv                 → Node level=Fonds
    KlassStrukt           → Classification tree under root "Klassificeringsstruktur"
    HandlingsSlag         → Node level=Series (linked to Classification)
    FörvaringsenhetRel    → Node level=Volume
    --parse-codes: HandlingsSlag re-parented by HS_Struktur dot-notation

The importer uses iterparse so it handles arbitrarily large files.
"""
from __future__ import annotations

import re
import sys
import click
from xml.etree.ElementTree import iterparse


# ── Helpers ───────────────────────────────────────────────────────────

def _txt(el, tag: str, default: str = '') -> str:
    child = el.find(tag)
    if child is None or not child.text:
        return default
    return child.text.strip()


def _serie_parts(el) -> tuple[str, str, str]:
    """Return (Y, Z, A) components of a SerieAA code."""
    y = _txt(el, 'Serie_Y', '').strip()
    z = _txt(el, 'Serie_Z', '').strip()
    a = _txt(el, 'Serie_A', '').strip()
    if z == '0':
        z = ''
    return y, z, a


def _serie_code(el) -> str:
    y, z, a = _serie_parts(el)
    return (y + z + a) or 'X'


def _ips_to_agent_type(ips: str) -> str:
    mapping = {
        'I': 'organization',
        'P': 'person',
        'S': 'organization',
        'F': 'family',
    }
    return mapping.get(ips.upper(), 'organization')


def _hyllmeter(raw: str) -> str | None:
    if not raw or raw == '0':
        return None
    try:
        mm = int(raw)
        if mm == 0:
            return None
        return f'{mm / 1000:.1f} hm'
    except ValueError:
        return None


def _make_unique_ref(base_ref: str, institution_id: int, parent_id, db, Node) -> str:
    import sqlalchemy as sa
    candidate = base_ref
    suffix = 1
    while True:
        exists = db.session.execute(
            sa.select(Node.id).where(
                Node.institution_id == institution_id,
                Node.parent_id == parent_id,
                Node.local_ref == candidate,
            )
        ).scalar()
        if not exists:
            return candidate
        suffix += 1
        candidate = f'{base_ref}-{suffix}'


def _nivaa_to_level_name(nivaa: str) -> str:
    """Map KlassStrukt_Nivaa to classification level name."""
    mapping = {
        '0': 'Verksamhetsområde',
        '1': 'Processgrupp',
        '2': 'Process',
    }
    return mapping.get(nivaa.strip(), f'Nivå-{nivaa.strip()}')


# ── Hierarchy bootstrap ───────────────────────────────────────────────

def _ensure_va_hierarchy(institution_id: int, db, log, parse_codes: bool = False) -> tuple:
    """
    Find or create an ISAD(G) hierarchy.
    With parse_codes=True also ensures Sub-series and Sub-sub-series levels exist.
    Returns (hierarchy_type, {level_name: HierarchyLevel}).
    """
    from app.models import HierarchyType, HierarchyLevel, HierarchyEntityType
    from app.models.hierarchy import hierarchy_level_relationships
    import sqlalchemy as sa

    ht = db.session.execute(
        sa.select(HierarchyType).where(
            HierarchyType.institution_id == institution_id,
            HierarchyType.entity_type == HierarchyEntityType.RESOURCE,
        ).order_by(HierarchyType.is_default.desc())
    ).scalars().first()

    if not ht:
        log('  Creating ISAD(G) hierarchy type...')
        ht = HierarchyType(
            institution_id=institution_id,
            name='ISAD(G)',
            description='General International Standard Archival Description',
            entity_type=HierarchyEntityType.RESOURCE,
            is_default=True,
        )
        db.session.add(ht)
        db.session.flush()

    existing = {
        lv.name.lower(): lv
        for lv in db.session.execute(
            sa.select(HierarchyLevel).where(HierarchyLevel.hierarchy_type_id == ht.id)
        ).scalars().all()
    }

    levels = {}

    def _get_or_create_level(name: str, sort_order: int, can_loc: bool) -> HierarchyLevel:
        key = name.lower()
        if key in existing:
            return existing[key]
        lv = HierarchyLevel(
            hierarchy_type_id=ht.id,
            name=name,
            sort_order=sort_order,
            can_have_location=can_loc,
        )
        db.session.add(lv)
        db.session.flush()
        existing[key] = lv
        log(f'  Created level: {name}')
        return lv

    levels['Fonds']  = _get_or_create_level('Fonds',  0, False)
    levels['Series'] = _get_or_create_level('Series', 2, False)
    levels['Volume'] = _get_or_create_level('Volume', 6, True)

    if parse_codes:
        levels['Sub-series']     = _get_or_create_level('Sub-series',     3, False)
        levels['Sub-sub-series'] = _get_or_create_level('Sub-sub-series', 4, False)

    relations = [
        (levels['Fonds'],  levels['Series']),
        (levels['Fonds'],  levels['Volume']),
        (levels['Series'], levels['Volume']),
    ]
    if parse_codes:
        relations += [
            (levels['Series'],         levels['Sub-series']),
            (levels['Sub-series'],     levels['Sub-sub-series']),
            (levels['Sub-series'],     levels['Volume']),
            (levels['Sub-sub-series'], levels['Volume']),
        ]

    for parent, child in relations:
        exists = db.session.execute(
            sa.select(hierarchy_level_relationships).where(
                hierarchy_level_relationships.c.parent_id == parent.id,
                hierarchy_level_relationships.c.child_id == child.id,
            )
        ).first()
        if not exists:
            db.session.execute(
                hierarchy_level_relationships.insert().values(
                    parent_id=parent.id, child_id=child.id,
                )
            )

    db.session.flush()
    return ht, levels


def _year_to_date(year_str: str | None, end: bool = False):
    from datetime import date as date_cls
    if not year_str or not year_str.strip():
        return None
    m = re.search(r'\d{4}', year_str)
    if not m:
        return None
    year = int(m.group())
    if year > 2400:
        return None
    if end:
        return date_cls(year, 12, 31)
    return date_cls(year, 1, 1)


# ── Agent import ──────────────────────────────────────────────────────

def _get_system_user_id(institution_id: int, db) -> int | None:
    from app.models.institution import user_institution_association
    import sqlalchemy as sa
    return db.session.execute(
        sa.select(user_institution_association.c.user_id).where(
            user_institution_association.c.institution_id == institution_id
        ).limit(1)
    ).scalar()


import re as _re


def _parse_senastenot(value):
    """'2013-10-16/Axel' -> (date, editor). Only splits into structured parts
    when the leading segment genuinely looks like a date; an unexpected
    format is kept as raw text rather than mis-parsed into the wrong field."""
    if not value or not value.strip():
        return None, None
    value = value.strip()
    if '/' in value:
        date_part, editor_part = value.split('/', 1)
        date_part = date_part.strip()
        editor_part = editor_part.strip() or None
        if _re.match(r'^\d{4}-\d{2}-\d{2}$', date_part):
            return date_part, editor_part
        return None, value
    if _re.match(r'^\d{4}-\d{2}-\d{2}$', value):
        return value, None
    return None, value


def _log_import_event(node_id: int, description: str, db, system_user_id,
                      change_type: str = 'import', after_data: dict | None = None):
    """Record a NodeChange entry so the History tab shows where this record
    came from. This is an append-only audit log by design — re-importing the
    same export logs a fresh entry each run rather than collapsing/upserting,
    since each import run is a real, distinct event worth keeping a trace of.
    Skips (rather than crashes the import) if no user can be attributed,
    since created_by_id is required on NodeChange.
    """
    if system_user_id is None:
        return
    from app.models.node import NodeChange
    db.session.add(NodeChange(
        node_id=node_id,
        change_type=change_type,
        description=description,
        before_data={},
        after_data=after_data or {},
        created_by_id=system_user_id,
    ))


def _get_or_create_va_scheme(institution_id: int, db):
    """The 'Visual Arkiv ID' identifier scheme, shared by agents and
    resources (nodes) — one scheme, used from both flexible-identifier
    tables, get-or-create so re-running the import doesn't create dupes.
    """
    from app.models.node import IdentifierScheme
    import sqlalchemy as sa
    scheme = db.session.execute(
        sa.select(IdentifierScheme).where(
            IdentifierScheme.institution_id == institution_id,
            IdentifierScheme.name == 'Visual Arkiv ID',
        )
    ).scalars().first()
    if not scheme:
        scheme = IdentifierScheme(
            institution_id=institution_id,
            name='Visual Arkiv ID',
            description='Original record ID (_ID_Org) from a Visual Arkiv 7 export.',
        )
        db.session.add(scheme)
        db.session.flush()
    return scheme


def _find_by_va_identifier(model_cls, related_attr: str, scheme, value: str, db):
    """Look up the node/agent already carrying this Visual Arkiv ID, if any —
    used to recognise a record across repeated imports of the same export."""
    import sqlalchemy as sa
    ident = db.session.execute(
        sa.select(model_cls).where(
            model_cls.scheme_id == scheme.id,
            model_cls.value == value,
        )
    ).scalars().first()
    return getattr(ident, related_attr) if ident else None


def _upsert_va_identifier(model_cls, fk_field: str, entity_id: int, scheme,
                          value: str, db, log, entity_label: str, created_by_id=None):
    """Get-or-create a NodeIdentifier/AgentIdentifier row for (entity, scheme),
    so re-importing the same export updates the existing identifier rather
    than duplicating it. Identifier values are unique per scheme GLOBALLY
    (see uq_identifier_value_per_scheme) — if the source export somehow has
    the same _ID_Org attached to two different records, the second is
    skipped with a warning instead of crashing the whole import.
    """
    import sqlalchemy as sa

    existing_for_entity = db.session.execute(
        sa.select(model_cls).where(
            getattr(model_cls, fk_field) == entity_id,
            model_cls.scheme_id == scheme.id,
        )
    ).scalars().first()

    clash = db.session.execute(
        sa.select(model_cls).where(
            model_cls.scheme_id == scheme.id,
            model_cls.value == value,
        )
    ).scalars().first()

    if existing_for_entity:
        if existing_for_entity.value == value:
            return  # nothing to do
        if clash and getattr(clash, fk_field) != entity_id:
            log(f'    WARNING: Visual Arkiv ID {value} is already used by another '
                f'{entity_label} — not reassigning')
            return
        existing_for_entity.value = value
        return

    if clash:
        log(f'    WARNING: Visual Arkiv ID {value} is already used by another '
            f'{entity_label} — skipping')
        return

    kwargs = {fk_field: entity_id, 'scheme_id': scheme.id, 'value': value}
    if created_by_id is not None:
        kwargs['created_by_id'] = created_by_id
    db.session.add(model_cls(**kwargs))


def _import_agent(el, institution_id: int, force: bool, db, log) -> tuple:
    from app.models.agent import Agent, AgentType, AgentNote, AgentIdentifier
    import sqlalchemy as sa
    system_user_id = _get_system_user_id(institution_id, db)

    name           = _txt(el, 'Arkivb_Namn') or _txt(el, 'Arkivb_NamnUtskr') or 'Unknown'
    ips_type       = _txt(el, 'Arkivb_IPSTyp', 'I')
    agent_type_str = _ips_to_agent_type(ips_type)
    date_from      = _txt(el, 'Arkivb_Verksamf') or None
    date_to        = _txt(el, 'Arkivb_Verksamt') or None
    description    = _txt(el, 'Arkivb_Sammanfattning') or None
    arkivb_id_org  = _txt(el, 'Arkivb_ID_Org') or None

    existing = db.session.execute(
        sa.select(Agent).where(
            Agent.institution_id == institution_id,
            Agent.name == name,
        )
    ).scalars().first()

    if existing and not force:
        log(f'  Agent exists (skipping): {name}')
        return existing, False

    if existing and force:
        agent = existing
        agent.date_from = date_from
        agent.date_to = date_to
        agent.description = description
        created = False
        log(f'  Updated agent: {name}')
    else:
        agent = Agent(
            institution_id=institution_id,
            name=name,
            authorized_form=name,
            agent_type=AgentType(agent_type_str),
            date_from=date_from,
            date_to=date_to,
            description=description,
        )
        db.session.add(agent)
        db.session.flush()
        created = True
        log(f'  Created agent: {name}')

    if arkivb_id_org:
        va_scheme = _get_or_create_va_scheme(institution_id, db)
        _upsert_va_identifier(
            AgentIdentifier, 'agent_id', agent.id, va_scheme, arkivb_id_org,
            db, log, 'agent', created_by_id=system_user_id,
        )

    historik = _txt(el, './/Historik_Historik')
    if historik:
        existing_note = db.session.execute(
            sa.select(AgentNote).where(
                AgentNote.agent_id == agent.id,
                AgentNote.note_type == 'history',
            )
        ).scalars().first()
        if existing_note:
            existing_note.body = historik
        else:
            db.session.add(AgentNote(
                agent_id=agent.id,
                note_type='history',
                content=historik,
                created_by_id=system_user_id,
            ))

    return agent, created


# ── Fonds import ──────────────────────────────────────────────────────

def _import_arkiv(el, agent, institution_id: int, ht, levels, db, log, system_user_id=None) -> object:
    from app.models.node import Node, NodeNote, NodeIdentifier
    import sqlalchemy as sa

    name         = _txt(el, 'Arkiv_Namn') or _txt(el, 'Arkiv_NamnUtskr') or 'Untitled'
    nr           = _txt(el, 'Arkiv_Nr', '1')
    date_from    = _txt(el, 'Arkiv_Tidarkivf') or None
    date_to      = _txt(el, 'Arkiv_Tidarkivt') or None
    notes_txt    = _txt(el, 'Arkiv_Anteckningar') or None
    placering    = _txt(el, 'Arkiv_Placering') or None
    sekretess    = _txt(el, 'Arkiv_Sekretess', '0')
    extent       = _hyllmeter(_txt(el, 'Arkiv_HyllmeterMetric'))
    arkiv_id_org = _txt(el, 'Arkiv_ID_Org') or None
    senastenot   = _txt(el, 'Arkiv_Senastenot') or None

    description_parts = []
    if extent:
        description_parts.append(f'Extent: {extent}')
    if placering:
        description_parts.append(f'Location: {placering}')
    if sekretess == '1':
        sek_text = _txt(el, 'Arkiv_SekretessText') or 'Secrecy restrictions apply'
        description_parts.append(f'Access restrictions: {sek_text}')
    description = '\n'.join(description_parts) if description_parts else None

    # A fonds is matched across repeated imports of the same export by its
    # Visual Arkiv ID (Arkiv_ID_Org), rather than always creating a new node.
    # Without this, re-running the import on the same file created a second
    # copy of the fonds every time (local_ref just got a "-2", "-3"...
    # suffix to avoid collision, it never recognised the record).
    va_scheme = None
    existing_node = None
    if arkiv_id_org:
        va_scheme = _get_or_create_va_scheme(institution_id, db)
        candidate = _find_by_va_identifier(NodeIdentifier, 'node', va_scheme, arkiv_id_org, db)
        if candidate and candidate.institution_id == institution_id:
            existing_node = candidate

    if existing_node:
        node = existing_node
        node.title = name
        node.date_start = _year_to_date(date_from)
        node.date_end = _year_to_date(date_to, end=True)
        node.description = description
        log(f'    Fonds exists (Visual Arkiv ID {arkiv_id_org}) — updated: {node.ref_code} -- {name}')
    else:
        local_ref = _make_unique_ref(nr, institution_id, None, db, Node)
        node = Node(
            institution_id=institution_id,
            parent_id=None,
            local_ref=local_ref,
            title=name,
            level_of_description='Fonds',
            hierarchy_type_id=ht.id,
            date_start=_year_to_date(date_from),
            date_end=_year_to_date(date_to, end=True),
            description=description,
        )
        from app.models import Institution as _Inst
        _inst = db.session.get(_Inst, institution_id)
        node.ref_code = f'{_inst.ref_prefix}/{local_ref}'
        db.session.add(node)
        db.session.flush()
        log(f'    Fonds: {node.ref_code} -- {name}')

    if arkiv_id_org:
        _upsert_va_identifier(
            NodeIdentifier, 'node_id', node.id, va_scheme, arkiv_id_org,
            db, log, 'resource', created_by_id=system_user_id,
        )

    if senastenot:
        va_date, va_editor = _parse_senastenot(senastenot)
        if va_date and va_editor:
            desc = f'Last edited in Visual Arkiv on {va_date} by {va_editor}.'
        elif va_date:
            desc = f'Last edited in Visual Arkiv on {va_date}.'
        elif va_editor:
            desc = f'Last edited in Visual Arkiv: {va_editor}.'
        else:
            desc = None
        if desc:
            _log_import_event(node.id, desc, db, system_user_id,
                             change_type='external_edit',
                             after_data={'senastenot': senastenot, 'date': va_date, 'editor': va_editor})

    _log_import_event(
        node.id,
        'Updated from a Visual Arkiv 7 import.' if existing_node else 'Created from a Visual Arkiv 7 import.',
        db, system_user_id,
        after_data={'arkiv_id_org': arkiv_id_org} if arkiv_id_org else None,
    )

    # Notes are upserted by type rather than appended, so re-importing the
    # same export doesn't pile up duplicate "general"/"administrative_history"
    # notes on a fonds that's matched via existing_node above.
    def _upsert_note(note_type, content):
        if not content:
            return
        existing = db.session.execute(
            sa.select(NodeNote).where(
                NodeNote.node_id == node.id,
                NodeNote.note_type == note_type,
            )
        ).scalars().first()
        if existing:
            existing.content = content
        else:
            db.session.add(NodeNote(node_id=node.id, note_type=note_type,
                                    content=content, created_by_id=system_user_id))

    _upsert_note('general', notes_txt)
    _upsert_note('administrative_history', _txt(el, 'Arkiv_Historik'))

    return node


# ── AA Series import ──────────────────────────────────────────────────

def _build_serie_node(el, parent_node, level_name, local_ref, institution_id, ht, db, log, system_user_id=None):
    """Create a single Series / Sub-series / Sub-sub-series node from <SerieAA>."""
    from app.models.node import Node, NodeNote

    title     = _txt(el, 'Serie_Serierubrik') or 'Untitled series'
    notes_txt = _txt(el, 'Serie_Anmerkning') or None
    placering = _txt(el, 'Serie_Placering') or None
    sekretess = _txt(el, 'Serie_Sekretess', '0')
    gallras   = _txt(el, 'Serie_Gallras', '0')
    gallr_ar  = _txt(el, 'Serie_GallrasAr') or None
    gallr_txt = _txt(el, 'Serie_GallrasText') or None

    description_parts = []
    if placering:
        description_parts.append(f'Location: {placering}')
    if sekretess == '1':
        sek_text = _txt(el, 'Serie_SekretessText') or 'Secrecy restrictions apply'
        description_parts.append(f'Access restrictions: {sek_text}')
    if gallras == '1':
        disp = 'Appraisal: scheduled for disposal'
        if gallr_ar:
            disp += f' ({gallr_ar})'
        if gallr_txt:
            disp += f' -- {gallr_txt}'
        description_parts.append(disp)

    node = Node(
        institution_id=institution_id,
        parent_id=parent_node.id,
        local_ref=local_ref,
        title=title,
        level_of_description=level_name,
        hierarchy_type_id=ht.id,
        description='\n'.join(description_parts) if description_parts else None,
    )
    node.ref_code = f'{parent_node.ref_code}/{local_ref}'
    db.session.add(node)
    db.session.flush()

    if notes_txt:
        db.session.add(NodeNote(node_id=node.id, note_type='general', content=notes_txt, created_by_id=system_user_id))

    _log_import_event(node.id, 'Created from a Visual Arkiv 7 import.', db, system_user_id)

    log(f'      {level_name}: {node.ref_code} -- {title}')
    return node


def _import_series_flat(arkiv_el, fonds_node, institution_id, ht, levels, db, log, system_user_id, stats):
    """Import all SerieAA flat under Fonds (no --parse-codes)."""
    from app.models.node import Node

    for serie_el in arkiv_el.findall('.//SerieAA'):
        code      = _serie_code(serie_el)
        local_ref = _make_unique_ref(code, institution_id, fonds_node.id, db, Node)
        serie     = _build_serie_node(
            serie_el, fonds_node, 'Series', local_ref,
            institution_id, ht, db, log, system_user_id
        )
        stats['series_created'] += 1

        for vol_idx, volym_el in enumerate(serie_el.findall('.//Volym'), start=1):
            _import_volym(volym_el, serie, institution_id, ht, db, log, vol_idx, system_user_id)
            stats['volumes_created'] += 1


def _import_series_parsed(arkiv_el, fonds_node, institution_id, ht, levels, db, log, system_user_id, stats):
    """
    Import SerieAA building a real tree from Y / Y+Z / Y+Z+A code structure.

    Y        -> Series         (child of Fonds)
    Y+Z      -> Sub-series     (child of Y node)
    Y+Z+A    -> Sub-sub-series (child of Y+Z node)

    If a parent code is missing from the export a stub node is created.
    """
    from app.models.node import Node

    # Collect all series elements keyed by their full code
    series_els: dict[str, object] = {}
    for serie_el in arkiv_el.findall('.//SerieAA'):
        code = _serie_code(serie_el)
        series_els[code] = serie_el

    serie_nodes: dict[str, Node] = {}

    def _get_or_create_parent(parent_code: str, parent_level: str) -> object:
        if parent_code in serie_nodes:
            return serie_nodes[parent_code]
        local_ref = _make_unique_ref(parent_code, institution_id, fonds_node.id, db, Node)
        stub = Node(
            institution_id=institution_id,
            parent_id=fonds_node.id,
            local_ref=local_ref,
            title=parent_code,
            level_of_description=parent_level,
            hierarchy_type_id=ht.id,
        )
        stub.ref_code = f'{fonds_node.ref_code}/{local_ref}'
        db.session.add(stub)
        db.session.flush()
        serie_nodes[parent_code] = stub
        _log_import_event(stub.id, 'Created from a Visual Arkiv 7 import (inferred parent).',
                          db, system_user_id)
        log(f'      {parent_level} (stub): {stub.ref_code} -- {parent_code}')
        return stub

    def _sort_key(code):
        y, z, a = _serie_parts(series_els[code])
        return (y, z or '', a or '')

    for code in sorted(series_els.keys(), key=_sort_key):
        serie_el = series_els[code]
        y, z, a  = _serie_parts(serie_el)

        if z and a:
            parent_code  = y + z
            parent_level = 'Sub-series'
            level_name   = 'Sub-sub-series'
            parent_node  = _get_or_create_parent(parent_code, parent_level)
            local_ref    = _make_unique_ref(code, institution_id, parent_node.id, db, Node)
        elif z:
            parent_code  = y
            parent_level = 'Series'
            level_name   = 'Sub-series'
            parent_node  = _get_or_create_parent(parent_code, parent_level)
            local_ref    = _make_unique_ref(code, institution_id, parent_node.id, db, Node)
        else:
            level_name  = 'Series'
            parent_node = fonds_node
            local_ref   = _make_unique_ref(code, institution_id, fonds_node.id, db, Node)

        node = _build_serie_node(
            serie_el, parent_node, level_name, local_ref,
            institution_id, ht, db, log, system_user_id
        )
        serie_nodes[code] = node
        stats['series_created'] += 1

        for vol_idx, volym_el in enumerate(serie_el.findall('.//Volym'), start=1):
            _import_volym(volym_el, node, institution_id, ht, db, log, vol_idx, system_user_id)
            stats['volumes_created'] += 1


def _import_volym(el, serie_node, institution_id: int, ht, db, log, vol_idx: int, system_user_id=None) -> object:
    from app.models.node import Node, NodeNote

    volnr     = _txt(el, 'Volym_Volnr') or str(vol_idx)
    tid       = _txt(el, 'Volym_Tid') or None
    date_from = _txt(el, 'Volym_TidFrom') or None
    date_to   = _txt(el, 'Volym_TidTom') or None
    anm       = _txt(el, 'Volym_Anm') or _txt(el, 'Volym_Anmerkningar') or None
    placering = _txt(el, 'Volym_Placering') or None
    sekretess = _txt(el, 'Volym_Sekretess', '0')
    gallr_ar  = _txt(el, 'Volym_GallrasAr') or None
    gallr_txt = _txt(el, 'Volym_GallrasText') or None
    omf_enhet = _txt(el, 'Volym_OmfEnhet') or None
    omf_mgd   = _txt(el, 'Volym_OmfMgd', '0')
    forvtyp   = _txt(el, 'Volyml_ForvaringsenhetTyp') or None

    # Dates are already captured structurally as date_start/date_end below —
    # repeating them in the title is redundant.
    title = f'Vol. {volnr}'

    description_parts = []
    if placering:
        description_parts.append(f'Location: {placering}')
    if forvtyp and forvtyp != '-':
        description_parts.append(f'Container type: {forvtyp}')
    if omf_enhet and omf_mgd != '0':
        description_parts.append(f'Extent: {omf_mgd} {omf_enhet}')
    if sekretess == '1':
        sek_text = _txt(el, 'Volym_SekretessText') or 'Secrecy restrictions apply'
        description_parts.append(f'Access restrictions: {sek_text}')
    if gallr_ar or gallr_txt:
        disp = 'Appraisal: scheduled for disposal'
        if gallr_ar:
            disp += f' ({gallr_ar})'
        if gallr_txt:
            disp += f' -- {gallr_txt}'
        description_parts.append(disp)

    local_ref = _make_unique_ref(volnr, institution_id, serie_node.id, db, Node)

    node = Node(
        institution_id=institution_id,
        parent_id=serie_node.id,
        local_ref=local_ref,
        title=title,
        level_of_description='Volume',
        hierarchy_type_id=ht.id,
        date_start=_year_to_date(date_from),
        date_end=_year_to_date(date_to, end=True),
        description='\n'.join(description_parts) if description_parts else None,
    )
    node.ref_code = f'{serie_node.ref_code}/{local_ref}'
    db.session.add(node)
    db.session.flush()
    _log_import_event(node.id, 'Created from a Visual Arkiv 7 import.', db, system_user_id)

    if anm:
        db.session.add(NodeNote(node_id=node.id, note_type='general', content=anm, created_by_id=system_user_id))

    log(f'        Volume: {node.ref_code} -- {title}')
    return node


# ── Classification import ─────────────────────────────────────────────

def _ensure_klass_root(institution_id: int, ht, version_label: str, db, log, system_user_id=None) -> object:
    """
    Find or create the root Classification node 'Klassificeringsstruktur'.
    All KlassStrukt nodes are parented under this root.
    """
    from app.models.classification import Classification
    import sqlalchemy as sa

    root_name = 'Klassificeringsstruktur'
    root_code = re.sub(r'[^A-Za-z0-9-]', '-', version_label)[:50]

    existing = db.session.execute(
        sa.select(Classification).where(
            Classification.institution_id == institution_id,
            Classification.parent_id == None,
            Classification.hierarchy_type_id == ht.id,
            Classification.code == root_code,
        )
    ).scalars().first()

    if existing:
        return existing

    root = Classification(
        institution_id=institution_id,
        name=root_name,
        code=root_code,
        level_name='Klassificeringsstruktur',
        hierarchy_type_id=ht.id,
        parent_id=None,
        status='published',
        version_label=version_label,
        created_by_id=system_user_id,
    )
    db.session.add(root)
    db.session.flush()
    log(f'      Classification root: {root_name} ({version_label})')
    return root


def _import_klass_strukt_tree(arkiv_el, institution_id: int, ht, db, log, system_user_id=None) -> dict[str, object]:
    """
    Parse all <KlassStrukt> elements nested inside <Arkiv> and create
    Classification rows under a root 'Klassificeringsstruktur' node.

    Levels:  Nivaa 0 -> Verksamhetsomrade
             Nivaa 1 -> Processgrupp
             Nivaa 2 -> Process

    Returns dict: Strukturenhet -> Classification instance.
    """
    from app.models.classification import Classification
    import sqlalchemy as sa

    klass_ver_el  = arkiv_el.find('KlassStruktVersion')
    version_label = (
        _txt(klass_ver_el, 'KlassStruktVer_KlassStruktVersion', 'KS')
        if klass_ver_el is not None else 'KS'
    )

    root = _ensure_klass_root(institution_id, ht, version_label, db, log, system_user_id)
    strukt_map: dict[str, Classification] = {}

    def _process_klass_el(el, parent_classification):
        strukturenhet = _txt(el, 'KlassStrukt_Strukturenhet')
        namn          = _txt(el, 'KlassStrukt_StruktNamn')
        nivaa         = _txt(el, 'KlassStrukt_Nivaa', '0')

        if not strukturenhet or not namn:
            return

        level_name = _nivaa_to_level_name(nivaa)
        code       = strukturenhet.split('.')[-1].lstrip('0') or '0'

        existing = db.session.execute(
            sa.select(Classification).where(
                Classification.institution_id == institution_id,
                Classification.code == code,
                Classification.parent_id == parent_classification.id,
                Classification.hierarchy_type_id == ht.id,
            )
        ).scalars().first()

        if existing:
            strukt_map[strukturenhet] = existing
        else:
            c = Classification(
                institution_id=institution_id,
                name=namn,
                code=code,
                level_name=level_name,
                hierarchy_type_id=ht.id,
                parent_id=parent_classification.id,
                status='published',
                version_label=version_label,
                created_by_id=system_user_id,
            )
            db.session.add(c)
            db.session.flush()
            strukt_map[strukturenhet] = c
            log(f'      Classification: {strukturenhet} -- {namn}')

        for child_el in el.findall('KlassStrukt'):
            _process_klass_el(child_el, strukt_map[strukturenhet])

    for top_el in arkiv_el.findall('KlassStrukt'):
        _process_klass_el(top_el, root)

    return strukt_map


def _resolve_hs_classification(hs_el, strukt_map: dict) -> object | None:
    """
    Resolve Classification for a HandlingsSlag via HS_StrukturSort.
    '0000100000.0000500000' -> strukturenhet '00001.00005'
    """
    struktur_sort = _txt(hs_el, 'HS_StrukturSort')
    if not struktur_sort or not strukt_map:
        return None
    try:
        segments      = struktur_sort.split('.')
        ident_parts   = [seg[:5] for seg in segments if seg.strip('0')]
        if not ident_parts:
            return None
        strukturenhet = '.'.join(ident_parts)
        return strukt_map.get(strukturenhet)
    except Exception:
        return None


def _link_node_to_classification(node, classification, db) -> None:
    from app.models.classification import classification_node_association
    import sqlalchemy as sa

    if classification is None:
        return
    exists = db.session.execute(
        sa.select(classification_node_association).where(
            classification_node_association.c.classification_id == classification.id,
            classification_node_association.c.node_id == node.id,
        )
    ).first()
    if not exists:
        db.session.execute(
            classification_node_association.insert().values(
                classification_id=classification.id,
                node_id=node.id,
            )
        )


# ── HandlingsSlag / FörvaringsenhetRel import ─────────────────────────

def _build_handlingsslag_node(hs_el, parent_node, institution_id, ht, strukt_map,
                               db, log, system_user_id, level_name='Series') -> object:
    """Create a Series/Sub-series node from <HandlingsSlag> and link to Classification."""
    from app.models.node import Node, NodeNote

    namn      = _txt(hs_el, 'HS_Namn') or 'Untitled'
    struktur  = _txt(hs_el, 'HS_Struktur') or ''
    beskr     = _txt(hs_el, 'HS_Beskr') or None
    anm       = _txt(hs_el, 'HS_Anmerkning') or None
    placering = _txt(hs_el, 'HS_Placering') or None
    sekretess = _txt(hs_el, 'HS_Sekretess', '0')
    gallras   = _txt(hs_el, 'HS_Gallras', '0')
    gallr_ar  = _txt(hs_el, 'HS_GallrasAr') or None
    gallr_txt = _txt(hs_el, 'HS_GallrasText') or None

    local_ref = _make_unique_ref(
        struktur or namn[:20], institution_id, parent_node.id, db, Node
    )

    description_parts = []
    if beskr:
        description_parts.append(beskr)
    if placering:
        description_parts.append(f'Location: {placering}')
    if sekretess == '1':
        sek_text = _txt(hs_el, 'HS_SekretessText') or 'Secrecy restrictions apply'
        description_parts.append(f'Access restrictions: {sek_text}')
    if gallras == '1':
        disp = 'Appraisal: scheduled for disposal'
        if gallr_ar:
            disp += f' ({gallr_ar})'
        if gallr_txt:
            disp += f' -- {gallr_txt}'
        description_parts.append(disp)

    node = Node(
        institution_id=institution_id,
        parent_id=parent_node.id,
        local_ref=local_ref,
        title=namn,
        level_of_description=level_name,
        hierarchy_type_id=ht.id,
        description='\n'.join(description_parts) if description_parts else None,
    )
    node.ref_code = f'{parent_node.ref_code}/{local_ref}'
    db.session.add(node)
    db.session.flush()
    _log_import_event(node.id, 'Created from a Visual Arkiv 7 import.', db, system_user_id)

    if anm:
        db.session.add(NodeNote(node_id=node.id, note_type='general', content=anm, created_by_id=system_user_id))

    classification = _resolve_hs_classification(hs_el, strukt_map)
    if classification:
        _link_node_to_classification(node, classification, db)
        log(f'      {level_name}: {node.ref_code} -- {namn} -> [{classification.get_full_code()}]')
    else:
        log(f'      {level_name}: {node.ref_code} -- {namn}')

    return node


def _import_handlingsslag_flat(hs_grupp, fonds_node, institution_id, ht, levels,
                                strukt_map, db, log, system_user_id, stats):
    """Import all HandlingsSlag flat under Fonds (no --parse-codes)."""
    for hs_el in hs_grupp.findall('HandlingsSlag'):
        serie = _build_handlingsslag_node(
            hs_el, fonds_node, institution_id, ht, strukt_map,
            db, log, system_user_id, level_name='Series'
        )
        stats['series_created'] += 1
        for vol_idx, fe_el in enumerate(
            hs_el.findall('.//ForvenhRelGrupp/FörvaringsenhetRel'), start=1
        ):
            _import_forvenhrel(fe_el, serie, institution_id, ht, db, log, vol_idx, system_user_id)
            stats['volumes_created'] += 1


def _import_handlingsslag_parsed(hs_grupp, fonds_node, institution_id, ht, levels,
                                  strukt_map, db, log, system_user_id, stats):
    """
    Import HandlingsSlag building a tree from HS_Struktur dot-notation (--parse-codes).

    HS_Struktur '1'   -> Series under Fonds
    HS_Struktur '1.5' -> Sub-series under the '1' Series node
    """
    hs_list = hs_grupp.findall('HandlingsSlag')
    struktur_nodes: dict[str, object] = {}

    def _sort_key(el):
        s = _txt(el, 'HS_Struktur', '')
        try:
            return tuple(float(p) for p in s.split('.'))
        except ValueError:
            return (0,)

    for hs_el in sorted(hs_list, key=_sort_key):
        struktur = _txt(hs_el, 'HS_Struktur', '').strip()

        if '.' in struktur:
            parent_struktur = struktur.rsplit('.', 1)[0]
            if parent_struktur in struktur_nodes:
                parent_node = struktur_nodes[parent_struktur]
                level_name  = 'Sub-series'
            else:
                parent_node = fonds_node
                level_name  = 'Series'
        else:
            parent_node = fonds_node
            level_name  = 'Series'

        node = _build_handlingsslag_node(
            hs_el, parent_node, institution_id, ht, strukt_map,
            db, log, system_user_id, level_name=level_name
        )
        stats['series_created'] += 1

        if struktur:
            struktur_nodes[struktur] = node

        for vol_idx, fe_el in enumerate(
            hs_el.findall('.//ForvenhRelGrupp/FörvaringsenhetRel'), start=1
        ):
            _import_forvenhrel(fe_el, node, institution_id, ht, db, log, vol_idx, system_user_id)
            stats['volumes_created'] += 1


def _import_forvenhrel(el, serie_node, institution_id: int, ht, db, log,
                        vol_idx: int, system_user_id=None) -> object:
    from app.models.node import Node, NodeNote

    beteckning = _txt(el, 'ForvenhRel_Beteckning') or str(vol_idx)
    tid        = _txt(el, 'ForvenhRel_Tid') or _txt(el, 'ForvenhRel_Stid') or None
    date_from  = _txt(el, 'ForvenhRel_TidFrom') or None
    date_to    = _txt(el, 'ForvenhRel_TidTom') or None
    anm        = _txt(el, 'ForvenhRel_Anm') or None
    anmerkn    = _txt(el, 'ForvenhRel_Anmerkningar') or None
    placering  = _txt(el, 'ForvenhRel_Placering') or None
    sekretess  = _txt(el, 'ForvenhRel_Sekretess', '0')
    gallr_ar   = _txt(el, 'ForvenhRel_GallrasAr') or None
    gallr_txt  = _txt(el, 'ForvenhRel_GallrasText') or None
    omf_enhet  = _txt(el, 'ForvenhRel_OmfEnhet') or None
    omf_mgd    = _txt(el, 'ForvenhRel_OmfMgd', '0')
    forvtyp    = _txt(el, 'ForvenhRel_ForvaringsenhetTyp') or None

    # Etrad1/Etrad2 are VA7's PRINTED LABEL LINE fields — free text meant for
    # a physical box/spine label, not a reliable source for the record title.
    # They've been seen holding boilerplate that belongs in the remarks field
    # instead (e.g. "Anmärkningar - Förvaringsenhet 1"), silently corrupting
    # titles. Deliberately not used here — the systematic "Vol. <beteckning>"
    # designation is always used instead. This only affects the process-based
    # (verksamhetsbaserad / HandlingsSlag) import path; AA-schema volumes are
    # built by _import_volym, a separate function that never touches Etrad.
    # Dates are already captured structurally as date_start/date_end below —
    # repeating them in the title is redundant.
    title = f'Vol. {beteckning}'

    description_parts = []
    if anm:
        description_parts.append(anm)
    if placering:
        description_parts.append(f'Location: {placering}')
    if forvtyp and forvtyp not in ('-', ''):
        description_parts.append(f'Container type: {forvtyp}')
    if omf_enhet and omf_enhet != '-' and omf_mgd != '0':
        description_parts.append(f'Extent: {omf_mgd} {omf_enhet}')
    if sekretess == '1':
        sek_text = _txt(el, 'ForvenhRel_SekretessText') or 'Secrecy restrictions apply'
        description_parts.append(f'Access restrictions: {sek_text}')
    if gallr_ar or gallr_txt:
        disp = 'Appraisal: scheduled for disposal'
        if gallr_ar:
            disp += f' ({gallr_ar})'
        if gallr_txt:
            disp += f' -- {gallr_txt}'
        description_parts.append(disp)

    ref_base  = beteckning if beteckning != '-' else str(vol_idx)
    local_ref = _make_unique_ref(ref_base, institution_id, serie_node.id, db, Node)

    node = Node(
        institution_id=institution_id,
        parent_id=serie_node.id,
        local_ref=local_ref,
        title=title,
        level_of_description='Volume',
        hierarchy_type_id=ht.id,
        date_start=_year_to_date(date_from),
        date_end=_year_to_date(date_to, end=True),
        description='\n'.join(description_parts) if description_parts else None,
    )
    node.ref_code = f'{serie_node.ref_code}/{local_ref}'
    db.session.add(node)
    db.session.flush()
    _log_import_event(node.id, 'Created from a Visual Arkiv 7 import.', db, system_user_id)

    if anmerkn:
        db.session.add(NodeNote(node_id=node.id, note_type='general', content=anmerkn, created_by_id=system_user_id))

    log(f'        Volume: {node.ref_code} -- {title}')
    return node


# ── Agent -> Fonds link ───────────────────────────────────────────────

def _link_agent_to_node(agent, fonds_node, institution_id: int, db) -> None:
    from app.models.agent import agent_node_association
    import sqlalchemy as sa

    exists = db.session.execute(
        sa.select(agent_node_association).where(
            agent_node_association.c.agent_id == agent.id,
            agent_node_association.c.node_id == fonds_node.id,
        )
    ).first()
    if not exists:
        db.session.execute(
            agent_node_association.insert().values(
                agent_id=agent.id,
                node_id=fonds_node.id,
                relation_type='creator',
            )
        )


# ── Schema detection ──────────────────────────────────────────────────

def _detect_schema(arkiv_el) -> str:
    """Return 'klass' if classification-based, else 'aa'."""
    if arkiv_el.find('KlassStrukt') is not None:
        return 'klass'
    if arkiv_el.find('HandlingsslagGrupp') is not None:
        return 'klass'
    return 'aa'


# ── Main iterparse walk ───────────────────────────────────────────────

def _stream_import(filepath: str, institution_id: int, force_agents: bool,
                   dry_run: bool, batch_size: int, parse_codes: bool, db, log) -> dict:
    stats = {
        'agents_created': 0, 'agents_skipped': 0,
        'fonds_created': 0,
        'classifications_created': 0,
        'series_created': 0, 'volumes_created': 0,
        'errors': [],
    }

    ht, levels = _ensure_va_hierarchy(institution_id, db, log, parse_codes=parse_codes)

    from lxml import etree as lxmletree

    context = lxmletree.iterparse(filepath, events=('start', 'end'), recover=True)

    current_arkivbildare = None
    depth = 0
    inside = False
    arkivbildare_count = 0

    for event, el in context:
        tag = el.tag.split('}')[-1] if '}' in el.tag else el.tag

        if event == 'start' and tag == 'Arkivbildare':
            inside = True
            depth = 1
            current_arkivbildare = el
            continue

        if inside:
            if event == 'start':
                depth += 1
            elif event == 'end':
                depth -= 1
                if depth == 0:
                    inside = False
                    arkivbildare_count += 1
                    log(f'\nProcessing Arkivbildare #{arkivbildare_count}...')

                    try:
                        if not dry_run:
                            _process_arkivbildare(
                                current_arkivbildare, institution_id,
                                force_agents, ht, levels, parse_codes, db, log, stats
                            )
                            if arkivbildare_count % batch_size == 0:
                                db.session.flush()
                                log(f'  [flushed at {arkivbildare_count}]')
                        else:
                            _dry_run_arkivbildare(current_arkivbildare, log, stats)

                    except Exception as e:
                        name = _txt(current_arkivbildare, 'Arkivb_Namn', '?')
                        msg = f'Error on Arkivbildare "{name}": {e}'
                        stats['errors'].append(msg)
                        log(f'  ERROR: {msg}')
                        if not dry_run:
                            db.session.rollback()

                    current_arkivbildare = None
                    el.clear()

    return stats


def _process_arkivbildare(el, institution_id, force_agents, ht, levels, parse_codes, db, log, stats):
    system_user_id = _get_system_user_id(institution_id, db)
    agent, created = _import_agent(el, institution_id, force_agents, db, log)
    if created:
        stats['agents_created'] += 1
    else:
        stats['agents_skipped'] += 1

    for arkiv_el in el.findall('.//Arkiv'):
        fonds = _import_arkiv(arkiv_el, agent, institution_id, ht, levels, db, log, system_user_id)
        stats['fonds_created'] += 1
        _link_agent_to_node(agent, fonds, institution_id, db)

        schema = _detect_schema(arkiv_el)

        if schema == 'klass':
            strukt_map = _import_klass_strukt_tree(
                arkiv_el, institution_id, ht, db, log, system_user_id
            )
            stats['classifications_created'] += len(strukt_map)

            hs_grupp = arkiv_el.find('HandlingsslagGrupp')
            if hs_grupp is not None:
                if parse_codes:
                    _import_handlingsslag_parsed(
                        hs_grupp, fonds, institution_id, ht, levels,
                        strukt_map, db, log, system_user_id, stats
                    )
                else:
                    _import_handlingsslag_flat(
                        hs_grupp, fonds, institution_id, ht, levels,
                        strukt_map, db, log, system_user_id, stats
                    )

        else:
            if parse_codes:
                _import_series_parsed(
                    arkiv_el, fonds, institution_id, ht, levels, db, log, system_user_id, stats
                )
            else:
                _import_series_flat(
                    arkiv_el, fonds, institution_id, ht, levels, db, log, system_user_id, stats
                )


def _dry_run_arkivbildare(el, log, stats):
    name = _txt(el, 'Arkivb_Namn', '?')
    log(f'  Would import agent: {name}')
    stats['agents_created'] += 1
    for arkiv_el in el.findall('.//Arkiv'):
        log(f'    Would import fonds: {_txt(arkiv_el, "Arkiv_Namn", "?")}')
        stats['fonds_created'] += 1
        schema = _detect_schema(arkiv_el)
        if schema == 'klass':
            stats['classifications_created'] += len(arkiv_el.findall('.//KlassStrukt'))
            hs_grupp = arkiv_el.find('HandlingsslagGrupp')
            if hs_grupp is not None:
                for hs_el in hs_grupp.findall('HandlingsSlag'):
                    stats['series_created'] += 1
                    stats['volumes_created'] += len(hs_el.findall('.//ForvenhRelGrupp/FörvaringsenhetRel'))
        else:
            for serie_el in arkiv_el.findall('.//SerieAA'):
                stats['series_created'] += 1
                stats['volumes_created'] += len(serie_el.findall('.//Volym'))


# ── CLI command registration ──────────────────────────────────────────

def register_visual_arkiv_import(app):
    @app.cli.command('import-visual-arkiv')
    @click.option('--institution-id', required=True, type=int, help='Target institution ID')
    @click.option('--file', 'filepath', required=True, type=click.Path(exists=True),
                  help='Path to Visual Arkiv XML export file')
    @click.option('--force-agents', is_flag=True, default=False,
                  help='Update existing agents instead of skipping them')
    @click.option('--dry-run', is_flag=True, default=False,
                  help='Parse and count without writing to database')
    @click.option('--batch-size', default=50, type=int,
                  help='Flush session every N Arkivbildare (default 50)')
    @click.option('--verbose', is_flag=True, default=False,
                  help='Print every node as it is created')
    @click.option('--parse-codes', is_flag=True, default=False,
                  help='Build hierarchical trees from codes. '
                       'AA: Y -> Series, Y+Z -> Sub-series, Y+Z+A -> Sub-sub-series. '
                       'Klass: HS_Struktur dot-notation (1.5 becomes child of 1).')
    def import_visual_arkiv(institution_id, filepath, force_agents, dry_run,
                             batch_size, verbose, parse_codes):
        """Import a Visual Arkiv 7 XML export into Kurbits."""
        from app.extensions import db
        from app.models import Institution

        institution = Institution.query.get(institution_id)
        if not institution:
            click.echo(f'ERROR: Institution {institution_id} not found.', err=True)
            sys.exit(1)

        click.echo(f'Visual Arkiv import')
        click.echo(f'  Institution : {institution.name} (ID {institution_id})')
        click.echo(f'  File        : {filepath}')
        click.echo(f'  Dry run     : {dry_run}')
        click.echo(f'  Force agents: {force_agents}')
        click.echo(f'  Parse codes : {parse_codes}')
        click.echo()

        def log(msg):
            if verbose or msg.startswith('\n') or 'ERROR' in msg or 'Created' in msg or 'Fonds' in msg:
                click.echo(msg)

        try:
            stats = _stream_import(
                filepath=filepath,
                institution_id=institution_id,
                force_agents=force_agents,
                dry_run=dry_run,
                batch_size=batch_size,
                parse_codes=parse_codes,
                db=db,
                log=log,
            )

            if not dry_run:
                db.session.commit()
                click.echo('\nCommitted.')
            else:
                db.session.rollback()
                click.echo('\nDry run -- no changes written.')

        except Exception as e:
            db.session.rollback()
            click.echo(f'\nFATAL: {e}', err=True)
            import traceback
            traceback.print_exc()
            sys.exit(1)

        click.echo('\n-- Import summary -----------------------------')
        click.echo(f'  Agents created          : {stats["agents_created"]}')
        click.echo(f'  Agents skipped          : {stats["agents_skipped"]}')
        click.echo(f'  Fonds created           : {stats["fonds_created"]}')
        click.echo(f'  Classifications created : {stats["classifications_created"]}')
        click.echo(f'  Series created          : {stats["series_created"]}')
        click.echo(f'  Volumes created         : {stats["volumes_created"]}')
        if stats['errors']:
            click.echo(f'\n  Errors ({len(stats["errors"])}):')
            for err in stats['errors']:
                click.echo(f'    - {err}')
        else:
            click.echo('\n  No errors.')