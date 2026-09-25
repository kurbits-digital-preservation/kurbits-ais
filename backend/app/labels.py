"""
Label PDF generator for archival boxes and volumes.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.graphics.barcode import code128
from reportlab.graphics.barcode import qr as qr_barcode
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF
import base64 as _base64
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import simpleSplit




@dataclass
class LabelFormat:
    name: str
    page_width: float
    page_height: float
    label_width: float
    label_height: float
    cols: int
    rows: int
    margin_left: float
    margin_top: float
    gap_h: float
    gap_v: float


FORMATS: dict[str, LabelFormat] = {
    'single': LabelFormat(
        name='Single (A4)',
        page_width=210 * mm,
        page_height=297 * mm,
        label_width=190 * mm,
        label_height=277 * mm,
        cols=1, rows=1,
        margin_left=10 * mm,
        margin_top=10 * mm,
        gap_h=0, gap_v=0,
    ),
    'standard_90x45': LabelFormat(
        name='Standard arkivetikett (12 per ark, 90×45 mm)',
        page_width=210 * mm,
        page_height=297 * mm,
        label_width=90 * mm,
        label_height=44.5 * mm,
        cols=2, rows=6,
        margin_left=15 * mm,
        margin_top=15 * mm,
        gap_h=0, gap_v=0,
    ),
    'avery_l7163': LabelFormat(
        name='Avery L7163 (14 per ark, 99×38 mm)',
        page_width=210 * mm,
        page_height=297 * mm,
        label_width=99.1 * mm,
        label_height=38.1 * mm,
        cols=2, rows=7,
        margin_left=4.65 * mm,
        margin_top=15.15 * mm,
        gap_h=2.54 * mm,
        gap_v=0,
    ),
    'avery_l7160': LabelFormat(
        name='Avery L7160 (21 per ark, 64×38 mm)',
        page_width=210 * mm,
        page_height=297 * mm,
        label_width=63.5 * mm,
        label_height=38.1 * mm,
        cols=3, rows=7,
        margin_left=4.65 * mm,
        margin_top=15.15 * mm,
        gap_h=2.54 * mm,
        gap_v=0,
    ),

    'box_portrait_70x100': LabelFormat(
        name='Archive box, portrait (6 per ark, 70×100 mm)',
        page_width=210 * mm,
        page_height=297 * mm,
        label_width=70 * mm,
        label_height=100 * mm,
        cols=2, rows=2,
        margin_left=25 * mm,
        margin_top=25 * mm,
        gap_h=20 * mm, gap_v=20 * mm,
    ),
    'spine_portrait_40x150': LabelFormat(
        name='Spine label, portrait (4 per ark, 40×150 mm)',
        page_width=210 * mm,
        page_height=297 * mm,
        label_width=40 * mm,
        label_height=150 * mm,
        cols=4, rows=1,
        margin_left=13 * mm,
        margin_top=20 * mm,
        gap_h=6 * mm, gap_v=0,
    ),
    'single_portrait': LabelFormat(
        name='Single portrait (A4)',
        page_width=210 * mm,
        page_height=297 * mm,
        label_width=190 * mm,
        label_height=277 * mm,
        cols=1, rows=1,
        margin_left=10 * mm,
        margin_top=10 * mm,
        gap_h=0, gap_v=0,
    ),
}




@dataclass
class LabelData:
    ref_code: str
    title: str
    level: str
    local_ref: str
    date_from: Optional[str]
    date_to: Optional[str]
    institution_name: str
    location_path: Optional[str] = None
    parent_ref_code: Optional[str] = None
    parent_title: Optional[str] = None
    parent_date_from: Optional[str] = None
    parent_date_to: Optional[str] = None
    copies: int = 1

    @staticmethod
    def _year_range(a, b) -> str:
        if a and b:
            ya, yb = str(a)[:4], str(b)[:4]
            return f'{ya}–{yb}' if ya != yb else ya
        if a:
            return str(a)[:4]
        return ''

    @property
    def parent_date_string(self) -> str:
        return self._year_range(self.parent_date_from, self.parent_date_to)

    @property
    def date_string(self) -> str:
        if self.date_from and self.date_to:

            y_from = str(self.date_from)[:4]
            y_to = str(self.date_to)[:4]
            return f'{y_from}–{y_to}' if y_from != y_to else y_from
        if self.date_from:
            return str(self.date_from)[:4]
        return ''




def _draw_label(c: canvas.Canvas, label: LabelData, fmt: LabelFormat,
                x: float, y: float) -> None:
    """
    Draw one label. x, y is the bottom-left corner in PDF coordinates.
    ReportLab origin is bottom-left so we work down from (x, y + height).
    """
    w = fmt.label_width
    h = fmt.label_height

    is_single = fmt.cols == 1 and fmt.rows == 1


    pad = 3 * mm if not is_single else 8 * mm


    c.setStrokeColor(colors.HexColor('#cccccc'))
    c.setLineWidth(0.3)
    c.rect(x, y, w, h)


    if is_single:
        ref_font_size = 28
        title_font_size = 16
        meta_font_size = 11
        barcode_height = 18 * mm
        band_height = 14 * mm
    else:
        ref_font_size = 11 if fmt.cols == 3 else 14
        title_font_size = 7 if fmt.cols == 3 else 9
        meta_font_size = 6 if fmt.cols == 3 else 7
        barcode_height = 8 * mm
        band_height = 6 * mm


    c.setFillColor(colors.HexColor('#1a1a2e'))
    c.rect(x, y + h - band_height, w, band_height, fill=1, stroke=0)


    c.setFillColor(colors.white)
    c.setFont('Helvetica-Bold', ref_font_size)
    ref_y = y + h - band_height + (band_height - ref_font_size * 0.352778 * mm) / 2
    c.drawString(x + pad, ref_y, label.ref_code)


    c.setFont('Helvetica', meta_font_size - 1)
    level_text = label.level.upper()
    c.drawRightString(x + w - pad, ref_y, level_text)


    content_top = y + h - band_height - pad
    content_bottom = y + pad + barcode_height + (3 * mm if not is_single else 6 * mm)
    content_h = content_top - content_bottom

    c.setFillColor(colors.HexColor('#1a1a2e'))


    c.setFont('Helvetica-Bold', title_font_size)
    max_chars = int((w - 2 * pad) / (title_font_size * 0.5 * 0.352778 * mm))
    lines = simpleSplit(label.title, 'Helvetica-Bold', title_font_size, w - 2 * pad)
    max_lines = 2 if not is_single else 3
    title_line_h = title_font_size * 0.352778 * mm * 1.3
    for i, line in enumerate(lines[:max_lines]):
        ty = content_top - (i + 1) * title_line_h
        if ty < content_bottom:
            break
        c.drawString(x + pad, ty, line)

    title_block_h = min(len(lines), max_lines) * title_line_h


    meta_y = content_top - title_block_h - (2 * mm if not is_single else 4 * mm)
    c.setFont('Helvetica', meta_font_size)
    c.setFillColor(colors.HexColor('#555555'))

    meta_parts = []
    if label.date_string:
        meta_parts.append(label.date_string)
    if label.local_ref:
        meta_parts.append(f'Ref: {label.local_ref}')
    if meta_parts and meta_y > content_bottom:
        c.drawString(x + pad, meta_y, '  ·  '.join(meta_parts))


    if label.location_path:
        loc_y = meta_y - (meta_font_size * 0.352778 * mm * 1.4)
        if loc_y > content_bottom:
            c.setFont('Helvetica-Oblique', meta_font_size)
            loc_text = label.location_path

            while simpleSplit(loc_text, 'Helvetica-Oblique', meta_font_size, w - 2 * pad).__len__() > 1:
                loc_text = loc_text[:-4] + '…'
            c.drawString(x + pad, loc_y, f'📍 {loc_text}')


    barcode_y = y + pad
    barcode_w = w - 2 * pad

    try:
        barcode = code128.Code128(
            label.ref_code,
            barHeight=barcode_height * 0.7,
            barWidth=0.6 if is_single else 0.4,
            quiet=False,
            humanReadable=False,
        )

        actual_w = barcode.width
        if actual_w > barcode_w:
            scale = barcode_w / actual_w
            c.saveState()
            c.translate(x + pad, barcode_y)
            c.scale(scale, 1)
            barcode.drawOn(c, 0, 0)
            c.restoreState()
        else:

            barcode_x = x + pad + (barcode_w - actual_w) / 2
            barcode.drawOn(c, barcode_x, barcode_y)


        if is_single:
            c.setFont('Helvetica', 8)
            c.setFillColor(colors.HexColor('#333333'))
            c.drawCentredString(
                x + w / 2,
                barcode_y + barcode_height * 0.7 + 1 * mm,
                label.ref_code
            )
    except Exception:

        c.setFont('Helvetica-Bold', 9)
        c.setFillColor(colors.black)
        c.drawCentredString(x + w / 2, barcode_y + barcode_height / 2, label.ref_code)

    # ── Institution name (bottom right, tiny) ────────────────────────
    c.setFont('Helvetica', max(meta_font_size - 1, 5))
    c.setFillColor(colors.HexColor('#aaaaaa'))
    c.drawRightString(x + w - pad, y + 1 * mm, label.institution_name)




def _field_value(label, field):
    if field == 'ref_code':      return label.ref_code or ''
    if field == 'title':         return label.title or ''
    if field == 'level':         return (label.level or '').upper()
    if field == 'date':          return label.date_string
    if field == 'local_ref':     return label.local_ref or ''
    if field == 'location':      return label.location_path or ''
    if field == 'institution':   return label.institution_name or ''
    if field == 'parent_ref_code': return label.parent_ref_code or ''
    if field == 'parent_title':    return label.parent_title or ''
    if field == 'parent_date':     return label.parent_date_string
    return ''


def _draw_text_element(c, el, label, x0, y0, w, h):
    ex = x0 + el.get('x', 0) * w
    ey_top = y0 + h - el.get('y', 0) * h
    ew = el.get('w', 1) * w
    eh = el.get('h', 0.1) * h
    text = _field_value(label, el.get('field', '')) if el.get('type') == 'field' else el.get('text', '')
    if not text:
        return
    font = 'Helvetica-Bold' if el.get('bold') else 'Helvetica'
    size = el.get('font_size') or max(6, eh / mm * 2.0)
    color = el.get('color') or '#1a1a2e'
    align = el.get('align', 'left')
    c.setFillColor(colors.HexColor(color))
    c.setFont(font, size)
    lines = simpleSplit(text, font, size, ew)
    line_h = size * 0.352778 * mm * 1.25
    ty = ey_top - size * 0.352778 * mm
    for line in lines:
        if ty < ey_top - eh - line_h:
            break
        if align == 'center':
            c.drawCentredString(ex + ew / 2, ty, line)
        elif align == 'right':
            c.drawRightString(ex + ew, ty, line)
        else:
            c.drawString(ex, ty, line)
        ty -= line_h


def _draw_barcode_element(c, el, label, x0, y0, w, h):
    ex = x0 + el.get('x', 0) * w
    ey = y0 + h - (el.get('y', 0) + el.get('h', 0.2)) * h
    ew = el.get('w', 0.9) * w
    eh = el.get('h', 0.2) * h
    value = _field_value(label, el.get('field', 'ref_code')) or label.ref_code or ''
    if not value:
        return
    try:
        bc = code128.Code128(value, barHeight=eh, barWidth=0.4, quiet=False, humanReadable=False)
        scale = ew / bc.width if bc.width > ew else 1.0
        c.saveState()
        c.translate(ex, ey)
        c.scale(scale, 1)
        bc.drawOn(c, 0, 0)
        c.restoreState()
    except Exception:
        pass


def _draw_qr_element(c, el, label, x0, y0, w, h):
    ex = x0 + el.get('x', 0) * w
    size = min(el.get('w', 0.2) * w, el.get('h', 0.2) * h)
    ey = y0 + h - (el.get('y', 0) * h) - size
    value = _field_value(label, el.get('field', 'ref_code')) or label.ref_code or ''
    if not value:
        return
    try:
        widget = qr_barcode.QrCodeWidget(value)
        b = widget.getBounds()
        wpx = b[2] - b[0]
        hpx = b[3] - b[1]
        d = Drawing(size, size, transform=[size / wpx, 0, 0, size / hpx, 0, 0])
        d.add(widget)
        renderPDF.draw(d, c, ex, ey)
    except Exception:
        pass


def _draw_image_element(c, el, x0, y0, w, h):
    data = el.get('image_data')
    if not data:
        return
    ex = x0 + el.get('x', 0) * w
    ew = el.get('w', 0.2) * w
    eh = el.get('h', 0.2) * h
    ey = y0 + h - (el.get('y', 0) * h) - eh
    try:
        if data.startswith('data:'):
            data = data.split(',', 1)[1]
        raw = _base64.b64decode(data)
        from reportlab.lib.utils import ImageReader
        img = ImageReader(io.BytesIO(raw))
        c.drawImage(img, ex, ey, width=ew, height=eh, preserveAspectRatio=True, mask='auto')
    except Exception:
        pass


def render_template(c, label, fmt, x, y, elements):
    w, h = fmt.label_width, fmt.label_height
    c.setStrokeColor(colors.HexColor('#cccccc'))
    c.setLineWidth(0.3)
    c.rect(x, y, w, h)
    for el in elements or []:
        t = el.get('type')
        rot = int(el.get('rotation', 0)) % 360


        if rot:
            cx = x + (el.get('x', 0) + el.get('w', 0.1) / 2) * w
            cy = y + h - (el.get('y', 0) + el.get('h', 0.1) / 2) * h
            c.saveState()
            c.translate(cx, cy)
            c.rotate(rot)
            c.translate(-cx, -cy)

        if t in ('field', 'text'):
            _draw_text_element(c, el, label, x, y, w, h)
        elif t == 'barcode':
            _draw_barcode_element(c, el, label, x, y, w, h)
        elif t == 'qr':
            _draw_qr_element(c, el, label, x, y, w, h)
        elif t == 'image':
            _draw_image_element(c, el, x, y, w, h)

        if rot:
            c.restoreState()




def generate_label_pdf(labels: list[LabelData], format_key: str = 'avery_l7163',
                       template_elements=None) -> bytes:
    """
    Generate a PDF containing all labels and return as bytes.
    """
    fmt = FORMATS.get(format_key, FORMATS['avery_l7163'])

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(fmt.page_width, fmt.page_height))
    c.setTitle('Kurbits — Box Labels')
    c.setAuthor('Kurbits AIS')


    expanded: list[LabelData] = []
    for label in labels:
        for _ in range(max(1, label.copies)):
            expanded.append(label)

    labels_per_page = fmt.cols * fmt.rows
    page_count = (len(expanded) + labels_per_page - 1) // labels_per_page

    for page_idx in range(page_count):
        if page_idx > 0:
            c.showPage()

        page_labels = expanded[page_idx * labels_per_page: (page_idx + 1) * labels_per_page]

        for slot_idx, label in enumerate(page_labels):
            col = slot_idx % fmt.cols
            row = slot_idx // fmt.cols


            x = fmt.margin_left + col * (fmt.label_width + fmt.gap_h)
            y_from_top = fmt.margin_top + row * (fmt.label_height + fmt.gap_v)
            y = fmt.page_height - y_from_top - fmt.label_height

            if template_elements:
                render_template(c, label, fmt, x, y, template_elements)
            else:
                _draw_label(c, label, fmt, x, y)

    c.save()
    return buf.getvalue()