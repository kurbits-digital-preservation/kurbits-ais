from __future__ import annotations

import importlib
import logging
import pkgutil
from typing import Optional

from .base import SourceError, SourcePlugin

logger = logging.getLogger(__name__)

DISABLED_SETTING = 'disabled_source_plugins'

_PLUGINS: dict[str, type[SourcePlugin]] = {}
_loaded = False


def register(cls: type[SourcePlugin]) -> type[SourcePlugin]:
    if not getattr(cls, 'key', ''):
        raise ValueError(f'{cls.__name__} has no key')
    existing = _PLUGINS.get(cls.key)
    if existing is not None and existing is not cls:
        raise ValueError(f'Duplicate source plugin key "{cls.key}"')
    _PLUGINS[cls.key] = cls
    return cls


def _ensure_loaded() -> None:
    global _loaded
    if _loaded:
        return
    _loaded = True
    from . import plugins as package
    for info in pkgutil.iter_modules(package.__path__):
        if info.name.startswith('_'):
            continue
        try:
            importlib.import_module(f'{package.__name__}.{info.name}')
        except Exception:
            logger.exception('Failed to load source plugin module %s', info.name)


def all_plugins() -> list[type[SourcePlugin]]:
    _ensure_loaded()
    return sorted(_PLUGINS.values(), key=lambda c: c.key)


def get_plugin_class(key: Optional[str]) -> Optional[type[SourcePlugin]]:
    _ensure_loaded()
    return _PLUGINS.get(key or '')


def disabled_plugin_keys(institution) -> set[str]:
    settings = (getattr(institution, 'settings', None) or {}) if institution else {}
    return {str(k) for k in settings.get(DISABLED_SETTING) or []}


def is_enabled(key: Optional[str], institution) -> bool:
    return get_plugin_class(key) is not None and key not in disabled_plugin_keys(institution)


def plugin_for(integration) -> SourcePlugin:
    cls = get_plugin_class(integration.plugin)
    if cls is None:
        raise SourceError(f'Source plugin "{integration.plugin}" is not installed', 404)
    return cls(integration.config or {})