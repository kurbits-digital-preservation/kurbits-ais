"""
Converts OAI-PMH HarvestRecord objects into Kurbits Node objects.
"""
from __future__ import annotations
from typing import Optional
from app.extensions import db
from app.models.node import Node, NodeStatus, NodeNote
from app.models.hierarchy import HierarchyType
from app.oaipmh.harvester import HarvestRecord, HarvestResult


class ImportResult:
    def __init__(self):
        self.created: list[dict] = []
        self.skipped: list[str] = []
        self.warnings: list[str] = []

    def to_dict(self) -> dict:
        return {
            'created': self.created,
            'skipped': self.skipped,
            'warnings': self.warnings,
            'total_created': len(self.created),
        }


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
}


def _resolve_level(level_hint: Optional[str],
                   hierarchy_type: HierarchyType,
                   result: ImportResult) -> str:
    available = {l.name.lower(): l.name for l in hierarchy_type.levels}

    if level_hint:
        mapped = EAD_LEVEL_MAP.get(level_hint.lower())
        if mapped and mapped.lower() in available:
            return available[mapped.lower()]
        if level_hint.lower() in available:
            return available[level_hint.lower()]

    # Default to the first (lowest sort_order) level
    levels = sorted(hierarchy_type.levels, key=lambda l: l.sort_order)
    if levels:
        fallback = levels[0].name
        result.warnings.append(
            f'Could not map level "{level_hint}" — using "{fallback}"'
        )
        return fallback

    raise ValueError(f'Hierarchy type "{hierarchy_type.name}" has no levels')


def _unique_local_ref(base: str, institution_id: int,
                      parent_id: Optional[int]) -> str:
    existing = {
        r[0] for r in Node.query
        .filter_by(institution_id=institution_id, parent_id=parent_id)
        .with_entities(Node.local_ref).all()
    }
    if base not in existing:
        return base
    i = 1
    while f'{base}-{i}' in existing:
        i += 1
    return f'{base}-{i}'


def records_to_nodes(harvest: HarvestResult,
                     institution_id: int,
                     hierarchy_type_id: int,
                     parent_node_id: Optional[int],
                     created_by_id: int) -> ImportResult:
    result = ImportResult()
    result.warnings.extend(harvest.warnings)

    hierarchy_type = HierarchyType.query.filter_by(
        id=hierarchy_type_id, institution_id=institution_id
    ).first()
    if not hierarchy_type:
        raise ValueError('Hierarchy type not found')

    parent_node = None
    if parent_node_id:
        parent_node = Node.query.filter_by(
            id=parent_node_id, institution_id=institution_id
        ).first()
        if not parent_node:
            raise ValueError('Parent node not found')

    from app.models import Institution
    institution = db.session.get(Institution, institution_id)

    def _create_node(rec, parent: Optional[Node]) -> Optional[Node]:
        if rec.deleted:
            result.skipped.append(f'{rec.identifier} (deleted)')
            return None
        if not rec.title:
            result.skipped.append(f'{rec.identifier or "(no id)"} (no title)')
            return None

        level_name = _resolve_level(rec.level, hierarchy_type, result)
        if not level_name:
            return None

        # local_ref may be a full path like "SE/GLA/16213/B" — take only the last segment
        raw_ref = (rec.local_ref or
                   (rec.identifier.split(':')[-1] if rec.identifier else '') or
                   'imported')
        # Strip leading path components — keep only what comes after the last '/'
        # that isn't a country/institution prefix shared with the parent
        if parent and '/' in raw_ref:
            parent_ref = parent.ref_code.split('/', 1)[-1]  # strip institution prefix
            if raw_ref.startswith(parent_ref + '/'):
                raw_ref = raw_ref[len(parent_ref) + 1:]
            elif '/' in raw_ref:
                raw_ref = raw_ref.split('/')[-1]
        base_ref = raw_ref or 'imported'
        # Remove any middle dots used as separators in some EAD exports
        base_ref = base_ref.replace('·', '-').strip()
        local_ref = _unique_local_ref(
            base_ref, institution_id,
            parent.id if parent else None
        )

        node = Node(
            institution_id=institution_id,
            title=rec.title,
            local_ref=local_ref,
            level_of_description=level_name,
            hierarchy_type_id=hierarchy_type_id,
            parent=parent,
            description=rec.description,
            scope_and_content=rec.scope_and_content,
            arrangement=rec.arrangement,
            extent=rec.extent,
            language=rec.language,
            access_conditions=rec.access_conditions,
            status=NodeStatus.DRAFT,
            created_by_id=created_by_id,
            updated_by_id=created_by_id,
            metadata_spec={},
        )

        if rec.date_from:
            try:
                from datetime import date as _date
                node.date_start = _date(int(rec.date_from[:4]), 1, 1)
            except (ValueError, TypeError):
                pass
        if rec.date_to:
            try:
                from datetime import date as _date
                node.date_end = _date(int(rec.date_to[:4]), 12, 31)
            except (ValueError, TypeError):
                pass

        # Compute ref_code BEFORE add — ref_code is NOT NULL
        if parent:
            node.ref_code = f'{parent.ref_code}/{local_ref}'
        else:
            node.ref_code = f'{institution.ref_prefix}/{local_ref}'

        db.session.add(node)
        db.session.flush()

        for note_data in rec.notes:
            db.session.add(NodeNote(
                node_id=node.id,
                note_type=note_data.get('type', 'general'),
                content=note_data['content'],
                is_public=False,
                created_by_id=created_by_id,
            ))

        if rec.subjects:
            db.session.add(NodeNote(
                node_id=node.id,
                note_type='general',
                content='Subjects: ' + ', '.join(rec.subjects),
                is_public=False,
                created_by_id=created_by_id,
            ))

        node.record_change(
            change_type='create',
            description=f'Imported via OAI-PMH from {harvest.source_url}',
            created_by_id=created_by_id,
            before_data={},
            after_data=node.to_dict(),
        )

        result.created.append({
            'title': node.title,
            'ref_code': node.ref_code,
            'oai_identifier': rec.identifier,
        })

        # Recursively create child nodes from <dsc>/<c> elements
        for child_rec in rec.children:
            _create_node(child_rec, node)

        return node

    for rec in harvest.records:
        _create_node(rec, parent_node)

    db.session.commit()
    return result