from flask import request
from flask_login import login_required, current_user
from app.api.v1 import bp
from app.api.v1.helpers import success, error, require_institution_admin


@bp.route('/portal/config', methods=['GET'])
@login_required
@require_institution_admin
def get_portal_config():
    from app.models import Institution
    inst = Institution.query.get(current_user.active_institution_id)
    portal = (inst.settings or {}).get('portal', {})
    return success({
        'enabled': portal.get('enabled', False),
        'webhook_url': portal.get('webhook_url', ''),
        'has_secret': bool(portal.get('webhook_secret')),
    })


@bp.route('/portal/config', methods=['PUT'])
@login_required
@require_institution_admin
def save_portal_config():
    from app.models import Institution
    from app.extensions import db

    data = request.get_json(silent=True) or {}
    inst = Institution.query.get(current_user.active_institution_id)
    settings = dict(inst.settings or {})
    portal = dict(settings.get('portal', {}))

    portal['enabled'] = bool(data.get('enabled', False))

    if 'webhook_url' in data:
        portal['webhook_url'] = (data['webhook_url'] or '').strip()

    # Only overwrite secret if a new one is provided
    if data.get('webhook_secret'):
        portal['webhook_secret'] = data['webhook_secret'].strip()

    settings['portal'] = portal
    inst.settings = settings
    db.session.commit()

    return success({
        'enabled': portal.get('enabled', False),
        'webhook_url': portal.get('webhook_url', ''),
        'has_secret': bool(portal.get('webhook_secret')),
    })



@bp.route('/portal/sync', methods=['POST'])
@login_required
@require_institution_admin
def portal_bulk_sync():
    """Re-push all currently published nodes to the portal."""

    from app.models import Institution
    from app.models.node import Node, NodeStatus
    from app.portal.publisher import publish_node

    inst = Institution.query.get(current_user.active_institution_id)
    portal = (inst.settings or {}).get('portal', {})
    if not portal.get('enabled'):
        return error('Portal is not enabled for this institution', 400)

    published = Node.query.filter_by(
        institution_id=inst.id,
        status=NodeStatus.PUBLISHED,
    ).all()

    queued = 0
    for node in published:
        try:
            publish_node(node)
            queued += 1
        except Exception:
            pass

    return success({'queued': queued, 'total': len(published)})



@bp.route('/portal/test', methods=['POST'])
@login_required
@require_institution_admin
def portal_test_webhook():
    """Send a ping payload to verify the webhook URL and secret are correct."""
    from app.models import Institution
    from app.portal.publisher import _sign, _portal_settings
    import json, urllib.request, urllib.error

    inst = Institution.query.get(current_user.active_institution_id)
    portal = _portal_settings(inst)
    if not portal:
        return error('Portal not enabled or missing URL/secret', 400)

    payload = json.dumps({'event': 'ping', 'institution_slug': inst.slug}).encode()
    sig = _sign(payload, portal['webhook_secret'])
    req = urllib.request.Request(
        portal['webhook_url'],
        data=payload,
        headers={
            'Content-Type': 'application/json',
            'X-Portal-Signature': f'sha256={sig}',
            'User-Agent': 'ArchivalSystem-Portal/1.0',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return success({'ok': True, 'status': resp.status})
    except urllib.error.HTTPError as e:
        return success({'ok': False, 'status': e.code, 'message': str(e)})
    except Exception as e:
        return success({'ok': False, 'message': str(e)})