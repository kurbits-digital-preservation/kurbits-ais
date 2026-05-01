"""
Template-based export engine for Kurbits.

Renders a node (and optional descendants) using a Jinja2 template.
New formats: add a template file + register in FORMATS.
"""
from __future__ import annotations
from pathlib import Path
from jinja2 import Environment, FileSystemLoader, select_autoescape
from app.export.serializer import serialize_node
from app.models.node import Node


TEMPLATE_DIR = Path(__file__).parent / 'templates'

_env = Environment(
    loader=FileSystemLoader(str(TEMPLATE_DIR)),
    autoescape=select_autoescape(['xml', 'html']),
    trim_blocks=True,
    lstrip_blocks=True,
)

# Add tojson filter (Jinja2 doesn't include it by default outside Flask)
import json as _json
_env.filters['tojson'] = lambda v: _json.dumps(v, ensure_ascii=False)


# ── Format registry ───────────────────────────────────────────────────

class ExportFormat:
    def __init__(self, label: str, template: str,
                 mime_type: str, extension: str):
        self.label = label
        self.template = template
        self.mime_type = mime_type
        self.extension = extension


FORMATS: dict[str, ExportFormat] = {
    'ead2002': ExportFormat(
        label='EAD 2002',
        template='ead2002.xml',
        mime_type='application/xml',
        extension='xml',
    ),
    'dublin_core': ExportFormat(
        label='Dublin Core (OAI-DC)',
        template='dublin_core.xml',
        mime_type='application/xml',
        extension='xml',
    ),
    'jsonld': ExportFormat(
        label='JSON-LD (schema.org)',
        template='jsonld.json',
        mime_type='application/ld+json',
        extension='jsonld',
    ),
}


def list_formats() -> list[dict]:
    return [
        {'id': k, 'label': v.label, 'mime_type': v.mime_type,
         'extension': v.extension}
        for k, v in FORMATS.items()
    ]


def _flatten(node_dict: dict) -> list[dict]:
    """Depth-first list of all nodes — used by Dublin Core collection."""
    result = [node_dict]
    for child in node_dict.get('children', []):
        result.extend(_flatten(child))
    return result


def render_export(node: Node, format_id: str,
                  include_children: bool = True) -> tuple[bytes, ExportFormat]:
    """
    Render a node using the named template.
    Returns (rendered_bytes, format_obj).
    """
    if format_id not in FORMATS:
        raise ValueError(f'Unknown export format: {format_id}. '
                         f'Available: {", ".join(FORMATS)}')

    fmt = FORMATS[format_id]
    node_data = serialize_node(node, include_children=include_children)
    all_nodes = _flatten(node_data) if include_children else [node_data]

    template = _env.get_template(fmt.template)
    rendered = template.render(
        node=node_data,
        all_nodes=all_nodes,
        include_children=include_children,
    )

    return rendered.encode('utf-8'), fmt