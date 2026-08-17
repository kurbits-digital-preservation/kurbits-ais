from flask import Blueprint

bp = Blueprint('v1', __name__)

from app.api.v1 import auth                          # noqa: F401
from app.api.v1.nodes import routes                  # noqa: F401
from app.api.v1.agents import routes                 # noqa: F401
from app.api.v1.locations import routes              # noqa: F401
from app.api.v1.classifications import routes        # noqa: F401
from app.api.v1.hierarchy import routes              # noqa: F401
from app.api.v1.ead import routes                    # noqa: F401
from app.api.v1.export import routes                 # noqa: F401
from app.api.v1.acquisitions import routes           # noqa: F401
from app.api.v1 import integration  # noqa: F401
from app.api.v1.representations import routes # noqa: F401
# Search
from app.api.v1 import search  # noqa: F401
from app.api.v1.saved_searches import routes as saved_search_routes  # noqa
from app.api.v1.history import routes as history_routes  # noqa
from app.api.v1.ai import routes as ai_routes # noqa
from app.api.v1.tasks import routes as task_routes  # noqa: F401
from app.api.v1.portal import routes as portal_routes  # noqa: F401
# Health check (no auth required — used by k8s probes)
@bp.route('/health', methods=['GET'])
def health():
    from app.extensions import db # noqa: F401
    import sqlalchemy as sa
    try:
        db.session.execute(sa.text('SELECT 1'))
        return {'status': 'ok', 'database': 'connected'}, 200
    except Exception as e:
        return {'status': 'error', 'database': str(e)}, 503

from app.api.v1.templates import routes  # noqa: F401