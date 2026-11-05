from __future__ import annotations

import os
import secrets
from datetime import datetime, timezone

from flask import redirect, Response, current_app
from flask_login import login_user
from onelogin.saml2.settings import OneLogin_Saml2_Settings

from app.api.v1 import bp
from app.api.v1.auth_saml.saml import get_saml_auth, build_saml_settings, is_saml_enabled
from app.api.v1.helpers import success
from app.extensions import db
from app.models import User

SAML_LOGIN_URL = '/api/v1/saml2/login'
POST_LOGIN_REDIRECT = '/app/resources'


def _login_error(code: str):
    return redirect(f'/login?error={code}')


# ─── Public auth config ──────────────────────────────────────────────

@bp.route('/auth/config', methods=['GET'])
def auth_config():
    saml = is_saml_enabled()
    return success({
        'saml_enabled': saml,
        'saml_login_url': SAML_LOGIN_URL if saml else None,
    })


# ─── SAML login ──────────────────────────────────────────────────────

@bp.route('/saml2/login')
def saml_login():
    if not is_saml_enabled():
        return 'SAML is not enabled', 400
    auth = get_saml_auth()
    return redirect(auth.login(set_nameid_policy=False))


# ─── Assertion Consumer Service ──────────────────────────────────────

@bp.route('/saml2/authenticate', methods=['POST'])
def saml_acs():
    if not is_saml_enabled():
        return 'SAML is not enabled', 400

    auth = get_saml_auth()
    auth.process_response()
    errors = auth.get_errors()
    if errors:
        current_app.logger.warning('SAML error: %s %s', errors, auth.get_last_error_reason())
        return _login_error('saml_failed')

    if not auth.is_authenticated():
        return _login_error('saml_failed')

    attributes = auth.get_attributes()
    username_attr = os.getenv('SAML_USERNAME_ATTR')
    email_attr = os.getenv('SAML_EMAIL_ATTR')

    usernames = attributes.get(username_attr) or []
    if not usernames:
        current_app.logger.warning('SAML attribute %s is empty', username_attr)
        return _login_error('saml_missing_attribute')
    username = usernames[0]

    user = User.query.filter_by(username=username).first()

    if not user:
        emails = attributes.get(email_attr) or []
        if not emails:
            current_app.logger.warning('SAML attribute %s is empty', email_attr)
            return _login_error('saml_missing_attribute')
        email = emails[0].strip().lower()

        if User.query.filter_by(email=email).first():
            current_app.logger.warning(
                'SAML login for %s blocked: email %s belongs to another user', username, email
            )
            return _login_error('saml_email_conflict')

        user = User(username=username, email=email, is_active=True, is_system_admin=False)
        user.set_password(secrets.token_urlsafe(32))
        db.session.add(user)
        db.session.flush()

    if not user.is_active:
        return _login_error('account_disabled')

    user.last_login = datetime.now(timezone.utc)
    if not user.active_institution_id and len(user.institutions) == 1:
        user.active_institution_id = user.institutions[0].id
    db.session.commit()

    login_user(user, remember=False)
    return redirect(POST_LOGIN_REDIRECT)


# ─── SP metadata ─────────────────────────────────────────────────────

@bp.route('/saml2/metadata')
def saml_metadata():
    if not is_saml_enabled():
        return 'SAML is not enabled', 400
    settings = OneLogin_Saml2_Settings(build_saml_settings(), sp_validation_only=True)
    metadata_xml = settings.get_sp_metadata()
    errors = settings.validate_metadata(metadata_xml)
    if errors:
        return f'Metadata errors: {errors}', 500
    return Response(metadata_xml, content_type='application/xml')