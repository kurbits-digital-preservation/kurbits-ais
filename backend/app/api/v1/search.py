from flask import request
from flask_login import login_required, current_user
from app.api.v1 import bp
from app.api.v1.helpers import success, error


# GET /api/v1/search?q=...&types=nodes,agents&status=draft&level=Series
#   &hierarchy_type_id=1&date_from=1900-01-01&date_to=2000-12-31
#   &agent_type=person&page=1&per_page=25
@bp.route('/search', methods=['GET'])
@login_required
def global_search():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    q = request.args.get('q', '').strip()
    if not q:
        return success({
            'results': [], 'nodes': [], 'agents': [],
            'total': 0, 'node_total': 0, 'agent_total': 0,
            'query': '', 'engine': 'none', 'page': 1, 'per_page': 25, 'pages': 0
        })

    types_param = request.args.get('types', 'nodes,agents')
    types = [t.strip() for t in types_param.split(',') if t.strip()]

    per_page = min(int(request.args.get('per_page', 25)), 100)
    page = max(1, int(request.args.get('page', 1)))

    # Quick-mode for the cmd+K modal (small limit, no filters)
    quick = request.args.get('quick', 'false').lower() == 'true'
    if quick:
        per_page = 8
        page = 1

    filters = {}
    int_keys = ('hierarchy_type_id', 'classification_id')
    for key in ('status', 'level', 'hierarchy_type_id', 'classification_id',
                'date_from', 'date_to', 'agent_type',
                # file-search filters
                'file_mime', 'file_pronom', 'file_min_size', 'file_max_size',
                'file_has_checksum', 'file_min_width', 'file_min_height'):
        val = request.args.get(key, '').strip()
        if val:
            filters[key] = int(val) if key in int_keys else val

    from app.search import search as do_search
    results = do_search(
        q=q,
        institution_id=institution_id,
        types=types,
        filters=filters,
        limit=per_page,
        page=page,
    )
    return success(results)