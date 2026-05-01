"""
Visual Arkiv 7 XML import.

Usage:
    flask import-visual-arkiv --institution-id 1 --file export.xml
    flask import-visual-arkiv --institution-id 1 --file export.xml --force-agents
    flask import-visual-arkiv --institution-id 1 --file export.xml --dry-run

Structure mapping:
    Arkivbildare  → Agent (organization / person / family)
    Arkiv         → Node level=Fonds
    SerieAA       → Node level=Series (child of Fonds)
    Volym         → Node level=Volume  (child of Series)

The importer uses iterparse so it handles arbitrarily large files.
"""
from __future__ import annotations

import re
import sys
import click
from xml.etree.ElementTree import iterparse


# ── Helpers ───────────────────────────────────────────────────────────

def _txt(el, tag: str, default: str = '') -> str:
    """Get trimmed text of a child element, or default."""
    child = el.find(tag)
    if child is None or not child.text:
        return default
    return child.text.strip()


def _serie_code(el) -> str:
    """Compose serie reference: Y + Z + A  e.g. 'A', '1' → 'A1'; 'F', '2', 'a' → 'F2a'."""
    y = _txt(el, 'Serie_Y', '').strip()
    z = _txt(el, 'Serie_Z', '').strip()
    a = _txt(el, 'Serie_A', '').strip()
    code = y
    if z and z != '0':
        code += z
    if a:
        code += a
    return code or 'X'


def _ips_to_agent_type(ips: str) -> str:
    mapping = {
        'I': 'organization',
        'P': 'person',
        'S': 'organization',  # Stiftelse/förening → organization
        'F': 'family',
    }
    return mapping.get(ips.upper(), 'organization')


def _hyllmeter(raw: str) -> str | None:
    """Convert mm integer to readable extent string."""
    if not raw or raw == '0':
        return None
    try:
        mm = int(raw)
        if mm == 0:
            return None
        metres = mm / 1000
        return f'{metres:.1f} hm'
    except ValueError:
        return None


def _make_unique_ref(base_ref: str, institution_id: int, parent_id, db, Node) -> str:
    """Ensure local_ref is unique within parent scope by appending suffix if needed."""
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


# ── Hierarchy bootstrap ───────────────────────────────────────────────

