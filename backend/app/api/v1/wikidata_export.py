from __future__ import annotations

from flask import request
from flask_login import login_required, current_user

from app.api.v1 import bp
from app.api.v1.helpers import success, error
from app.models.agent import Agent
from app.services.sources import current_lang
from app.services.sources.quickstatements import MAX_AGENTS, build_quickstatements


@bp.route('/agents/quickstatements', methods=['POST'])
@login_required
def export_agents_quickstatements():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    data = request.get_json(silent=True) or {}
    raw_ids = data.get('agent_ids')
    if not isinstance(raw_ids, list) or not raw_ids:
        return error('agent_ids must be a non-empty list', 400)
    try:
        agent_ids = list(dict.fromkeys(int(i) for i in raw_ids))
    except (TypeError, ValueError):
        return error('agent_ids must be integers', 400)
    if len(agent_ids) > MAX_AGENTS:
        return error(f'At most {MAX_AGENTS} agents per export', 400)

    agents = Agent.query.filter(
        Agent.id.in_(agent_ids),
        Agent.institution_id == institution_id,
    ).all()
    by_id = {a.id: a for a in agents}
    ordered = [by_id[i] for i in agent_ids if i in by_id]
    if not ordered:
        return error('No agents found', 404)

    options = {
        'create_missing': bool(data.get('create_missing', False)),
        'include_aliases': bool(data.get('include_aliases', False)),
        'include_archives_at': bool(data.get('include_archives_at', True)),
    }
    return success(build_quickstatements(ordered, institution_id, options, current_lang()))