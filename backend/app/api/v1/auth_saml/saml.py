# app/saml.py
from __future__ import annotations

import os
import pathlib

from flask import (
    current_app,
    request,
    url_for,
)


from onelogin.saml2.auth import OneLogin_Saml2_Auth
from onelogin.saml2.idp_metadata_parser import OneLogin_Saml2_IdPMetadataParser

# Simple in-memory cache to avoid re-downloading metadata on every request
_idp_settings_cache: dict | None = None

def is_saml_enabled() -> bool:
    return os.getenv("SAML_ENABLED", "0") == "1"


def _prepare_flask_request(req):
    """
    Convert Flask's request to the dict format python3-saml expects.
    """
    return {
        "https": "on",
        "http_host": req.host,
        "server_port": "443",
        "script_name": req.path,
        "get_data": req.args.copy(),
        "post_data": req.form.copy(),
        "query_string": req.query_string,
    }


def build_saml_settings() -> dict:
    """
    Build SAML settings by:
      - defining SP configuration (our side)
      - parsing IdP metadata from URL and merging it in
    """
    app = current_app

    sp_entity_id = os.getenv("SAML_ENTITY_ID")
    idp_metadata_url = os.getenv("SAML_METADATA_URI")

    acs_url = url_for("v1.saml_acs", _external=True, _scheme="https")

    # --- Load SP signing certificate & key ---

    sp_cert_path = pathlib.Path(os.getenv("SAML_CERT_PATH"))
    sp_key_path = pathlib.Path(os.getenv("SAML_KEY_PATH"))

    sp_x509_cert = sp_cert_path.read_text() if sp_cert_path.exists() else ""
    sp_private_key = sp_key_path.read_text() if sp_key_path.exists() else ""

    base_settings = {
        "strict": True,
        "debug": app.debug,
        "sp": {
            "entityId": sp_entity_id,
            "assertionConsumerService": {
                "url": acs_url,
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
            },
            "x509cert": sp_x509_cert,
            "privateKey": sp_private_key,
        },
        # "idp" will be filled by metadata parser
    }

    global _idp_settings_cache
    if _idp_settings_cache is None:
        # Fetch + parse IdP metadata from remote URL once
        idp_data = OneLogin_Saml2_IdPMetadataParser.parse_remote(
            idp_metadata_url,
            validate_cert=True,
        )

        _idp_settings_cache = OneLogin_Saml2_IdPMetadataParser.merge_settings(
            base_settings,
            idp_data,
        )

    return _idp_settings_cache


def get_saml_auth() -> OneLogin_Saml2_Auth:
    saml_req = _prepare_flask_request(request)
    settings = build_saml_settings()
    return OneLogin_Saml2_Auth(saml_req, old_settings=settings)




