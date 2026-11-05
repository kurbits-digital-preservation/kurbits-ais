from __future__ import annotations

from flask import has_request_context, request

from .base import DEFAULT_LANG

SUPPORTED_LANGS = ('sv', 'en')


def current_lang() -> str:
    if not has_request_context():
        return DEFAULT_LANG
    for lang, _quality in request.accept_languages:
        primary = lang.split('-')[0].lower()
        if primary in SUPPORTED_LANGS:
            return primary
    return DEFAULT_LANG