def _ensure_va_hierarchy(institution_id: int, db, log) -> tuple:
    """
    Find or create an ISAD(G) hierarchy extended with 'Volume' level.
    Returns (hierarchy_type, {level_name: HierarchyLevel}).
    """
    from app.models import HierarchyType, HierarchyLevel, HierarchyEntityType
    import sqlalchemy as sa

    # Prefer existing ISAD(G) or create Visual Arkiv specific type
    ht = db.session.execute(
        sa.select(HierarchyType).where(
            HierarchyType.institution_id == institution_id,
            HierarchyType.entity_type == HierarchyEntityType.RESOURCE,
        ).order_by(HierarchyType.is_default.desc())
    ).scalars().first()

    if not ht:
        log('  Creating ISAD(G) hierarchy type…')
        ht = HierarchyType(
            institution_id=institution_id,
            name='ISAD(G)',
            description='General International Standard Archival Description',
            entity_type=HierarchyEntityType.RESOURCE,
            is_default=True,
        )
        db.session.add(ht)
        db.session.flush()

    # Collect existing levels
    existing = {
        lv.name.lower(): lv
        for lv in db.session.execute(
            sa.select(HierarchyLevel).where(
                HierarchyLevel.hierarchy_type_id == ht.id
            )
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
    levels['Volume'] = _get_or_create_level('Volume', 4, True)

    # Ensure Series → Volume and Fonds → Series parent-child relations exist
    from app.models.hierarchy import hierarchy_level_relationships as hierarchy_level_relations
    for parent, child in [
        (levels['Fonds'], levels['Series']),
        (levels['Fonds'], levels['Volume']),
        (levels['Series'], levels['Volume']),
    ]:
        exists = db.session.execute(
            sa.select(hierarchy_level_relations).where(
                hierarchy_level_relations.c.parent_id == parent.id,
                hierarchy_level_relations.c.child_id == child.id,
            )
        ).first()
        if not exists:
            db.session.execute(
                hierarchy_level_relations.insert().values(
                    parent_id=parent.id,
                    child_id=child.id,
                )
            )

    db.session.flush()
    return ht, levels



def _year_to_date(year_str: str | None, end: bool = False):
    """Convert year string to Python date. end=True gives Dec 31."""
    from datetime import date as date_cls
    if not year_str or not year_str.strip():
        return None
    # Extract first 4-digit year
    m = re.search(r'\d{4}', year_str)
    if not m:
        return None
    year = int(m.group())
    if end:
        return date_cls(year, 12, 31)
    return date_cls(year, 1, 1)

# ── Agent import ──────────────────────────────────────────────────────

def _get_system_user_id(institution_id: int, db) -> int | None:
    """Find any admin/archivist user in the institution for note attribution."""
    from app.models.user import User
    from app.models.institution import user_institution_association
    import sqlalchemy as sa
    result = db.session.execute(
        sa.select(user_institution_association.c.user_id).where(
            user_institution_association.c.institution_id == institution_id
        ).limit(1)
    ).scalar()
    return result


def _import_agent(el, institution_id: int, force: bool, db, log) -> tuple:
    """
    Parse <Arkivbildare> element and create/find Agent.
    Returns (agent, created_bool).
    """
    from app.models.agent import Agent, AgentType, AgentNote
    import sqlalchemy as sa
    system_user_id = _get_system_user_id(institution_id, db)

    name = _txt(el, 'Arkivb_Namn') or _txt(el, 'Arkivb_NamnUtskr') or 'Unknown'
    ips_type = _txt(el, 'Arkivb_IPSTyp', 'I')
    agent_type_str = _ips_to_agent_type(ips_type)
    date_from = _txt(el, 'Arkivb_Verksamf') or None
    date_to   = _txt(el, 'Arkivb_Verksamt') or None
    description = _txt(el, 'Arkivb_Sammanfattning') or None

    # Check for existing agent with same name
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

    # History note
    historik = _txt(el, './/Historik_Historik')
    if historik:
        # Remove or update existing history note
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


# ── Node import ───────────────────────────────────────────────────────

def _import_arkiv(el, agent, institution_id: int, ht, levels, db, log, system_user_id=None) -> object:
    """Parse <Arkiv> → Fonds node."""
    from app.models.node import Node, NodeNote
    import sqlalchemy as sa

    name      = _txt(el, 'Arkiv_Namn') or _txt(el, 'Arkiv_NamnUtskr') or 'Untitled'
    nr        = _txt(el, 'Arkiv_Nr', '1')
    date_from = _txt(el, 'Arkiv_Tidarkivf') or None
    date_to   = _txt(el, 'Arkiv_Tidarkivt') or None
    notes_txt = _txt(el, 'Arkiv_Anteckningar') or None
    placering = _txt(el, 'Arkiv_Placering') or None
    sekretess = _txt(el, 'Arkiv_Sekretess', '0')

    extent = _hyllmeter(_txt(el, 'Arkiv_HyllmeterMetric'))

    description_parts = []
    if extent:
        description_parts.append(f'Extent: {extent}')
    if placering:
        description_parts.append(f'Location: {placering}')
    if sekretess == '1':
        sek_text = _txt(el, 'Arkiv_SekretessText') or 'Secrecy restrictions apply'
        description_parts.append(f'Access restrictions: {sek_text}')

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
        description='\n'.join(description_parts) if description_parts else None,
    )
    from app.models import Institution as _Inst
    _inst = db.session.get(_Inst, institution_id)
    node.ref_code = f'{_inst.ref_prefix}/{local_ref}'
    db.session.add(node)
    db.session.flush()

    if notes_txt:
        db.session.add(NodeNote(node_id=node.id, note_type='general', content=notes_txt, created_by_id=system_user_id))

    historik = _txt(el, 'Arkiv_Historik')
    if historik:
        db.session.add(NodeNote(node_id=node.id, note_type='administrative_history', content=historik, created_by_id=system_user_id))

    log(f'    Fonds: {node.ref_code} — {name}')
    return node


def _import_serie(el, fonds_node, institution_id: int, ht, levels, db, log, system_user_id=None) -> object:
    """Parse <SerieAA> → Series node."""
    from app.models.node import Node, NodeNote
    import sqlalchemy as sa

    title     = _txt(el, 'Serie_Serierubrik') or 'Untitled series'
    code      = _serie_code(el)
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
        disposition = f'Appraisal: scheduled for disposal'
        if gallr_ar:
            disposition += f' ({gallr_ar})'
        if gallr_txt:
            disposition += f' — {gallr_txt}'
        description_parts.append(disposition)

    local_ref = _make_unique_ref(code, institution_id, fonds_node.id, db, Node)

    node = Node(
        institution_id=institution_id,
        parent_id=fonds_node.id,
        local_ref=local_ref,
        title=title,
        level_of_description='Series',
        hierarchy_type_id=ht.id,
        date_start=None,
        date_end=None,
        description='\n'.join(description_parts) if description_parts else None,
    )
    node.ref_code = f'{fonds_node.ref_code}/{local_ref}'
    db.session.add(node)
    db.session.flush()

    if notes_txt:
        db.session.add(NodeNote(node_id=node.id, note_type='general', content=notes_txt, created_by_id=system_user_id))

    log(f'      Series: {node.ref_code} — {title}')
    return node


def _import_volym(el, serie_node, institution_id: int, ht, db, log, vol_idx: int, system_user_id=None) -> object:
    """Parse <Volym> → Volume node (OtherLevel='Volume')."""
    from app.models.node import Node, NodeNote
    import sqlalchemy as sa

    volnr     = _txt(el, 'Volym_Volnr') or str(vol_idx)
    vonr      = _txt(el, 'Volym_Vonr') or volnr
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
    forvtyp   = _txt(el, 'Volyml_FörvaringsenhetTyp') or None

    # Title: volume number + date range
    title = f'Vol. {volnr}'
    if tid:
        title += f' ({tid})'

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
        disp = f'Appraisal: scheduled for disposal'
        if gallr_ar:
            disp += f' ({gallr_ar})'
        if gallr_txt:
            disp += f' — {gallr_txt}'
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

    if anm:
        db.session.add(NodeNote(node_id=node.id, note_type='general', content=anm, created_by_id=system_user_id))

    log(f'        Volume: {node.ref_code} — {title}')
    return node


def _link_agent_to_node(agent, fonds_node, institution_id: int, db) -> None:
    """Link agent as creator of fonds (relation_type is a plain string column)."""
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


# ── Main iterparse walk ───────────────────────────────────────────────

def _stream_import(filepath: str, institution_id: int, force_agents: bool,
                   dry_run: bool, batch_size: int, db, log) -> dict:
    """
    Stream-parse the Visual Arkiv XML using iterparse.
    Accumulates full <Arkivbildare> subtrees in memory (one at a time)
    to handle arbitrarily large files.
    """
    import io
    from xml.etree.ElementTree import Element, tostring, fromstring

    stats = {
        'agents_created': 0, 'agents_skipped': 0,
        'fonds_created': 0, 'series_created': 0, 'volumes_created': 0,
        'errors': [],
    }

    # Ensure hierarchy exists
    ht, levels = _ensure_va_hierarchy(institution_id, db, log)

    # We need to accumulate full <Arkivbildare> subtrees
    # Use iterparse to find start/end of each Arkivbildare
    # iterparse reads bytes directly — handles iso-8859-1 and utf-8
    # We detect encoding from the XML declaration if present
    import io

    # Detect encoding from first bytes
    with open(filepath, 'rb') as fh:
        header = fh.read(200).decode('ascii', errors='replace')
    enc_match = re.search(r'encoding=["\']([^"\']+)["\']', header)
    file_encoding = enc_match.group(1) if enc_match else 'utf-8'

    # lxml handles iso-8859-1 and non-ASCII tag names natively
    # Open as binary — lxml reads encoding from the XML declaration
    from lxml import etree as lxmletree

    context = lxmletree.iterparse(filepath, events=('start', 'end'), recover=True)

    current_arkivbildare: Element | None = None
    depth = 0
    target_tag = 'Arkivbildare'
    inside = False
    arkivbildare_count = 0

    for event, el in context:
        # Strip namespace if present
        tag = el.tag.split('}')[-1] if '}' in el.tag else el.tag

        if event == 'start' and tag == target_tag:
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
                    # Full Arkivbildare element is now populated
                    inside = False
                    arkivbildare_count += 1
                    log(f'\nProcessing Arkivbildare #{arkivbildare_count}…')

                    try:
                        if not dry_run:
                            _process_arkivbildare(
                                current_arkivbildare, institution_id,
                                force_agents, ht, levels, db, log, stats
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

                    # Free memory
                    current_arkivbildare = None
                    el.clear()

    return stats


def _process_arkivbildare(el, institution_id, force_agents, ht, levels, db, log, stats):
    """Process one complete <Arkivbildare> element."""
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

        for serie_el in arkiv_el.findall('.//SerieAA'):
            serie = _import_serie(serie_el, fonds, institution_id, ht, levels, db, log, system_user_id)
            stats['series_created'] += 1

            for vol_idx, volym_el in enumerate(serie_el.findall('.//Volym'), start=1):
                _import_volym(volym_el, serie, institution_id, ht, db, log, vol_idx, system_user_id)
                stats['volumes_created'] += 1


def _dry_run_arkivbildare(el, log, stats):
    """Count what would be imported without touching DB."""
    name = _txt(el, 'Arkivb_Namn', '?')
    log(f'  Would import agent: {name}')
    stats['agents_created'] += 1
    for arkiv_el in el.findall('.//Arkiv'):
        log(f'    Would import fonds: {_txt(arkiv_el, "Arkiv_Namn", "?")}')
        stats['fonds_created'] += 1
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
    def import_visual_arkiv(institution_id, filepath, force_agents, dry_run,
                             batch_size, verbose):
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
                db=db,
                log=log,
            )

            if not dry_run:
                db.session.commit()
                click.echo('\nCommitted.')
            else:
                db.session.rollback()
                click.echo('\nDry run — no changes written.')

        except Exception as e:
            db.session.rollback()
            click.echo(f'\nFATAL: {e}', err=True)
            import traceback
            traceback.print_exc()
            sys.exit(1)

        click.echo('\n── Import summary ─────────────────────────────')
        click.echo(f'  Agents created : {stats["agents_created"]}')
        click.echo(f'  Agents skipped : {stats["agents_skipped"]}')
        click.echo(f'  Fonds created  : {stats["fonds_created"]}')
        click.echo(f'  Series created : {stats["series_created"]}')
        click.echo(f'  Volumes created: {stats["volumes_created"]}')
        if stats['errors']:
            click.echo(f'\n  Errors ({len(stats["errors"])}):')
            for err in stats['errors']:
                click.echo(f'    • {err}')
        else:
            click.echo('\n  No errors.')