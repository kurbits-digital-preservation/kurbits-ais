from flask import jsonify
from functools import wraps
from flask_login import current_user


def success(data=None, status=200, meta=None):
    body = {'status': 'success'}
    if data is not None:
        body['data'] = data
    if meta is not None:
        body['meta'] = meta
    return jsonify(body), status


def error(message, status=400, errors=None):
    body = {'status': 'error', 'message': message}
    if errors:
        body['errors'] = errors
    return jsonify(body), status


def require_institution(f):
    """Decorator — ensures current_user has an active institution set."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.active_institution_id:
            return error('No active institution selected', 400)
        return f(*args, **kwargs)
    return decorated


def require_write(f):
    """Decorator — ensures current_user has write access to their active institution."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.active_institution_id:
            return error('No active institution selected', 400)
        if not current_user.has_write_access(current_user.active_institution):
            return error('Write access required', 403)
        return f(*args, **kwargs)
    return decorated


def require_institution_admin(f):
    """Decorator — ensures current_user is an institution admin or system admin."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.active_institution_id:
            return error('No active institution selected', 400)
        if not current_user.is_institution_admin_of(current_user.active_institution):
            return error('Institution admin access required', 403)
        return f(*args, **kwargs)
    return decorated
