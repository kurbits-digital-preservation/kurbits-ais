"""
Testdata importer — loads JSON fixture files into Kurbits.

Usage:
    flask import-testdata --institution-id 1 --file testdata/grateful_dead.json
    flask import-testdata --institution-id 1 --file testdata/grateful_dead.json --wikidata
    flask import-testdata --institution-id 1 --dir testdata/
    flask import-testdata --institution-id 1 --file testdata/grateful_dead.json --dry-run

Fixture format:
    {
      "agents": [ { "_id": "local_ref", "name": "...", "agent_type": "person|organization|family",
                    "wikidata_id": "Q...", ... } ],
      "fonds": {
        "title": "...", "local_ref": "...", "level": "Fonds",
        "date_from": "...", "date_to": "...",
        "scope_and_content": "...", "description": "...",
        "creators": ["local_ref_of_agent"],
        "notes": [ { "note_type": "...", "content": "...", "is_public": true } ],
        "series": [
          { "title": "...", "local_ref": "...", "level": "Series", ...,
            "files": [ { "title": "...", "local_ref": "...", "level": "File", ...,
                         "agents": [ { "_id": "local_ref", "relation": "creator" } ] } ] }
        ]
      }
    }
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import click


# ── Wikidata lookup ───────────────────────────────────────────────────

def _fetch_wikidata(qid: str, verbose: bool) -> dict:
    """Fetch entity data from Wikidata API. Returns {} on any error."""
    import urllib.request
    import urllib.error

    url = (
        f'https://www.wikidata.org/wiki/Special:EntityData/{qid}.json'
    )
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Kurbits/1.0 (testdata importer)'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        entity = data.get('entities', {}).get(qid, {})
        return entity
    except Exception as e:
        if verbose:
            click.echo(f'    [wikidata] Failed to fetch {qid}: {e}')
        return {}


def _get_claim_value(entity: dict, prop: str) -> str | None:
    """Extract first string/time value from a Wikidata claim."""
    claims = entity.get('claims', {}).get(prop, [])
    if not claims:
        return None
    val = claims[0].get('mainsnak', {}).get('datavalue', {})
    vtype = val.get('type')
    if vtype == 'string':
        return val.get('value')
    if vtype == 'time':
        # Extract year from +YYYY-MM-DDT...
        raw = val.get('value', {}).get('time', '')
        if raw.startswith('+') or raw.startswith('-'):
            return raw[1:5]
        return raw[:4] if raw else None
    if vtype == 'wikibase-entityid':
        return val.get('value', {}).get('id')
    return None


def _get_label(entity: dict, lang: str = 'en') -> str | None:
    labels = entity.get('labels', {})
    return labels.get(lang, labels.get('en', {})).get('value')


def _get_description(entity: dict, lang: str = 'en') -> str | None:
    descs = entity.get('descriptions', {})
    return descs.get(lang, descs.get('en', {})).get('value')


def _enrich_from_wikidata(agent_data: dict, verbose: bool) -> dict:
    """
    Fetch Wikidata entity and fill in missing fields.
    Returns updated agent_data dict.
    """
    qid = agent_data.get('wikidata_id')
    if not qid:
        return agent_data

    if verbose:
        click.echo(f'    [wikidata] Fetching {qid} for {agent_data["name"]}…')
    time.sleep(0.2)  # be polite to Wikidata

    entity = _fetch_wikidata(qid, verbose)
    if not entity:
        return agent_data

    enriched = dict(agent_data)

    # Fill label if name not set
    label = _get_label(entity)
    if label and not enriched.get('name'):
        enriched['name'] = label

    # Description
    desc = _get_description(entity)
    if desc and not enriched.get('description'):
        enriched['description'] = desc

    # Birth date (P569) / Death date (P570)
    # Organisation: inception (P571) / dissolved (P576)
    if enriched.get('agent_type') == 'person':
        if not enriched.get('date_from'):
            enriched['date_from'] = _get_claim_value(entity, 'P569')
        if not enriched.get('date_to'):
            enriched['date_to'] = _get_claim_value(entity, 'P570')
    else:
        if not enriched.get('date_from'):
            enriched['date_from'] = _get_claim_value(entity, 'P571')
        if not enriched.get('date_to'):
            enriched['date_to'] = _get_claim_value(entity, 'P576')

    # VIAF (P214) and ISNI (P213)
    viaf = _get_claim_value(entity, 'P214')
    if viaf and not enriched.get('viaf_id'):
        enriched['viaf_id'] = viaf

    isni = _get_claim_value(entity, 'P213')
    if isni and not enriched.get('isni'):
        enriched['isni'] = isni

    if verbose:
        click.echo(f'    [wikidata] ✓ Enriched: {enriched.get("name")} '
                   f'({enriched.get("date_from", "?")}–{enriched.get("date_to", "")})')

    return enriched


# ── Agent import ──────────────────────────────────────────────────────

def _import_agents(agents_data: list, institution_id: int, system_user_id: int,
                   use_wikidata: bool, dry_run: bool, verbose: bool, db, log) -> dict:
    """
    Import agents from fixture. Returns dict mapping _id → Agent.
    """
    from app.models.agent import Agent, AgentType, AgentNote
    import sqlalchemy as sa

    id_map: dict = {}

    for raw in agents_data:
        local_id = raw.get('_id') or raw.get('name', 'unknown')

        data = dict(raw)

        if use_wikidata and data.get('wikidata_id'):
            data = _enrich_from_wikidata(data, verbose)

        name = data.get('name', 'Unknown')
        agent_type_str = data.get('agent_type', 'organization')

        # Check for existing
        existing = db.session.execute(
            sa.select(Agent).where(
                Agent.institution_id == institution_id,
                Agent.name == name,
            )
        ).scalars().first()

        if existing:
            log(f'  Agent exists, reusing: {name}')
            id_map[local_id] = existing
            continue

        if dry_run:
            log(f'  [dry-run] Would create agent: {name} ({agent_type_str})')
            id_map[local_id] = None
            continue

        try:
            agent_type = AgentType(agent_type_str)
        except ValueError:
            agent_type = AgentType.organization

        # Build identifier string from available external IDs
        identifiers = []
        if data.get('wikidata_id'): identifiers.append(f'wikidata:{data["wikidata_id"]}')
        if data.get('viaf_id'):     identifiers.append(f'viaf:{data["viaf_id"]}')
        if data.get('isni'):        identifiers.append(f'isni:{data["isni"]}')

        agent = Agent(
            institution_id=institution_id,
            name=name,
            authorized_form=data.get('authorized_form') or name,
            agent_type=agent_type,
            date_from=data.get('date_from'),
            date_to=data.get('date_to'),
            description=data.get('description'),
            identifier=' | '.join(identifiers) if identifiers else None,
            created_by_id=system_user_id,
        )
        db.session.add(agent)
        db.session.flush()

        for note in data.get('notes', []):
            db.session.add(AgentNote(
                agent_id=agent.id,
                note_type=note.get('note_type', 'general'),
                content=note.get('content', ''),
                created_by_id=system_user_id,
            ))

        id_map[local_id] = agent
        log(f'  ✓ Agent: {name} ({agent_type_str})'
            + (f' [from Wikidata {data.get("wikidata_id")}]' if data.get('wikidata_id') else ''))

    return id_map


# ── Node import ───────────────────────────────────────────────────────

def _get_or_create_hierarchy(institution_id: int, db) -> tuple:
    """Get default ISAD(G) hierarchy type and levels map."""
    from app.models.hierarchy import HierarchyType, HierarchyLevel, HierarchyEntityType
    import sqlalchemy as sa

    ht = db.session.execute(
        sa.select(HierarchyType).where(
            HierarchyType.institution_id == institution_id,
            HierarchyType.entity_type == HierarchyEntityType.RESOURCE,
            HierarchyType.is_default == True,
        )
    ).scalars().first()

    if not ht:
        ht = db.session.execute(
            sa.select(HierarchyType).where(
                HierarchyType.institution_id == institution_id,
                HierarchyType.entity_type == HierarchyEntityType.RESOURCE,
            )
        ).scalars().first()

    if not ht:
        raise RuntimeError(
            'No resource hierarchy type found. Run flask dev-setup or flask seed-hierarchies first.'
        )

    levels = db.session.execute(
        sa.select(HierarchyLevel).where(
            HierarchyLevel.hierarchy_type_id == ht.id
        )
    ).scalars().all()

    levels_map = {lv.name.lower(): lv for lv in levels}
    return ht, levels_map


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


def _link_agents(node, agents_list: list, agent_id_map: dict, db) -> None:
    """Link agents to a node via agent_node_association."""
    from app.models.agent import agent_node_association
    import sqlalchemy as sa

    for entry in agents_list:
        local_id = entry.get('_id')
        relation = entry.get('relation', 'creator')
        agent = agent_id_map.get(local_id)
        if agent is None:
            continue
        exists = db.session.execute(
            sa.select(agent_node_association).where(
                agent_node_association.c.agent_id == agent.id,
                agent_node_association.c.node_id == node.id,
            )
        ).first()
        if not exists:
            db.session.execute(
                agent_node_association.insert().values(
                    agent_id=agent.id,
                    node_id=node.id,
                    relation_type=relation,
                )
            )


def _import_node(data: dict, parent_id, institution_id: int,
                 ht, levels_map: dict, agent_id_map: dict,
                 system_user_id: int, inst_ref_prefix: str,
                 dry_run: bool, verbose: bool, db, log,
                 depth: int = 0) -> object | None:
    """Recursively import a node and its children."""
    from app.models.node import Node, NodeNote
    import sqlalchemy as sa

    indent = '  ' * (depth + 1)
    title = data.get('title', 'Untitled')
    level_str = data.get('level', 'File')
    local_ref = _make_unique_ref(
        data.get('local_ref', '1'),
        institution_id, parent_id, db, Node
    )

    if dry_run:
        log(f'{indent}[dry-run] Would create {level_str}: {title}')
        # Still recurse so we can count children
        for child in data.get('series', []) + data.get('files', []) + data.get('items', []):
            _import_node(child, None, institution_id, ht, levels_map, agent_id_map,
                         system_user_id, inst_ref_prefix, dry_run, verbose, db, log, depth + 1)
        return None

    # Compute ref_code
    if parent_id is None:
        ref_code = f'{inst_ref_prefix}/{local_ref}'
    else:
        parent = db.session.get(Node, parent_id)
        ref_code = f'{parent.ref_code}/{local_ref}'

    node = Node(
        institution_id=institution_id,
        parent_id=parent_id,
        local_ref=local_ref,
        ref_code=ref_code,
        title=title,
        level_of_description=level_str,
        hierarchy_type_id=ht.id,
        date_start=_parse_year(data.get('date_from')),
        date_end=_parse_year(data.get('date_to'), end=True),
        scope_and_content=data.get('scope_and_content'),
        description=data.get('description'),
        created_by_id=system_user_id,
    )
    db.session.add(node)
    db.session.flush()

    log(f'{indent}✓ {level_str}: {ref_code} — {title}')

    # Notes
    for note in data.get('notes', []):
        db.session.add(NodeNote(
            node_id=node.id,
            note_type=note.get('note_type', 'general'),
            content=note.get('content', ''),
            is_public=note.get('is_public', False),
            created_by_id=system_user_id,
        ))

    # Creator links (fonds-level shorthand)
    for creator_id in data.get('creators', []):
        agent = agent_id_map.get(creator_id)
        if agent:
            from app.models.agent import agent_node_association
            import sqlalchemy as sa
            exists = db.session.execute(
                sa.select(agent_node_association).where(
                    agent_node_association.c.agent_id == agent.id,
                    agent_node_association.c.node_id == node.id,
                )
            ).first()
            if not exists:
                db.session.execute(
                    agent_node_association.insert().values(
                        agent_id=agent.id,
                        node_id=node.id,
                        relation_type='creator',
                    )
                )

    # Agent links (file/item level)
    if data.get('agents'):
        _link_agents(node, data['agents'], agent_id_map, db)

    # Recurse into children
    for child in data.get('series', []) + data.get('files', []) + data.get('items', []):
        _import_node(child, node.id, institution_id, ht, levels_map, agent_id_map,
                     system_user_id, inst_ref_prefix, dry_run, verbose, db, log, depth + 1)

    return node


def _parse_year(year_str: str | None, end: bool = False):
    """Convert year string to Python date."""
    from datetime import date
    if not year_str:
        return None
    try:
        year = int(str(year_str)[:4])
        return date(year, 12, 31) if end else date(year, 1, 1)
    except (ValueError, TypeError):
        return None


# ── Main runner ───────────────────────────────────────────────────────

def _import_fixture(filepath: str, institution_id: int,
                    use_wikidata: bool, dry_run: bool, verbose: bool, db) -> dict:
    """Load and import a single JSON fixture file."""
    from app.models import Institution
    from app.models.institution import user_institution_association

    import sqlalchemy as sa

    with open(filepath, encoding='utf-8') as f:
        fixture = json.load(f)

    stats = {
        'agents': 0, 'nodes': 0, 'errors': []
    }

    institution = db.session.get(Institution, institution_id)
    if not institution:
        raise RuntimeError(f'Institution {institution_id} not found')

    # Get system user for attribution
    system_user_id = db.session.execute(
        sa.select(user_institution_association.c.user_id).where(
            user_institution_association.c.institution_id == institution_id
        ).limit(1)
    ).scalar()
    if not system_user_id:
        raise RuntimeError('No users found for this institution. Run flask dev-setup first.')

    def log(msg):
        if verbose or 'ERROR' in msg or '✓' in msg or '[dry-run]' in msg:
            click.echo(msg)

    # 1. Import agents
    agents_data = fixture.get('agents', [])
    if agents_data:
        click.echo(f'\n  Agents ({len(agents_data)}):')
        agent_id_map = _import_agents(
            agents_data, institution_id, system_user_id,
            use_wikidata, dry_run, verbose, db, log
        )
        stats['agents'] = len([v for v in agent_id_map.values() if v is not None])
    else:
        agent_id_map = {}

    # 2. Import fonds
    fonds_data = fixture.get('fonds')
    if fonds_data:
        click.echo(f'\n  Resources:')
        ht, levels_map = _get_or_create_hierarchy(institution_id, db)
        _import_node(
            fonds_data, None, institution_id,
            ht, levels_map, agent_id_map,
            system_user_id, institution.ref_prefix,
            dry_run, verbose, db, log
        )

    if not dry_run:
        db.session.commit()

    return stats


# ── CLI registration ──────────────────────────────────────────────────

def register_testdata_import(app):

    @app.cli.command('import-testdata')
    @click.option('--institution-id', required=True, type=int,
                  help='Target institution ID')
    @click.option('--file', 'filepath', default=None, type=click.Path(exists=True),
                  help='Path to a single JSON fixture file')
    @click.option('--dir', 'dirpath', default=None, type=click.Path(exists=True, file_okay=False),
                  help='Directory of JSON fixture files (imports all *.json files)')
    @click.option('--wikidata/--no-wikidata', default=False,
                  help='Fetch enrichment data from Wikidata for agents with a wikidata_id')
    @click.option('--dry-run', is_flag=True, default=False,
                  help='Parse and validate without writing to database')
    @click.option('--verbose', is_flag=True, default=False,
                  help='Show every created record')
    def import_testdata(institution_id, filepath, dirpath, wikidata, dry_run, verbose):
        """Import testdata from JSON fixture files into Kurbits."""
        from app.extensions import db

        if not filepath and not dirpath:
            click.echo('ERROR: Provide --file or --dir', err=True)
            sys.exit(1)

        files = []
        if filepath:
            files.append(filepath)
        if dirpath:
            files.extend(sorted(Path(dirpath).glob('*.json')))

        if not files:
            click.echo('No JSON files found.', err=True)
            sys.exit(1)

        click.echo(f'\n── Kurbits testdata import ────────────────────────')
        click.echo(f'  Institution : {institution_id}')
        click.echo(f'  Files       : {len(files)}')
        click.echo(f'  Wikidata    : {wikidata}')
        click.echo(f'  Dry run     : {dry_run}')

        total_agents = 0
        total_nodes = 0
        errors = []

        for fp in files:
            click.echo(f'\n  → {Path(fp).name}')
            try:
                stats = _import_fixture(
                    str(fp), institution_id, wikidata, dry_run, verbose, db
                )
                total_agents += stats['agents']
                errors.extend(stats.get('errors', []))
            except Exception as e:
                db.session.rollback()
                click.echo(f'  ERROR: {e}', err=True)
                if verbose:
                    import traceback
                    traceback.print_exc()
                errors.append(f'{Path(fp).name}: {e}')

        if dry_run:
            db.session.rollback()
            click.echo('\nDry run — no changes written.')
        else:
            click.echo('\nCommitted.')

        click.echo('\n── Summary ──────────────────────────────────────────')
        click.echo(f'  Files processed : {len(files)}')
        click.echo(f'  Agents created  : {total_agents}')
        if errors:
            click.echo(f'\n  Errors ({len(errors)}):')
            for e in errors:
                click.echo(f'    • {e}')
        else:
            click.echo('  No errors.')