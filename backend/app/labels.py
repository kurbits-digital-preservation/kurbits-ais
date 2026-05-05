"""
Label PDF generator for archival boxes and volumes.

Supported formats:
  single   — one label per A4 page (full page, for box spine labels on card stock)
  avery_l7163 — 14 labels per A4 (99.1 × 38.1 mm)
  avery_l7160 — 21 labels per A4 (38.1 × 21.2 mm)

Each label contains:
  - Reference code (large, prominent)
  - Title
  - Level of description
  - Date range
  - Local ref / volume number
  - Institution name
  - Code128 barcode encoding the reference code
  - Location path (if object has a current location)
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
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import simpleSplit


# ── Label format definitions ──────────────────────────────────────────

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
    gap_h: float    # horizontal gap between labels
    gap_v: float    # vertical gap between labels


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
    'museiservice_90x45': LabelFormat(
        name='Museiservice arkivetikett (12 per ark, 90×45 mm)',
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
}


# ── Label data ────────────────────────────────────────────────────────

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
    copies: int = 1

    @property
    def date_string(self) -> str:
        if self.date_from and self.date_to:
            # Show just years
            y_from = str(self.date_from)[:4]
            y_to = str(self.date_to)[:4]
            return f'{y_from}–{y_to}' if y_from != y_to else y_from
        if self.date_from:
            return str(self.date_from)[:4]
        return ''


# ── Drawing a single label ────────────────────────────────────────────

def _draw_label(c: canvas.Canvas, label: LabelData, fmt: LabelFormat,
                x: float, y: float) -> None:
    """
    Draw one label. x, y is the bottom-left corner in PDF coordinates.
    ReportLab origin is bottom-left so we work down from (x, y + height).
    """
    w = fmt.label_width
    h = fmt.label_height

    is_single = fmt.cols == 1 and fmt.rows == 1

    # Padding inside label
    pad = 3 * mm if not is_single else 8 * mm

    # Draw border
    c.setStrokeColor(colors.HexColor('#cccccc'))
    c.setLineWidth(0.3)
    c.rect(x, y, w, h)

    # ── Top band: ref code ───────────────────────────────────────────
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

    # Ref code band background
    c.setFillColor(colors.HexColor('#1a1a2e'))
    c.rect(x, y + h - band_height, w, band_height, fill=1, stroke=0)

    # Ref code text
    c.setFillColor(colors.white)
    c.setFont('Helvetica-Bold', ref_font_size)
    ref_y = y + h - band_height + (band_height - ref_font_size * 0.352778 * mm) / 2
    c.drawString(x + pad, ref_y, label.ref_code)

    # Level badge (top right)
    c.setFont('Helvetica', meta_font_size - 1)
    level_text = label.level.upper()
    c.drawRightString(x + w - pad, ref_y, level_text)

    # ── Content area ─────────────────────────────────────────────────
    content_top = y + h - band_height - pad
    content_bottom = y + pad + barcode_height + (3 * mm if not is_single else 6 * mm)
    content_h = content_top - content_bottom

    c.setFillColor(colors.HexColor('#1a1a2e'))

    # Title — wrap if needed
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

    # Meta line: dates · local ref
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

    # Location
    if label.location_path:
        loc_y = meta_y - (meta_font_size * 0.352778 * mm * 1.4)
        if loc_y > content_bottom:
            c.setFont('Helvetica-Oblique', meta_font_size)
            loc_text = label.location_path
            # Truncate if too long
            while simpleSplit(loc_text, 'Helvetica-Oblique', meta_font_size, w - 2 * pad).__len__() > 1:
                loc_text = loc_text[:-4] + '…'
            c.drawString(x + pad, loc_y, f'📍 {loc_text}')

    # ── Barcode ──────────────────────────────────────────────────────
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
        # Scale to fit width
        actual_w = barcode.width
        if actual_w > barcode_w:
            scale = barcode_w / actual_w
            c.saveState()
            c.translate(x + pad, barcode_y)
            c.scale(scale, 1)
            barcode.drawOn(c, 0, 0)
            c.restoreState()
        else:
            # Centre it
            barcode_x = x + pad + (barcode_w - actual_w) / 2
            barcode.drawOn(c, barcode_x, barcode_y)

        # Human-readable ref code below barcode (for single format only)
        if is_single:
            c.setFont('Helvetica', 8)
            c.setFillColor(colors.HexColor('#333333'))
            c.drawCentredString(
                x + w / 2,
                barcode_y + barcode_height * 0.7 + 1 * mm,
                label.ref_code
            )
    except Exception:
        # Fallback: just print the ref code if barcode fails
        c.setFont('Helvetica-Bold', 9)
        c.setFillColor(colors.black)
        c.drawCentredString(x + w / 2, barcode_y + barcode_height / 2, label.ref_code)

    # ── Institution name (bottom right, tiny) ────────────────────────
    c.setFont('Helvetica', max(meta_font_size - 1, 5))
    c.setFillColor(colors.HexColor('#aaaaaa'))
    c.drawRightString(x + w - pad, y + 1 * mm, label.institution_name)


# ── Main PDF generator ────────────────────────────────────────────────

def generate_label_pdf(labels: list[LabelData], format_key: str = 'avery_l7163') -> bytes:
    """
    Generate a PDF containing all labels and return as bytes.
    """
    fmt = FORMATS.get(format_key, FORMATS['avery_l7163'])

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(fmt.page_width, fmt.page_height))
    c.setTitle('Kurbits — Box Labels')
    c.setAuthor('Kurbits AIS')

    # Expand labels by copies
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

            # PDF y=0 is bottom — calculate from top
            x = fmt.margin_left + col * (fmt.label_width + fmt.gap_h)
            y_from_top = fmt.margin_top + row * (fmt.label_height + fmt.gap_v)
            y = fmt.page_height - y_from_top - fmt.label_height

            _draw_label(c, label, fmt, x, y)

    c.save()
    return buf.getvalue()