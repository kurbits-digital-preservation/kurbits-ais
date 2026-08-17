"""
Tesseract OCR worker.
Extracts text from images and scanned PDFs, stores in attachment.extracted_text,
then optionally re-indexes the parent node's search_vector.
"""
from __future__ import annotations
import os
import logging
from datetime import datetime, timezone

log = logging.getLogger(__name__)

# MIME types this worker handles
OCR_MIME_TYPES = {
    'image/jpeg', 'image/png', 'image/tiff', 'image/bmp', 'image/webp',
    'application/pdf',
}


def can_ocr(mime_type: str) -> bool:
    return mime_type in OCR_MIME_TYPES


def run_ocr(task_id: str) -> None:
    """Entry point called by the background runner."""
    from app.extensions import db
    from app.models.background_task import BackgroundTask
    from app.models.node import NodeAttachment
    from flask import current_app
    import json

    task = BackgroundTask.query.get(task_id)
    if not task:
        return

    # Read options from task result field (set at creation time)
    options = task.result or {}
    force_ocr = options.get('force_ocr', False)

    task.set_running()
    db.session.commit()

    attachment = NodeAttachment.query.get(task.entity_id)
    if not attachment:
        task.set_error('Attachment not found')
        db.session.commit()
        return

    institution_id = attachment.node.institution_id
    node_id        = attachment.node_id
    upload_dir = os.path.join(
        current_app.config['UPLOAD_FOLDER'],
        str(institution_id),
        str(node_id),
    )
    file_path = os.path.join(upload_dir, attachment.filename)

    if not os.path.exists(file_path):
        task.set_error(f'File not found: {attachment.filename}')
        db.session.commit()
        return

    try:
        text, method = _extract_text_smart(
            file_path, attachment.mime_type, task, db, force_ocr
        )
    except Exception as e:
        log.exception(f'Text extraction failed for attachment {attachment.id}: {e}')
        task.set_error(str(e))
        db.session.commit()
        return

    attachment.extracted_text    = text
    attachment.extracted_text_at = datetime.now(timezone.utc)

    if attachment.representation_id and text:
        from app.tasks.text_representation import create_text_representation
        create_text_representation(
            node_id=node_id,
            institution_id=institution_id,
            source_filename=attachment.original_filename,
            text=text,
            method='ocr',
            upload_folder=current_app.config['UPLOAD_FOLDER'],
            uploaded_by_id=task.created_by_id,
        )

    _reindex_node(attachment.node, db)

    char_count = len(text) if text else 0
    task.set_done({'chars_extracted': char_count, 'method': method})
    db.session.commit()
    log.info(f'Text extraction complete for attachment {attachment.id}: {char_count} chars via {method}')





def _extract_text_smart(
    file_path: str,
    mime_type: str,
    task,
    db,
    force_ocr: bool = False,
) -> tuple[str, str]:
    """
    Smart extraction: try native PDF text first, fall back to OCR if needed.
    Returns (text, method_used).
    """
    if mime_type == 'application/pdf' and not force_ocr:
        from app.tasks.pdf_extract import extract_pdf_text
        task.set_progress(10)
        db.session.commit()

        text, is_useful = extract_pdf_text(file_path)
        if is_useful:
            task.set_progress(100)
            return text, 'native_pdf'

        # Not useful — fall through to OCR
        log.info(f'Native PDF text sparse ({len(text)} chars), falling back to OCR')

    # OCR path
    if mime_type == 'application/pdf':
        text = _ocr_pdf(file_path, task, db)
        return text, 'ocr_pdf'
    else:
        text = _ocr_image(file_path)
        return text, 'ocr_image'


def _ocr_image(file_path: str) -> str:
    import pytesseract
    from PIL import Image
    img = Image.open(file_path)
    text = pytesseract.image_to_string(img, lang='swe+eng')
    return text.strip()


def _ocr_pdf(file_path: str, task, db) -> str:
    from pdf2image import convert_from_path
    import pytesseract

    pages = convert_from_path(file_path, dpi=300)
    total = len(pages)
    texts = []

    for i, page in enumerate(pages):
        text = pytesseract.image_to_string(page, lang='swe+eng')
        texts.append(text.strip())
        pct = 10 + int(((i + 1) / total) * 85)
        task.set_progress(pct)
        db.session.commit()

    return '\n\n'.join(t for t in texts if t)


def _reindex_node(node, db) -> None:
    """
    Rebuild the node's search_vector to include attachment text
    if the institution has index_attachment_text enabled.
    """
    try:
        from app.extensions import db as _db
        import sqlalchemy as sa

        institution = node.institution
        if not institution.index_attachment_text:
            return

        # Collect all extracted text from attachments
        attachment_texts = [
            a.extracted_text for a in node.attachments
            if a.extracted_text
        ]
        if not attachment_texts:
            return

        combined = ' '.join(attachment_texts)

        # Update search_vector — PostgreSQL only
        if _db.engine.dialect.name == 'postgresql':
            _db.session.execute(sa.text("""
                UPDATE nodes SET search_vector = (
                    setweight(to_tsvector('swedish', coalesce(title, '')), 'A') ||
                    setweight(to_tsvector('swedish', coalesce(description, '')), 'B') ||
                    setweight(to_tsvector('swedish', coalesce(scope_and_content, '')), 'B') ||
                    setweight(to_tsvector('swedish', coalesce(:attachment_text, '')), 'C')
                )
                WHERE id = :node_id
            """), {'node_id': node.id, 'attachment_text': combined[:50000]})
    except Exception as e:
        log.warning(f'Failed to reindex node {node.id}: {e}')