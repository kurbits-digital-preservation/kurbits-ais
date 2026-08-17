from __future__ import annotations
import hmac
import hashlib
import json
import logging
import threading
import urllib.request
import urllib.error
from datetime import date, datetime
from typing import Optional

from flask import current_app

log = logging.getLogger(__name__)


# ── Serialisation ─────────────────────────────────────────────────────

def _iso(v) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return str(v)


def build_node_payload(node) -> dict:
    from app.models.agent import agent_node_association
    from app.extensions import db
    import sqlalchemy as sa

    institution = node.institution

    # Agents
    agents = []
    for agent in node.agents:
        rel = db.session.execute(
            sa.select(agent_node_association.c.relation_type).where(
                agent_node_association.c.agent_id == agent.id,
                agent_node_association.c.node_id == node.id,
            )
        ).scalar_one_or_none()
        agents.append({
            'id': agent.id,
            'name': agent.name,
            'agent_type': agent.agent_type.value,
            'authorized_form': agent.authorized_form,
            'identifier': agent.identifier,
            'relation_type': rel or '',
        })



    # Classifications — lazy='dynamic' so call .all()
    classifications = []
    for c in node.classifications.all():
        classifications.append({
            'id': c.id,
            'name': c.name,
            'full_code': c.get_full_code() if hasattr(c, 'get_full_code') else c.code,
        })

    # Public notes only
    notes = [
        {
            'note_type': n.note_type,
            'content': n.content,
        }
        for n in node.notes
        if n.is_public
    ]

    # Tags — lazy='dynamic' so call .all()
    tags = [
        {
            'id': t.id,
            'name': t.name,
            'category': t.category,
        }
        for t in node.tags.all()
    ]

    # Representations (files)
    representations = []
    for rep in node.representations:
        files = []
        for f in rep.files:
            files.append({
                'id': f.id,
                'original_filename': f.original_filename,
                'mime_type': f.mime_type,
                'file_size': f.file_size,
                'stored_filename': f.filename,
            })
        representations.append({
            'id': rep.id,
            'label': rep.label,
            'rep_type_name': rep.rep_type_obj.name if rep.rep_type_obj else None,
            'files': files,
        })

    # Standalone attachments
    attachments = [
        {
            'id': a.id,
            'original_filename': a.original_filename,
            'mime_type': a.mime_type,
            'file_size': a.file_size,
            'stored_filename': a.filename,
            'description': a.description,
        }
        for a in node.attachments
        if a.representation_id is None
    ]

    # Breadcrumb
    breadcrumb = []
    ancestor = node.parent
    while ancestor:
        breadcrumb.insert(0, {
            'id': ancestor.id,
            'title': ancestor.title,
            'ref_code': ancestor.ref_code,
        })
        ancestor = ancestor.parent

    return {
        'event': 'publish',
        'institution': {
            'id': institution.id,
            'name': institution.name,
            'slug': institution.slug,
            'ref_prefix': institution.ref_prefix,
            'country_code': institution.country_code,
            'website': institution.website,
            'description': institution.description,
        },
        'node': {
            'id': node.id,
            'ref_code': node.ref_code,
            'local_ref': node.local_ref,
            'title': node.title,
            'level_of_description': node.level_of_description,
            'status': node.status.value,
            'description': node.description,
            'scope_and_content': node.scope_and_content,
            'arrangement': node.arrangement,
            'access_conditions': node.access_conditions,
            'reproduction_conditions': node.reproduction_conditions,
            'language': node.language,
            'finding_aids': node.finding_aids,
            'extent': node.extent,
            'date_start': _iso(node.date_start),
            'date_end': _iso(node.date_end),
            'date_certainty': node.date_certainty,
            'metadata_spec': node.metadata_spec or {},
            'parent_id': node.parent_id,
            'breadcrumb': breadcrumb,
            'agents': agents,
            'classifications': classifications,
            'notes': notes,
            'tags': tags,
            'representations': representations,
            'attachments': attachments,
            'created_at': _iso(node.created_at),
            'updated_at': _iso(node.updated_at),
        },
    }


