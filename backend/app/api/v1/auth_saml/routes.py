from __future__ import annotations
import os

from flask import redirect, Response
from flask_login import login_user

from app.models import User
from app.api.v1 import bp
from app.api.v1.auth_saml.saml import get_saml_auth, build_saml_settings, is_saml_enabled
from onelogin.saml2.settings import OneLogin_Saml2_Settings
from app.extensions import db



@bp.route("/saml2/login")
def saml_login():
    """
    Initiate SAML login
    """
    if not is_saml_enabled():
        return "SAML is not enabled", 400
    auth = get_saml_auth()
    return redirect(auth.login(
        set_nameid_policy=False,  # change to False to omit NameIDPolicy
    ))


@bp.route("/saml2/authenticate", methods=["POST"])
def saml_acs():
    """
    Assertion Consumer Service:
      - validates SAMLResponse
      - extracts attributes
    """
    if not is_saml_enabled():
        return "SAML is not enabled", 400
    auth = get_saml_auth()
    auth.process_response()
    errors = auth.get_errors()
    if errors:
        reason = auth.get_last_error_reason()
        return f"SAML error: {errors} {reason}", 400

    if not auth.is_authenticated():
        return "Not authenticated", 401

    attributes = auth.get_attributes()
    username_attr = os.getenv("SAML_USERNAME_ATTR")
    email_attr = os.getenv("SAML_EMAIL_ATTR")
    usernames = attributes.get(username_attr)
    if not usernames:
        return f"Saml attribute {username_attr} is empty", 400
    username = usernames[0]
    user = User.query.filter_by(username=username).first()
    if not user:
        emails = attributes.get(email_attr)
        if not usernames:
            return f"Saml attribute {email_attr} is empty", 400
        email = emails[0]
        user = User(username=username, email=email, is_active=True, is_system_admin=False)
        user.set_password("password")
        db.session.add(user)
        db.session.commit()
        db.session.flush()

    if not login_user(user, remember=False):
        return "User account is inactive", 403

    return redirect("/")

@bp.route("/saml2/metadata")
def saml_metadata():
    """
    Returns SP metadata for the IdP.
    """
    if not is_saml_enabled():
        return "SAML is not enabled", 400
    settings = OneLogin_Saml2_Settings(build_saml_settings(), sp_validation_only=True)
    metadata_xml = settings.get_sp_metadata()
    errors = settings.validate_metadata(metadata_xml)

    if errors:
        return f"Metadata errors: {errors}", 500

    return Response(metadata_xml, content_type="application/xml")