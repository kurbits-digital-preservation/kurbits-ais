"""
PDF report generators for Kurbits:
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether,
)
from reportlab.platypus.flowables import Flowable




INK       = colors.HexColor('#1a1a2e')
INK_MUTED = colors.HexColor('#555555')
INK_FAINT = colors.HexColor('#888888')
ACCENT    = colors.HexColor('#2563eb')
BORDER    = colors.HexColor('#dddddd')
BG_SUBTLE = colors.HexColor('#f8f8f8')
BG_HEADER = colors.HexColor('#1a1a2e')


def _styles():
    base = getSampleStyleSheet()

    def S(name, **kw):

        defaults = {
            'fontName': 'Helvetica',
            'fontSize': 10,
            'textColor': INK,
            'leading': 14
        }

        defaults.update(kw)
        return ParagraphStyle(name, **defaults)

    return {
        'h1': S('h1', fontSize=22, fontName='Helvetica-Bold', leading=28, spaceAfter=6),
        'h2': S('h2', fontSize=16, fontName='Helvetica-Bold', leading=22, spaceAfter=4),
        'h3': S('h3', fontSize=12, fontName='Helvetica-Bold', leading=17, spaceAfter=3),
        'h4': S('h4', fontSize=10, fontName='Helvetica-Bold', leading=14, spaceAfter=2),
        'body': S('body', fontSize=9, leading=13, spaceAfter=4),
        'small': S('small', fontSize=8, textColor=INK_MUTED, leading=11),
        'faint': S('faint', fontSize=8, textColor=INK_FAINT, leading=11),
        'ref': S('ref', fontSize=9, fontName='Helvetica-Bold', textColor=ACCENT),
        'label': S('label', fontSize=7, fontName='Helvetica-Bold', textColor=INK_FAINT,
                   leading=10, spaceAfter=1),
        'toc': S('toc', fontSize=9, leading=14),
        'toc_ref': S('toc_ref', fontSize=9, fontName='Helvetica-Bold', textColor=ACCENT,
                     leading=14),
        'center': S('center', fontSize=9, alignment=TA_CENTER, leading=14),
    }


def _year(d) -> str:
    if not d:
        return ''
    if hasattr(d, 'year'):
        return str(d.year)
    return str(d)[:4]


def _date_range(node) -> str:
    y1 = _year(node.get('date_start') or node.get('date_from'))
    y2 = _year(node.get('date_end') or node.get('date_to'))
    if y1 and y2 and y1 != y2:
        return f'{y1}–{y2}'
    return y1 or y2 or ''




def _make_page_template(title: str, institution: str):
    """Returns onFirstPage and onLaterPages callbacks."""
    print_date = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    def _header_footer(canvas, doc, show_header=True):
        canvas.saveState()
        w, h = A4

        if show_header and doc.page > 1:

            canvas.setStrokeColor(BORDER)
            canvas.setLineWidth(0.5)
            canvas.line(15*mm, h - 14*mm, w - 15*mm, h - 14*mm)

            canvas.setFont('Helvetica', 7)
            canvas.setFillColor(INK_FAINT)
            canvas.drawString(15*mm, h - 11*mm, title)

            canvas.drawRightString(w - 15*mm, h - 11*mm, institution)


        canvas.setStrokeColor(BORDER)
        canvas.setLineWidth(0.5)
        canvas.line(15*mm, 12*mm, w - 15*mm, 12*mm)
        canvas.setFont('Helvetica', 7)
        canvas.setFillColor(INK_FAINT)
        canvas.drawString(15*mm, 9*mm, f'Printed {print_date}')
        canvas.drawCentredString(w / 2, 9*mm, 'Kurbits AIS')
        canvas.drawRightString(w - 15*mm, 9*mm, f'Page {doc.page}')
        canvas.restoreState()

    def on_first(canvas, doc):
        _header_footer(canvas, doc, show_header=False)

    def on_later(canvas, doc):
        _header_footer(canvas, doc, show_header=True)

    return on_first, on_later




def _collect_tree(node_id: int, institution_id: int, db, max_depth: int = 10) -> dict:
    """Recursively load node tree with agents and notes."""
    from app.models.node import Node
    from app.models.agent import Agent, agent_node_association
    import sqlalchemy as sa

    node = db.session.get(Node, node_id)
    if not node or node.institution_id != institution_id:
        return {}


    rows = db.session.execute(
        sa.select(Agent, agent_node_association.c.relation_type)
        .join(agent_node_association, Agent.id == agent_node_association.c.agent_id)
        .where(agent_node_association.c.node_id == node_id)
    ).all()
    agents = [{'name': a.name, 'relation': rel, 'date_from': a.date_from, 'date_to': a.date_to}
              for a, rel in rows]


    location_path = None
    if node.current_location_id:
        from app.models.location import Location
        loc = db.session.get(Location, node.current_location_id)
        if loc:
            location_path = loc.get_full_path()

    result = {
        'id': node.id,
        'ref_code': node.ref_code,
        'local_ref': node.local_ref,
        'title': node.title,
        'level': node.level_of_description,
        'date_start': node.date_start,
        'date_end': node.date_end,
        'scope_and_content': node.scope_and_content,
        'description': node.description,
        'extent': node.extent,
        'access_conditions': node.access_conditions,
        'arrangement': node.arrangement,
        'notes': [{'type': n.note_type, 'content': n.content, 'is_public': n.is_public}
                  for n in node.notes],
        'agents': agents,
        'location_path': location_path,
        'children': [],
    }

    if max_depth > 0:
        for child in node.children.order_by(Node.local_ref).all():
            child_data = _collect_tree(child.id, institution_id, db, max_depth - 1)
            if child_data:
                result['children'].append(child_data)

    return result




def generate_finding_aid(node_id: int, institution_id: int, db) -> bytes:
    """Generate a full finding aid PDF for a node and its descendants."""
    from app.models import Institution

    institution = db.session.get(Institution, institution_id)
    inst_name = institution.name if institution else ''

    tree = _collect_tree(node_id, institution_id, db)
    if not tree:
        raise ValueError('Node not found')

    ST = _styles()
    buf = io.BytesIO()

    title_str = tree['title']
    date_str = _date_range(tree)

    on_first, on_later = _make_page_template(
        f'{title_str} — Finding Aid', inst_name
    )

    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=20*mm, rightMargin=20*mm,
        topMargin=22*mm, bottomMargin=20*mm,
    )

    story = []


    story.append(Spacer(1, 20*mm))


    story.append(Paragraph(inst_name.upper(), ST['label']))
    story.append(Spacer(1, 2*mm))

    story.append(Paragraph('FINDING AID', ParagraphStyle(
        'fa_title', fontName='Helvetica-Bold', fontSize=32,
        textColor=BG_HEADER, leading=38, spaceAfter=6,
    )))
    story.append(HRFlowable(width='100%', thickness=2, color=ACCENT, spaceAfter=8))

    story.append(Paragraph(title_str, ST['h1']))
    if date_str:
        story.append(Paragraph(date_str, ST['h3']))

    story.append(Spacer(1, 4*mm))
    story.append(Paragraph(
        f'<b>Reference code:</b> {tree["ref_code"]}', ST['body']
    ))
    if tree.get('extent'):
        story.append(Paragraph(f'<b>Extent:</b> {tree["extent"]}', ST['body']))


    creators = [a for a in tree.get('agents', [])
                if a['relation'].lower() in ('creator', 'skapare')]
    if creators:
        story.append(Spacer(1, 6*mm))
        story.append(Paragraph('CREATORS', ST['label']))
        for agent in creators:
            dates = f' ({agent["date_from"]}–{agent["date_to"]})' if agent.get('date_from') else ''
            story.append(Paragraph(f'{agent["name"]}{dates}', ST['body']))

    story.append(PageBreak())


    story.append(Paragraph('Table of Contents', ST['h2']))
    story.append(HRFlowable(width='100%', thickness=0.5, color=BORDER, spaceAfter=4))
    story.append(Spacer(1, 2*mm))

    def _toc_rows(nodes, depth=0):
        for n in nodes:
            indent = '    ' * depth
            count = len(n.get('children', []))
            count_str = f'  ({count} sub-series)' if count and depth == 0 else ''
            row = [
                Paragraph(f'<font color="{ACCENT.hexval()}">{n["ref_code"]}</font>', ST['toc_ref']),
                Paragraph(f'{indent}{n["title"]}{count_str}', ST['toc']),
                Paragraph(_date_range(n), ST['small']),
            ]
            yield row
            for child_row in _toc_rows(n.get('children', []), depth + 1):
                yield child_row

    toc_data = list(_toc_rows(tree.get('children', [])))
    if toc_data:
        toc_table = Table(
            toc_data,
            colWidths=[35*mm, 115*mm, 20*mm],
        )
        toc_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
            ('ROWBACKGROUNDS', (0, 0), (-1, -1), [colors.white, BG_SUBTLE]),
            ('ALIGN', (2, 0), (2, -1), 'RIGHT'),
        ]))
        story.append(toc_table)

    story.append(PageBreak())


    history_notes = [n for n in tree.get('notes', [])
                     if n['type'] in ('history', 'administrative_history', 'biographical_history')]
    other_notes = [n for n in tree.get('notes', [])
                   if n['type'] not in ('history', 'administrative_history', 'biographical_history')]

    if history_notes or tree.get('scope_and_content') or tree.get('description'):
        story.append(Paragraph('Administrative / Biographical History', ST['h2']))
        story.append(HRFlowable(width='100%', thickness=0.5, color=BORDER, spaceAfter=4))

        if tree.get('scope_and_content'):
            story.append(Paragraph(tree['scope_and_content'], ST['body']))
            story.append(Spacer(1, 3*mm))

        if tree.get('description'):
            story.append(Paragraph(tree['description'], ST['body']))
            story.append(Spacer(1, 3*mm))

        for note in history_notes:
            story.append(Paragraph(note['content'], ST['body']))
            story.append(Spacer(1, 3*mm))

        if other_notes:
            story.append(Spacer(1, 4*mm))
            story.append(Paragraph('Notes', ST['h3']))
            for note in other_notes:
                note_label = note['type'].replace('_', ' ').title()
                story.append(Paragraph(f'<b>{note_label}</b>', ST['h4']))
                story.append(Paragraph(note['content'], ST['body']))

        story.append(PageBreak())


    def _render_series(nodes, parent_title=''):
        for node in nodes:
            is_leaf = not node.get('children')


            header_items = []
            header_items.append(Paragraph(node['level'].upper(), ST['label']))
            header_items.append(Paragraph(node['title'], ST['h3']))

            meta_parts = [f'<b>Ref:</b> {node["ref_code"]}']
            if _date_range(node):
                meta_parts.append(f'<b>Dates:</b> {_date_range(node)}')
            if node.get('extent'):
                meta_parts.append(f'<b>Extent:</b> {node["extent"]}')
            header_items.append(Paragraph('  ·  '.join(meta_parts), ST['small']))

            if node.get('scope_and_content'):
                header_items.append(Spacer(1, 2*mm))
                header_items.append(Paragraph(node['scope_and_content'], ST['body']))

            if node.get('description'):
                header_items.append(Paragraph(node['description'], ST['body']))

            if node.get('access_conditions'):
                header_items.append(Paragraph(
                    f'<b>Access conditions:</b> {node["access_conditions"]}', ST['small']
                ))

            if node.get('arrangement'):
                header_items.append(Paragraph(
                    f'<b>Arrangement:</b> {node["arrangement"]}', ST['small']
                ))

            for note in node.get('notes', []):
                note_label = note['type'].replace('_', ' ').title()
                header_items.append(Paragraph(f'<b>{note_label}:</b> {note["content"]}', ST['small']))


            node_agents = [a for a in node.get('agents', []) if a['relation'].lower() != 'creator']
            for agent in node_agents:
                header_items.append(Paragraph(
                    f'<b>{agent["relation"].title()}:</b> {agent["name"]}', ST['small']
                ))

            story.append(KeepTogether(header_items))
            story.append(Spacer(1, 2*mm))


            children = node.get('children', [])
            leaf_children = [c for c in children
                             if not c.get('children') and c['level'] in
                             ('Volume', 'File', 'Item', 'OtherLevel')]

            if leaf_children:
                story.append(Paragraph(
                    f'Contents — {len(leaf_children)} item{"s" if len(leaf_children) != 1 else ""}',
                    ST['label']
                ))
                story.append(Spacer(1, 1*mm))

                table_data = [[
                    Paragraph('Ref', ST['label']),
                    Paragraph('Title / Description', ST['label']),
                    Paragraph('Dates', ST['label']),
                    Paragraph('Location', ST['label']),
                ]]
                for item in leaf_children:
                    table_data.append([
                        Paragraph(item['ref_code'] or item['local_ref'], ST['small']),
                        Paragraph(item['title'] or '', ST['body']),
                        Paragraph(_date_range(item), ST['small']),
                        Paragraph(item.get('location_path') or '', ST['small']),
                    ])

                t = Table(table_data, colWidths=[30*mm, 90*mm, 22*mm, 28*mm])
                t.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), BG_HEADER),
                    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                    ('FONTSIZE', (0, 0), (-1, -1), 8),
                    ('TOPPADDING', (0, 0), (-1, -1), 3),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
                    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, BG_SUBTLE]),
                    ('GRID', (0, 0), (-1, -1), 0.3, BORDER),
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ]))
                story.append(t)
                story.append(Spacer(1, 4*mm))


            non_leaf_children = [c for c in children if c not in leaf_children]
            if non_leaf_children:
                _render_series(non_leaf_children)

            story.append(HRFlowable(width='100%', thickness=0.3, color=BORDER, spaceAfter=4))

    story.append(Paragraph('Series Descriptions', ST['h2']))
    story.append(HRFlowable(width='100%', thickness=0.5, color=BORDER, spaceAfter=4))
    story.append(Spacer(1, 2*mm))
    _render_series(tree.get('children', []))

    doc.build(story, onFirstPage=on_first, onLaterPages=on_later)
    return buf.getvalue()




def generate_location_inventory(location_id: int, institution_id: int, db) -> bytes:
    """Generate a shelf inventory PDF for a location and all its children."""
    from app.models.location import Location
    from app.models.node import Node
    import sqlalchemy as sa

    root_loc = db.session.get(Location, location_id)
    if not root_loc or root_loc.institution_id != institution_id:
        raise ValueError('Location not found')

    from app.models import Institution
    institution = db.session.get(Institution, institution_id)
    inst_name = institution.name if institution else ''

    ST = _styles()
    buf = io.BytesIO()

    title_str = f'Inventory — {root_loc.get_full_path()}'
    on_first, on_later = _make_page_template(title_str, inst_name)

    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=15*mm, rightMargin=15*mm,
        topMargin=22*mm, bottomMargin=20*mm,
    )

    story = []


    story.append(Paragraph(inst_name.upper(), ST['label']))
    story.append(Spacer(1, 2*mm))
    story.append(Paragraph('LOCATION INVENTORY', ParagraphStyle(
        'inv_title', fontName='Helvetica-Bold', fontSize=22,
        textColor=BG_HEADER, leading=28, spaceAfter=4,
    )))
    story.append(HRFlowable(width='100%', thickness=2, color=ACCENT, spaceAfter=6))
    story.append(Paragraph(root_loc.get_full_path(), ST['h2']))
    story.append(Paragraph(
        f'Printed {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")} UTC',
        ST['faint']
    ))
    story.append(Spacer(1, 6*mm))


    def _get_location_tree(loc, depth=0):
        yield loc, depth
        for child in loc.children:
            yield from _get_location_tree(child, depth + 1)

    total_items = 0

    for loc, depth in _get_location_tree(root_loc):

        nodes = db.session.execute(
            sa.select(Node)
            .where(Node.current_location_id == loc.id)
            .order_by(Node.ref_code)
        ).scalars().all()

        if not nodes and not loc.can_store_nodes:
            continue


        indent = '  ' * depth
        story.append(KeepTogether([
            Paragraph(
                f'{indent}<b>{loc.get_full_path()}</b>'
                + (f'  <font color="{INK_FAINT.hexval()}" size="8">({loc.location_type})</font>'
                   if loc.location_type else ''),
                ST['h3']
            ),
        ]))

        if not nodes:
            story.append(Paragraph(
                f'{indent}  <i>Empty</i>', ST['faint']
            ))
            story.append(Spacer(1, 2*mm))
            continue

        total_items += len(nodes)


        table_data = [[
            Paragraph('Reference code', ST['label']),
            Paragraph('Title', ST['label']),
            Paragraph('Level', ST['label']),
            Paragraph('Dates', ST['label']),
            Paragraph('☑', ST['label']),
        ]]

        for node in nodes:
            date_str = ''
            if node.date_start:
                date_str = str(node.date_start.year)
                if node.date_end and node.date_end.year != node.date_start.year:
                    date_str += f'–{node.date_end.year}'

            is_checked_out = loc.code == '__checked_out__'
            ref_color = '#d97706' if is_checked_out else ACCENT.hexval()

            table_data.append([
                Paragraph(f'<font color="{ref_color}">{node.ref_code or ""}</font>', ST['small']),
                Paragraph(node.title or '', ST['body']),
                Paragraph(node.level_of_description or '', ST['small']),
                Paragraph(date_str, ST['small']),
                Paragraph('□', ST['center']),
            ])

        col_widths = [38*mm, 95*mm, 20*mm, 18*mm, 9*mm]
        t = Table(table_data, colWidths=col_widths)
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), BG_HEADER),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, BG_SUBTLE]),
            ('GRID', (0, 0), (-1, -1), 0.3, BORDER),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('ALIGN', (4, 0), (4, -1), 'CENTER'),
        ]))
        story.append(t)
        story.append(Spacer(1, 5*mm))


    story.append(HRFlowable(width='100%', thickness=0.5, color=BORDER, spaceAfter=4))
    story.append(Paragraph(
        f'Total items: <b>{total_items}</b>', ST['body']
    ))

    doc.build(story, onFirstPage=on_first, onLaterPages=on_later)
    return buf.getvalue()