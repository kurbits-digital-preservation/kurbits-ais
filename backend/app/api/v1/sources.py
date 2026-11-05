from __future__ import annotations

import sqlalchemy as sa
from flask import request
from flask_login import login_required, current_user

from app.api.v1 import bp
from app.api.v1.helpers import success, error, require_institution_admin
from app.extensions import db
from app.models import HierarchyLevel, HierarchyType, Institution
from app.models.integration import ExternalIntegration
from app.models.node import Node
from app.services.sources import (
    DISABLED_SETTING, SourceError, all_plugins, current_lang, disabled_plugin_keys,
    get_plugin_class, is_enabled, localize, plugin_for,
)
from app.services.sources.node_mapping import (
    build_preview, core_targets, find_level_source, level_sources, suggested_for_level,
)


# ─── Helpers ──────────────────────────────────────────────────────────

def _institution():
    if not current_user.active_institution_id:
        return None
    return db.session.get(Institution, current_user.active_institution_id)


def _load_source(intg_id: int, active_only: bool = True, require_enabled: bool = True):
    query = sa.select(ExternalIntegration).where(
        ExternalIntegration.id == intg_id,
        ExternalIntegration.institution_id == current_user.active_institution_id,
        ExternalIntegration.entity_type == 'source',
    )
    if active_only:
        query = query.where(ExternalIntegration.is_active.is_(True))
    intg = db.session.execute(query).scalar_one_or_none()
    if not intg:
        raise SourceError('Source not found', 404)
    plugin_cls = get_plugin_class(intg.plugin)
    if plugin_cls is None:
        raise SourceError(f'Plugin "{intg.plugin}" is not installed', 404)
    if require_enabled and not is_enabled(plugin_cls.key, _institution()):
        raise SourceError('This plugin is disabled for the institution', 403)
    return intg, plugin_cls


def _level_by_name(hierarchy_type_id: int, level_name: str):
    return db.session.execute(
        sa.select(HierarchyLevel)
        .join(HierarchyType, HierarchyType.id == HierarchyLevel.hierarchy_type_id)
        .where(
            HierarchyType.institution_id == current_user.active_institution_id,
            HierarchyLevel.hierarchy_type_id == hierarchy_type_id,
            sa.func.lower(HierarchyLevel.name) == level_name.lower(),
        )
    ).scalar_one_or_none()


def _level_by_id(level_id: int):
    return db.session.execute(
        sa.select(HierarchyLevel)
        .join(HierarchyType, HierarchyType.id == HierarchyLevel.hierarchy_type_id)
        .where(
            HierarchyType.institution_id == current_user.active_institution_id,
            HierarchyLevel.id == level_id,
        )
    ).scalar_one_or_none()


def _own_node_id(raw) -> int | None:
    try:
        node_id = int(raw)
    except (TypeError, ValueError):
        return None
    node = db.session.get(Node, node_id)
    return node_id if node and node.institution_id == current_user.active_institution_id else None


# ─── Plugins ──────────────────────────────────────────────────────────

@bp.route('/sources/plugins', methods=['GET'])
@login_required
def list_source_plugins():
    inst = _institution()
    if not inst:
        return error('No active institution', 400)
    disabled = disabled_plugin_keys(inst)
    lang = current_lang()
    return success([
        {**cls.describe(lang), 'enabled': cls.key not in disabled}
        for cls in all_plugins()
    ])


@bp.route('/sources/plugins/<string:key>', methods=['PUT'])
@login_required
@require_institution_admin
def set_source_plugin_enabled(key):
    inst = _institution()
    if not inst:
        return error('No active institution', 400)
    if get_plugin_class(key) is None:
        return error('Plugin not found', 404)

    data = request.get_json(silent=True) or {}
    enabled = bool(data.get('enabled', True))

    settings = dict(inst.settings or {})
    disabled = set(settings.get(DISABLED_SETTING) or [])
    if enabled:
        disabled.discard(key)
    else:
        disabled.add(key)
    settings[DISABLED_SETTING] = sorted(disabled)
    inst.settings = settings
    db.session.commit()
    return success({'key': key, 'enabled': enabled})


# ─── Mapping configuration ────────────────────────────────────────────

