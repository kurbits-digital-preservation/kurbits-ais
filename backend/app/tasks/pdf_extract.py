"""
Native PDF text extraction using pdfplumber.
"""
from __future__ import annotations
import logging

log = logging.getLogger(__name__)



MIN_CHARS_PER_PAGE = 80


def extract_pdf_text(file_path: str) -> tuple[str, bool]:
    """
    Extract embedded text from a PDF.
    Returns (text, is_useful) where is_useful indicates
    whether the text is substantial enough to use directly.
    """
    try:
        import pdfplumber
    except ImportError:
        return '', False

    texts = []
    total_pages = 0

    try:
        with pdfplumber.open(file_path) as pdf:
            total_pages = len(pdf.pages)
            for page in pdf.pages:
                text = page.extract_text() or ''
                texts.append(text.strip())
    except Exception as e:
        log.warning(f'pdfplumber extraction failed: {e}')
        return '', False

    combined = '\n\n'.join(t for t in texts if t)
    avg_chars = len(combined) / max(total_pages, 1)
    is_useful = avg_chars >= MIN_CHARS_PER_PAGE

    return combined, is_useful


def can_extract_text(mime_type: str) -> bool:
    return mime_type == 'application/pdf'