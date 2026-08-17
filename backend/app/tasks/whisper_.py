"""
Whisper transcription worker.
Submits audio/video to the Whisper microservice and polls for completion.
"""
from __future__ import annotations
import os
import time
import logging
from datetime import datetime, timezone

log = logging.getLogger(__name__)

AUDIO_MIME_TYPES = {
    'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/flac',
    'audio/ogg', 'audio/aac', 'audio/webm',
}
VIDEO_MIME_TYPES = {
    'video/mp4', 'video/quicktime', 'video/x-msvideo',
    'video/x-matroska', 'video/webm', 'video/ogg',
}
AV_MIME_TYPES = AUDIO_MIME_TYPES | VIDEO_MIME_TYPES

POLL_INTERVAL = 5    # seconds between polls
MAX_WAIT      = 3600 # 1 hour max


def can_transcribe(mime_type: str, filename: str = '') -> bool:
    if mime_type in AV_MIME_TYPES:
        return True
    if mime_type and mime_type != 'application/octet-stream':
        return False
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    return ext in {
        'mp3', 'mp4', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma', 'aiff',
        'mov', 'avi', 'mkv', 'webm', 'ogv', 'wmv', 'flv', 'm4v',
    }


def _get_whisper_config(institution_id: int) -> dict:
    from app.models.ai_config import InstitutionAIConfig
    config = InstitutionAIConfig.query.filter_by(
        institution_id=institution_id
    ).first()
    if not config:
        raise RuntimeError('No AI configuration found.')
    whisper_cfg = (config.task_configs or {}).get('whisper', {})
    service_url = whisper_cfg.get('service_url', '').rstrip('/')
    if not service_url:
        raise RuntimeError(
            'Whisper service URL not configured. '
            'Set it under Administration → AI → Whisper.'
        )
    return {
        'service_url': service_url,
        'api_key':     whisper_cfg.get('api_key', ''),
        'model':       whisper_cfg.get('model', 'medium'),
    }


def run_whisper(task_id: str) -> None:
    import requests
    from app.extensions import db
    from app.models.background_task import BackgroundTask
    from app.models.node import NodeAttachment
    from flask import current_app

    task = BackgroundTask.query.get(task_id)
    if not task:
        return

    options    = task.result or {}
    model_size = options.get('model_size', 'medium')

    task.set_running()
    db.session.commit()

    attachment = NodeAttachment.query.get(task.entity_id)
    if not attachment:
        task.set_error('Attachment not found')
        db.session.commit()
        return

    institution_id = attachment.node.institution_id
    node_id        = attachment.node_id

    # ── Get Whisper service config ────────────────────────────────────
    try:
        wc = _get_whisper_config(institution_id)
    except RuntimeError as e:
        task.set_error(str(e))
        db.session.commit()
        return

    # Use task-level model override if set, otherwise fall back to
    # institution whisper config, then the model_size from the task options
    model = wc['model'] or model_size

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

    # ── Submit job to Whisper service ─────────────────────────────────
    task.set_progress(5)
    db.session.commit()

    try:
        with open(file_path, 'rb') as f:
            resp = requests.post(
                f'{wc["service_url"]}/jobs',
                files={'file': (attachment.original_filename, f, attachment.mime_type)},
                data={'model': model},
                headers={'x-api-key': wc['api_key']},
                timeout=120,  # upload timeout
            )
        resp.raise_for_status()
        job_id = resp.json()['job_id']
        queue_pos = resp.json().get('queue_position', 0)
        log.info(f'Whisper job {job_id} submitted for attachment {attachment.id}, queue position {queue_pos}')
    except Exception as e:
        task.set_error(f'Failed to submit to Whisper service: {str(e)}')
        db.session.commit()
        return

    task.set_progress(10)
    db.session.commit()

    # ── Poll for completion ───────────────────────────────────────────
    elapsed  = 0
    last_pct = 10

    while elapsed < MAX_WAIT:
        time.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL

        try:
            poll = requests.get(
                f'{wc["service_url"]}/jobs/{job_id}',
                headers={'x-api-key': wc['api_key']},
                timeout=10,
            )
            poll.raise_for_status()
            job_data = poll.json()
        except Exception as e:
            log.warning(f'Whisper poll failed for job {job_id}: {e}')
            continue

        status   = job_data.get('status')
        progress = job_data.get('progress', 0)

        # Map service progress (0-100) into our task progress (10-95)
        mapped_pct = 10 + int(progress * 0.85)
        if mapped_pct > last_pct:
            last_pct = mapped_pct
            task.set_progress(mapped_pct)
            db.session.commit()

        if status == 'done':
            transcript = job_data.get('transcript', '')
            detected   = job_data.get('language')
            attachment.extracted_text    = transcript
            attachment.extracted_text_at = datetime.now(timezone.utc)
            if attachment.representation_id and transcript:
                from app.tasks.text_representation import create_text_representation
                create_text_representation(
                    node_id=node_id,
                    institution_id=institution_id,
                    source_filename=attachment.original_filename,
                    text=transcript,
                    method='whisper',
                    upload_folder=current_app.config['UPLOAD_FOLDER'],
                    uploaded_by_id=task.created_by_id,
                )

            _reindex_node(attachment.node, db)
            char_count = len(transcript)
            task.set_done({
                'chars_extracted': char_count,
                'method':          'whisper',
                'model':           model,
                'language':        detected,
            })
            db.session.commit()
            log.info(f'Whisper job {job_id} complete: {char_count} chars, lang={detected}')
            return

        if status == 'error':
            error_msg = job_data.get('error', 'Unknown error from Whisper service')
            task.set_error(f'Whisper service error: {error_msg}')
            db.session.commit()
            return

    # Timeout
    task.set_error(f'Timed out waiting for Whisper job {job_id} after {MAX_WAIT}s')
    db.session.commit()


def _reindex_node(node, db) -> None:
    try:
        from app.extensions import db as _db
        import sqlalchemy as sa
        institution = node.institution
        if not institution.index_attachment_text:
            return
        attachment_texts = [
            a.extracted_text for a in node.attachments if a.extracted_text
        ]
        if not attachment_texts:
            return
        combined = ' '.join(attachment_texts)
        if _db.engine.dialect.name == 'postgresql':
            _db.session.execute(sa.text("""
                UPDATE nodes SET search_vector = (
                    setweight(to_tsvector('swedish', coalesce(title, '')), 'A') ||
                    setweight(to_tsvector('swedish', coalesce(description, '')), 'B') ||
                    setweight(to_tsvector('swedish', coalesce(scope_and_content, '')), 'B') ||
                    setweight(to_tsvector('swedish', coalesce(:attachment_text, '')), 'C')
                ) WHERE id = :node_id
            """), {'node_id': node.id, 'attachment_text': combined[:50000]})
    except Exception as e:
        log.warning(f'Failed to reindex node {node.id}: {e}')