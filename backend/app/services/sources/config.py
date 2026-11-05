from __future__ import annotations

import json
from typing import Any, Optional

from .base import ConfigField, SourcePlugin, is_empty


def _coerce(field: ConfigField, value: Any) -> tuple[Any, Optional[str]]:
    if field.type == 'json':
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return None, None
            try:
                value = json.loads(text)
            except json.JSONDecodeError:
                return None, f'{field.key}: invalid JSON'
        if value is not None and not isinstance(value, (dict, list)):
            return None, f'{field.key}: must be a JSON object or list'
        return value, None

    if value is None:
        return None, None
    text = str(value).strip()
    if field.type == 'url' and text and not text.startswith(('http://', 'https://')):
        return None, f'{field.key}: must start with http:// or https://'
    return text or None, None


def validate_config(plugin_cls: type[SourcePlugin], incoming: Any,
                    existing: Optional[dict] = None) -> tuple[dict, list[str]]:
    if incoming is None:
        incoming = {}
    if not isinstance(incoming, dict):
        return {}, ['config must be an object']
    existing = existing if isinstance(existing, dict) else {}

    clean: dict = {}
    errors: list[str] = []
    for f in plugin_cls.config_schema:
        provided = incoming.get(f.key)

        if f.secret and is_empty(provided):
            kept = existing.get(f.key)
            if not is_empty(kept):
                clean[f.key] = kept
            elif f.required:
                errors.append(f'{f.key} is required')
            continue

        value, err = _coerce(f, provided)
        if err:
            errors.append(err)
            continue
        if is_empty(value):
            if f.required and is_empty(f.default):
                errors.append(f'{f.key} is required')
            continue
        clean[f.key] = value

    return clean, errors


def public_config(plugin_cls: Optional[type[SourcePlugin]], config: Any) -> tuple[dict, list[str]]:
    if plugin_cls is None or not isinstance(config, dict):
        return {}, []
    values: dict = {}
    secrets_set: list[str] = []
    for f in plugin_cls.config_schema:
        value = config.get(f.key)
        if is_empty(value):
            continue
        if f.secret:
            secrets_set.append(f.key)
        else:
            values[f.key] = value
    return values, secrets_set