@bp.route('/sources/node-targets', methods=['GET'])
@login_required
def list_node_targets():
    return success(core_targets(current_lang()))


@bp.route('/sources/integrations/<int:intg_id>/source-keys', methods=['GET'])
@login_required
def list_source_keys(intg_id):
    try:
        intg, _ = _load_source(intg_id, active_only=False, require_enabled=False)
        keys = plugin_for(intg).source_keys()
    except SourceError as e:
        return error(e.message, e.status)
    lang = current_lang()
    return success([k.describe(lang) for k in keys])


@bp.route('/sources/integrations/<int:intg_id>/suggested-mappings', methods=['GET'])
@login_required
def suggested_source_mappings(intg_id):
    level_id = request.args.get('level_id', type=int)
    level = _level_by_id(level_id) if level_id else None
    if not level:
        return error('Level not found', 404)
    try:
        _, plugin_cls = _load_source(intg_id, active_only=False, require_enabled=False)
    except SourceError as e:
        return error(e.message, e.status)
    return success(suggested_for_level(plugin_cls, level.get_metadata_fields()))


# ─── NodeForm ─────────────────────────────────────────────────────────

@bp.route('/sources/for-level', methods=['GET'])
@login_required
def sources_for_level():
    inst = _institution()
    if not inst:
        return error('No active institution', 400)

    hierarchy_type_id = request.args.get('hierarchy_type_id', type=int)
    level_name = (request.args.get('level_name') or '').strip()
    if not hierarchy_type_id or not level_name:
        return error('hierarchy_type_id and level_name are required', 400)

    level = _level_by_name(hierarchy_type_id, level_name)
    if not level:
        return success([])

    lang = current_lang()
    result = []
    for entry in level_sources(level):
        try:
            intg, plugin_cls = _load_source(entry.get('integration_id'))
        except SourceError:
            continue
        result.append({
            'integration_id': intg.id,
            'name': intg.name,
            'plugin': plugin_cls.key,
            'plugin_label': localize(plugin_cls.label, lang),
            'search_hint': localize(plugin_cls.search_hint, lang),
            'fill_mode': entry.get('fill_mode') or 'empty_only',
        })
    return success(result)


@bp.route('/sources/integrations/<int:intg_id>/search', methods=['GET'])
@login_required
def search_source(intg_id):
    query = (request.args.get('q') or '').strip()
    if not query:
        return success([])
    try:
        intg, _ = _load_source(intg_id)
        hits = plugin_for(intg).search(query)
    except SourceError as e:
        return error(e.message, e.status)
    return success([h.to_dict() for h in hits])


@bp.route('/sources/node-preview', methods=['POST'])
@login_required
def preview_node_source():
    if not current_user.active_institution_id:
        return error('No active institution', 400)

    data = request.get_json(silent=True) or {}
    try:
        hierarchy_type_id = int(data.get('hierarchy_type_id'))
        integration_id = int(data.get('integration_id'))
    except (TypeError, ValueError):
        return error('hierarchy_type_id and integration_id are required', 400)

    level_name = str(data.get('level_name') or '').strip()
    external_id = str(data.get('external_id') or '').strip()
    if not level_name or not external_id:
        return error('level_name and external_id are required', 400)

    level = _level_by_name(hierarchy_type_id, level_name)
    if not level:
        return error('Level not found', 404)
    entry = find_level_source(level, integration_id)
    if not entry:
        return error('This source is not configured for the level', 404)

    current = data.get('current') if isinstance(data.get('current'), dict) else {}
    current_node = current.get('node') if isinstance(current.get('node'), dict) else {}
    current_meta = current.get('meta') if isinstance(current.get('meta'), dict) else {}

    try:
        intg, _ = _load_source(integration_id)
        record = plugin_for(intg).fetch(external_id)
    except SourceError as e:
        return error(e.message, e.status)

    return success(build_preview(
        entry=entry,
        record=record,
        integration=intg,
        level_fields=level.get_metadata_fields(),
        current_node=current_node,
        current_meta=current_meta,
        node_id=_own_node_id(data.get('node_id')),
        institution_id=current_user.active_institution_id,
        lang=current_lang(),
    ))