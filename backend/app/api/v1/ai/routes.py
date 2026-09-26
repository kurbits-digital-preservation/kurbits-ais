"""
Whisper transcription configuration endpoints.

"""
from flask import request
from flask_login import login_required, current_user

from app.api.v1 import bp
from app.api.v1.helpers import success, error, require_institution_admin
from app.extensions import db
from app.models.ai_config import InstitutionAIConfig


def _serialize(config: InstitutionAIConfig) -> dict:
    return {
        'service_url': config.whisper_service_url,
        'model':       config.whisper_model,
        'has_api_key': config.has_whisper_api_key,
        'updated_at':  config.updated_at.isoformat() if config.updated_at else None,
    }

@bp.route('/ai/whisper-config', methods=['GET'])
@login_required
@require_institution_admin
def get_whisper_config():
    config = InstitutionAIConfig.query.filter_by(
        institution_id=current_user.active_institution_id
    ).first()

    if not config:
        return success(None)

    return success(_serialize(config))


@bp.route('/ai/whisper-config', methods=['PUT'])
@login_required
@require_institution_admin
def save_whisper_config():
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}

    service_url = (data.get('service_url') or '').strip()
    api_key     = (data.get('api_key') or '').strip()      # empty = keep existing
    model       = (data.get('model') or '').strip()

    if not service_url:
        return error('service_url is required', 400)

    # Upsert — no longer requires a pre-existing provider configuration
    config = InstitutionAIConfig.query.filter_by(
        institution_id=institution_id
    ).first()
    if config is None:
        config = InstitutionAIConfig(institution_id=institution_id)
        db.session.add(config)

    config.whisper_service_url = service_url.rstrip('/')
    config.whisper_model       = model
    config.updated_by_id       = current_user.id

    # Only update the key if a new one was provided
    if api_key:
        config.whisper_api_key = api_key

    db.session.commit()
    return success(_serialize(config))


@bp.route('/ai/whisper-models', methods=['GET'])
@login_required
def get_whisper_models():
    """Fetch available models from the configured Whisper service."""
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    config = InstitutionAIConfig.query.filter_by(
        institution_id=institution_id
    ).first()
    if not config or not config.whisper_service_url:
        return error('Whisper service URL not configured.', 400)

    import requests
    try:
        resp = requests.get(
            f'{config.whisper_service_url}/models',
            headers={'x-api-key': config.whisper_api_key},
            timeout=5,
        )
        resp.raise_for_status()
        return success(resp.json())
    except Exception as e:
        return error(f'Could not reach Whisper service: {str(e)}', 502)
