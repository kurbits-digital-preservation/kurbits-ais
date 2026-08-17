from __future__ import annotations
import hmac
import hashlib
import json
import logging
import os
import time
import urllib.request

log = logging.getLogger(__name__)


def _sign_file(data: bytes, secret: str) -> str:
    return hmac.new(secret.encode(), data, hashlib.sha256).hexdigest()


def _push_file(file_path: str, dest_url: str, secret: str,
               filename: str, mime_type: str,
               retries: int = 5, retry_delay: float = 4.0) -> bool:
    if not os.path.exists(file_path):
        log.warning('Portal sync: file not found on disk: %s', file_path)
        return False

    with open(file_path, 'rb') as fh:
        data = fh.read()

    sig = _sign_file(data, secret)

    for attempt in range(retries):
        req = urllib.request.Request(
            dest_url,
            data=data,
            headers={
                'Content-Type': mime_type or 'application/octet-stream',
                'X-Portal-Signature': f'sha256={sig}',
                'X-Original-Filename': filename,
                'User-Agent': 'ArchivalSystem-Portal/1.0',
            },
            method='POST',
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read().decode())
                if body.get('retry'):
                    log.info('Portal file sync: portal not ready, retry %d/%d for %s',
                             attempt + 1, retries, filename)
                    time.sleep(retry_delay)
                    continue
                log.info('Portal file sync OK: %s', filename)
                return True
        except urllib.error.HTTPError as e:
            log.error('Portal file sync HTTP %s for %s: %s', e.code, filename, e)
            return False
        except Exception as e:
            log.error('Portal file sync error for %s: %s', filename, e)
            return False

    log.error('Portal file sync gave up after %d retries for %s', retries, filename)
    return False


def run_portal_file_sync(task_id: str) -> None:
    from flask import current_app
    from app.extensions import db
    from app.models.background_task import BackgroundTask
    from app.models.node import NodeAttachment

    task = BackgroundTask.query.get(task_id)
    if not task:
        return

    task.set_running()
    db.session.commit()

    opts = task.result or {}
    attachment_ids  = opts.get('attachment_ids', [])
    rep_file_ids    = opts.get('rep_file_ids', [])
    portal_base_url = opts.get('portal_base_url', '').rstrip('/')
    portal_secret   = opts.get('portal_secret', '')
    upload_folder   = current_app.config.get('UPLOAD_FOLDER', '')
    file_endpoint   = f'{portal_base_url}/ingest/file'
    errors          = []

    log.info('Portal file sync starting: %d attachments, %d rep files for node %s',
             len(attachment_ids), len(rep_file_ids), opts.get('node_id'))

    for att_id in attachment_ids:
        att = NodeAttachment.query.get(att_id)
        if not att:
            log.warning('Portal file sync: attachment %s not found', att_id)
            errors.append(f'attachment:{att_id}:not_found')
            continue

        # Build path directly — avoid lazy loading att.node
        file_path = os.path.join(
            upload_folder,
            str(att.node_id),   # main system stores as {upload}/{institution_id}/{node_id}/
            att.filename,
        )

        # Try with institution_id prefix first (actual layout)
        # Query institution_id directly from the node table
        from app.models.node import Node
        node = Node.query.get(att.node_id)
        if node:
            file_path = os.path.join(
                upload_folder,
                str(node.institution_id),
                str(att.node_id),
                att.filename,
            )

        log.info('Portal file sync: pushing attachment %s from %s', att_id, file_path)
        ok = _push_file(
            file_path,
            f'{file_endpoint}/attachment/{att_id}',
            portal_secret,
            att.original_filename,
            att.mime_type,
        )
        if not ok:
            errors.append(f'attachment:{att_id}')

    for att_id in rep_file_ids:
        att = NodeAttachment.query.get(att_id)
        if not att:
            log.warning('Portal file sync: rep file attachment %s not found', att_id)
            errors.append(f'rep_file:{att_id}:not_found')
            continue

        from app.models.node import Node
        node = Node.query.get(att.node_id)
        if node:
            file_path = os.path.join(
                upload_folder,
                str(node.institution_id),
                str(att.node_id),
                att.filename,
            )
        else:
            file_path = os.path.join(upload_folder, str(att.node_id), att.filename)

        log.info('Portal file sync: pushing rep file %s from %s', att_id, file_path)
        ok = _push_file(
            file_path,
            f'{file_endpoint}/representation-file/{att_id}',
            portal_secret,
            att.original_filename,
            att.mime_type,
        )
        if not ok:
            errors.append(f'rep_file:{att_id}')

    if errors:
        task.set_error(f'Some files failed: {", ".join(errors)}')
    else:
        task.set_done({
            'synced_attachments': len(attachment_ids),
            'synced_rep_files': len(rep_file_ids),
        })

    db.session.commit()