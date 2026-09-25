"""
Background technical-metadata extraction.
"""

from __future__ import annotations
import os
import logging

log = logging.getLogger(__name__)


def _upload_dir(attachment, current_app) -> str:
    return os.path.join(
        current_app.config['UPLOAD_FOLDER'],
        str(attachment.node.institution_id),
        str(attachment.node_id),
    )


def run_tech_metadata(task_id: str) -> None:
    """Entry point called by the background runner."""
    from app.extensions import db
    from app.models.background_task import BackgroundTask
    from app.models.node import NodeAttachment
    from flask import current_app

    task = BackgroundTask.query.get(task_id)
    if not task:
        return

    task.set_running()
    db.session.commit()

    attachment = NodeAttachment.query.get(task.entity_id)
    if not attachment:
        task.set_error('Attachment not found')
        db.session.commit()
        return

    upload_dir = _upload_dir(attachment, current_app)
    file_path = os.path.join(upload_dir, attachment.filename)

    if not os.path.exists(file_path):
        task.set_error(f'File not found: {attachment.filename}')
        db.session.commit()
        return

    try:
        from app.tech_metadata import extract_all
        thumb_dir = os.path.join(upload_dir, 'thumbnails')
        tech = extract_all(
            file_path, attachment.mime_type, thumb_dir, attachment.filename
        )
    except Exception as e:
        log.exception(f'Metadata extraction failed for attachment {attachment.id}')
        task.set_error(str(e))
        db.session.commit()
        return



    applied = []
    for key, value in (tech or {}).items():
        if hasattr(attachment, key):
            setattr(attachment, key, value)
            applied.append(key)

    from datetime import datetime, timezone
    if hasattr(attachment, 'tech_extracted_at'):
        attachment.tech_extracted_at = datetime.now(timezone.utc)

    db.session.commit()

    task.set_done({
        'attachment_id': attachment.id,
        'fields': applied,
    })
    db.session.commit()
