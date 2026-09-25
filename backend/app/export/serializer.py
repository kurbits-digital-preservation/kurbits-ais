from __future__ import annotations
from typing import Optional
from app.models.node import Node


def _date_str(d) -> Optional[str]:
    return d.isoformat() if d else None


def _year(d) -> Optional[str]:
    return str(d.year) if d else None


def serialize_node(node: Node, include_children: bool = True) -> dict:
    """Serialize a node and optionally its full descendant tree."""
    institution = node.institution

    agents = []
    for row in node.agents:
        from app.models.agent import agent_node_association
        from app.extensions import db
        import sqlalchemy as sa
        rel = db.session.execute(
            sa.select(agent_node_association.c.relation_type).where(
                agent_node_association.c.agent_id == row.id,
                agent_node_association.c.node_id == node.id,
            )
        ).scalar_one_or_none()
        agents.append({
            'name': row.name,
            'authorized_form': row.authorized_form,
            'agent_type': row.agent_type.value,
            'relation_type': rel or '',
            'identifier': row.identifier,
        })

    classifications = []
    for c in node.classifications:
        classifications.append({
            'name': c.name,
            'full_code': c.get_full_code(),
        })

    notes = [
        {
            'type': n.note_type,
            'content': n.content,
            'is_public': n.is_public,
        }
        for n in node.notes
    ]

    data = {

        'id': node.id,
        'ref_code': node.ref_code,
        'local_ref': node.local_ref,
        'title': node.title,
        'level': node.level_of_description,


        'institution_name': institution.name if institution else '',
        'institution_ref_prefix': institution.ref_prefix if institution else '',
        'country_code': institution.country_code if institution else '',


        'date_start': _date_str(node.date_start),
        'date_end': _date_str(node.date_end),
        'date_start_year': _year(node.date_start),
        'date_end_year': _year(node.date_end),
        'date_certainty': node.date_certainty,
        'date_display': _build_date_display(node),


        'description': node.description,
        'scope_and_content': node.scope_and_content,
        'arrangement': node.arrangement,
        'extent': node.extent,
        'language': node.language,
        'access_conditions': node.access_conditions,
        'reproduction_conditions': node.reproduction_conditions,
        'finding_aids': node.finding_aids,


        'metadata_spec': node.metadata_spec or {},
        'status': node.status.value,


        'agents': agents,
        'creators': [a for a in agents if a['relation_type'].lower() in ('creator', 'author', 'originator')],
        'classifications': classifications,
        'notes': notes,
        'public_notes': [n for n in notes if n['is_public']],


        'parent_id': node.parent_id,
        'breadcrumb': node.get_breadcrumb(),


        'created_at': node.created_at.isoformat(),
        'updated_at': node.updated_at.isoformat(),
        'created_by': node.created_by.username if node.created_by else None,
        'updated_by': node.updated_by.username if node.updated_by else None,
    }

    if include_children:
        children = node.children.order_by(Node.local_ref).all()
        data['children'] = [
            serialize_node(child, include_children=True)
            for child in children
        ]
        data['has_children'] = len(data['children']) > 0
    else:
        data['children'] = []
        data['has_children'] = node.children.count() > 0

    return data


def _build_date_display(node: Node) -> str:
    if not node.date_start and not node.date_end:
        return ''
    start = _year(node.date_start) or '?'
    end = _year(node.date_end)
    if not end or end == start:
        return start
    return f'{start}–{end}'