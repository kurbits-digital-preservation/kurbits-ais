from __future__ import annotations

import csv
import io
import json as _json
from pathlib import Path
from typing import Callable, Optional

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
_env.filters['tojson'] = lambda v: _json.dumps(v, ensure_ascii=False)


Builder = Callable[[dict, bool], bytes]


class ExportFormat:
    def __init__(self, label: str, mime_type: str, extension: str,
                 template: Optional[str] = None,
                 builder: Optional[Builder] = None):
        if not template and not builder:
            raise ValueError('ExportFormat needs either a template or a builder')
        self.label = label
        self.template = template
        self.builder = builder
        self.mime_type = mime_type
        self.extension = extension


# ── CSV (Excel-compatible) ──────────────────────────────────────────

CSV_DELIMITER = ';'
CSV_MULTI_SEPARATOR = ' | '
_FORMULA_PREFIXES = ('=', '+', '-', '@', '\t', '\r')


def _join(items: list[str]) -> str:
    return CSV_MULTI_SEPARATOR.join(i for i in items if i)


def _agents_cell(n: dict) -> str:
    return _join([
        f"{a['name']} ({a['relation_type']})" if a.get('relation_type') else a['name']
        for a in n.get('agents') or []
    ])


def _creators_cell(n: dict) -> str:
    return _join([a['name'] for a in n.get('creators') or []])


def _classifications_cell(n: dict) -> str:
    return _join([
        f"{c['full_code']} {c['name']}".strip()
        for c in n.get('classifications') or []
    ])


def _notes_cell(n: dict) -> str:
    return _join([
        f"{note['type']}: {note['content']}" if note.get('type') else note['content']
        for note in n.get('notes') or []
        if note.get('content')
    ])


CSV_COLUMNS: list[tuple[str, Callable[[dict], object]]] = [
    ('Reference code', lambda n: n.get('ref_code')),
    ('Local reference', lambda n: n.get('local_ref')),
    ('Parent reference code', lambda n: n.get('_parent_ref')),
    ('Depth', lambda n: n.get('_depth')),
    ('Level of description', lambda n: n.get('level')),
    ('Title', lambda n: n.get('title')),
    ('Date', lambda n: n.get('date_display')),
    ('Start date', lambda n: n.get('date_start')),
    ('End date', lambda n: n.get('date_end')),
    ('Date certainty', lambda n: n.get('date_certainty')),
    ('Extent', lambda n: n.get('extent')),
    ('Language', lambda n: n.get('language')),
    ('Creators', _creators_cell),
    ('Agents', _agents_cell),
    ('Administrative/biographical history', lambda n: n.get('description')),
    ('Scope and content', lambda n: n.get('scope_and_content')),
    ('Arrangement', lambda n: n.get('arrangement')),
    ('Conditions governing access', lambda n: n.get('access_conditions')),
    ('Conditions governing reproduction', lambda n: n.get('reproduction_conditions')),
    ('Finding aids', lambda n: n.get('finding_aids')),
    ('Classification', _classifications_cell),
    ('Notes', _notes_cell),
    ('Status', lambda n: n.get('status')),
    ('Institution', lambda n: n.get('institution_name')),
    ('Created', lambda n: n.get('created_at')),
    ('Created by', lambda n: n.get('created_by')),
    ('Updated', lambda n: n.get('updated_at')),
    ('Updated by', lambda n: n.get('updated_by')),
]


def _csv_safe(value) -> str:
    if value is None:
        return ''
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if text.startswith(_FORMULA_PREFIXES):
        return "'" + text
    return text


def _walk(node_dict: dict, depth: int = 0, parent_ref: str = ''):
    yield {**node_dict, '_depth': depth, '_parent_ref': parent_ref}
    for child in node_dict.get('children') or []:
        yield from _walk(child, depth + 1, node_dict.get('ref_code') or '')


def _render_csv(node_data: dict, include_children: bool) -> bytes:
    buffer = io.StringIO(newline='')
    writer = csv.writer(
        buffer,
        delimiter=CSV_DELIMITER,
        quoting=csv.QUOTE_ALL,
        lineterminator='\r\n',
    )
    writer.writerow([header for header, _ in CSV_COLUMNS])

    rows = _walk(node_data) if include_children else [
        {**node_data, '_depth': 0, '_parent_ref': ''}
    ]
    for row in rows:
        writer.writerow([_csv_safe(getter(row)) for _, getter in CSV_COLUMNS])

    return ('\ufeff' + buffer.getvalue()).encode('utf-8')


# ── Format registry ─────────────────────────────────────────────────

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
    'csv': ExportFormat(
        label='CSV (Excel)',
        builder=_render_csv,
        mime_type='text/csv; charset=utf-8',
        extension='csv',
    ),
}


def list_formats() -> list[dict]:
    return [
        {'id': k, 'label': v.label, 'mime_type': v.mime_type,
         'extension': v.extension}
        for k, v in FORMATS.items()
    ]


def _flatten(node_dict: dict) -> list[dict]:
    result = [node_dict]
    for child in node_dict.get('children', []):
        result.extend(_flatten(child))
    return result


# ── Render entry point ──────────────────────────────────────────────

def render_export(node: Node, format_id: str,
                  include_children: bool = True) -> tuple[bytes, ExportFormat]:
    if format_id not in FORMATS:
        raise ValueError(f'Unknown export format: {format_id}. '
                         f'Available: {", ".join(FORMATS)}')

    fmt = FORMATS[format_id]
    node_data = serialize_node(node, include_children=include_children)

    if fmt.builder:
        return fmt.builder(node_data, include_children), fmt

    all_nodes = _flatten(node_data) if include_children else [node_data]
    template = _env.get_template(fmt.template)
    rendered = template.render(
        node=node_data,
        all_nodes=all_nodes,
        include_children=include_children,
    )
    return rendered.encode('utf-8'), fmt