def build_unpublish_payload(node) -> dict:
    institution = node.institution
    return {
        'event': 'unpublish',
        'institution': {
            'id': institution.id,
            'slug': institution.slug,
        },
        'node': {
            'id': node.id,
            'ref_code': node.ref_code,
        },
    }


# ── HMAC signing ──────────────────────────────────────────────────────

def _sign(payload_bytes: bytes, secret: str) -> str:
    return hmac.new(
        secret.encode(),
        payload_bytes,
        hashlib.sha256,
    ).hexdigest()


# ── Dispatch ──────────────────────────────────────────────────────────

def _portal_settings(institution) -> Optional[dict]:
    settings = institution.settings or {}
    portal = settings.get('portal', {})
    if not portal.get('enabled'):
        return None
    if not portal.get('webhook_url') or not portal.get('webhook_secret'):
        return None
    return portal


def _send_webhook(url: str, secret: str, payload: dict) -> None:
    body = json.dumps(payload, default=str).encode()
    sig = _sign(body, secret)
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            'Content-Type': 'application/json',
            'X-Portal-Signature': f'sha256={sig}',
            'User-Agent': 'ArchivalSystem-Portal/1.0',
        },
        method='POST',
    )

    def _fire():
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                log.info('Portal webhook delivered: %s %s', url, resp.status)
        except urllib.error.HTTPError as e:
            log.error('Portal webhook HTTP error %s: %s', e.code, url)
        except Exception as e:
            log.error('Portal webhook failed: %s – %s', url, e)

    threading.Thread(target=_fire, daemon=True).start()


def publish_node(node) -> None:
    portal = _portal_settings(node.institution)
    if not portal:
        return
    payload = build_node_payload(node)
    _send_webhook(portal['webhook_url'], portal['webhook_secret'], payload)
    try:
        _enqueue_file_sync(node, portal)
    except Exception as e:
        log.error('Portal file sync enqueue failed for node %s: %s', node.id, e)


def unpublish_node(node) -> None:
    portal = _portal_settings(node.institution)
    if not portal:
        return
    payload = build_unpublish_payload(node)
    _send_webhook(portal['webhook_url'], portal['webhook_secret'], payload)


def _enqueue_file_sync(node, portal: dict) -> None:
    attachment_ids = [a.id for a in node.attachments if a.representation_id is None]
    rep_file_ids = [a.id for a in node.attachments if a.representation_id is not None]

    if not attachment_ids and not rep_file_ids:
        return

    from app.models.background_task import BackgroundTask
    from app.tasks.runner import run_in_background
    from app.extensions import db
    from flask import current_app

    # created_by_id is non-nullable — fall back to created_by_id if updated_by_id is None
    # and further fall back to any admin user if both are None (e.g. bulk sync)
    creator_id = node.updated_by_id or node.created_by_id
    if not creator_id:
        from app.models.user import User
        fallback = db.session.execute(
            db.select(User.id).limit(1)
        ).scalar_one_or_none()
        creator_id = fallback
    if not creator_id:
        log.warning('Portal file sync: cannot enqueue — no valid user id for node %s', node.id)
        return

    base_url = portal['webhook_url'].rstrip('/')
    if base_url.endswith('/webhook'):
        base_url = base_url[:-8]

    task = BackgroundTask(
        institution_id=node.institution_id,
        created_by_id=creator_id,
        task_type='portal_file_sync',
        entity_type='node',
        entity_id=node.id,
        result={
            'node_id': node.id,
            'attachment_ids': attachment_ids,
            'rep_file_ids': rep_file_ids,
            'portal_base_url': base_url,
            'portal_secret': portal['webhook_secret'],
        },
    )
    db.session.add(task)
    db.session.commit()

    from app.portal.file_sync import run_portal_file_sync
    run_in_background(current_app._get_current_object(), task.id, run_portal_file_sync)