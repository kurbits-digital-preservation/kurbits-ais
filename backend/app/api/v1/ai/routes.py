from flask import request
from flask_login import login_required, current_user
from app.api.v1 import bp
from app.api.v1.helpers import success, error, require_institution_admin
from app.extensions import db
from app.models.ai_config import InstitutionAIConfig


def _require_admin():
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    if not (current_user.is_system_admin or current_user.is_institution_admin_of_active()):
        return error('Institution admin access required', 403)
    return None


def _serialize(config: InstitutionAIConfig) -> dict:
    return {
        'provider':   config.provider,
        'model':      config.model,
        'base_url':   config.base_url or '',
        'has_api_key': bool(config._api_key_encrypted),
        'options':    config.options or {},
        'is_enabled': config.is_enabled,
        'updated_at': config.updated_at.isoformat(),
    }


# GET /api/v1/ai/config
@bp.route('/ai/config', methods=['GET'])
@login_required
@require_institution_admin
def get_ai_config():
    config = InstitutionAIConfig.query.filter_by(
        institution_id=current_user.active_institution_id
    ).first()

    if not config:
        return success(None)

    return success(_serialize(config))


# PUT /api/v1/ai/config
@bp.route('/ai/config', methods=['PUT'])
@login_required
@require_institution_admin
def save_ai_config():

    data = request.get_json(silent=True) or {}

    provider = data.get('provider', '').strip()
    model = data.get('model', '').strip()
    base_url = data.get('base_url', '').strip() or None
    api_key = data.get('api_key', '').strip()   # empty string = no change
    options = data.get('options') or {}
    is_enabled = data.get('is_enabled', True)

    if not provider:
        return error('provider is required', 400)
    if not model:
        return error('model is required', 400)

    VALID_PROVIDERS = {'anthropic', 'openai', 'ollama', 'azure_openai'}
    if provider not in VALID_PROVIDERS:
        return error(f'provider must be one of: {", ".join(VALID_PROVIDERS)}', 400)

    if provider == 'azure_openai' and not base_url:
        return error('base_url (Azure endpoint) is required for azure_openai', 400)

    institution_id = current_user.active_institution_id
    config = InstitutionAIConfig.query.filter_by(institution_id=institution_id).first()

    if config is None:
        config = InstitutionAIConfig(institution_id=institution_id)
        db.session.add(config)

    config.provider = provider
    config.model = model
    config.base_url = base_url
    config.options = options
    config.is_enabled = is_enabled
    config.updated_by_id = current_user.id

    # Only update the key if a new one was provided
    if api_key:
        config.api_key = api_key

    db.session.commit()
    return success(_serialize(config))


# POST /api/v1/ai/test
@bp.route('/ai/test', methods=['POST'])
@login_required
@require_institution_admin
def test_ai_config():

    config = InstitutionAIConfig.query.filter_by(
        institution_id=current_user.active_institution_id
    ).first()

    if not config:
        return error('No AI configuration found. Save a configuration first.', 400)

    try:
        from app.ai.providers.factory import get_provider
        provider = get_provider(config)
        ok = provider.ping()
        if ok:
            return success({'ok': True, 'message': 'Connection successful'})
        return error('Provider responded but ping returned False', 502)
    except Exception as e:
        return error(f'Connection failed: {str(e)}', 502)


# GET /api/v1/ai/status  (non-admin: just tells the frontend whether AI is enabled)
@bp.route('/ai/status', methods=['GET'])
@login_required
def get_ai_status():
    if not current_user.active_institution_id:
        return success({'enabled': False})

    config = InstitutionAIConfig.query.filter_by(
        institution_id=current_user.active_institution_id,
        is_enabled=True,
    ).first()

    return success({
        'enabled': config is not None,
        'provider': config.provider if config else None,
        'model': config.model if config else None,
    })

@bp.route('/ai/debug-ping', methods=['GET'])
@login_required
def debug_ping():
    import traceback
    config = InstitutionAIConfig.query.filter_by(
        institution_id=current_user.active_institution_id
    ).first()
    if not config:
        return success({'error': 'No config found'})
    return success({
        'provider': config.provider,
        'model': config.model,
        'base_url': config.base_url,
        'has_key': bool(config._api_key_encrypted),
    })