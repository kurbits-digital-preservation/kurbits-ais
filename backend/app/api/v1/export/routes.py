from flask import request, Response
from flask_login import login_required, current_user
from app.api.v1 import bp
from app.api.v1.helpers import success, error, require_write
from app.models.node import Node


@bp.route('/export/formats', methods=['GET'])
@login_required
def list_export_formats():
    from app.export import list_formats
    return success(list_formats())


@bp.route('/nodes/<int:node_id>/export', methods=['GET'])
@login_required
def export_node(node_id):
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    node = Node.query.filter_by(id=node_id, institution_id=institution_id).first()
    if not node:
        return error('Node not found', 404)

    format_id = request.args.get('format', 'ead2002')
    include_children = request.args.get('include_children', 'true').lower() != 'false'

    from app.export import render_export
    try:
        content, fmt = render_export(node, format_id, include_children)
    except ValueError as e:
        return error(str(e), 400)

    safe_ref = node.ref_code.replace('/', '-')
    filename = f'{safe_ref}.{fmt.extension}'

    return Response(
        content,
        mimetype=fmt.mime_type,
        headers={'Content-Disposition': f'attachment; filename="{filename}"'}
    )


@bp.route('/oai/identify', methods=['POST'])
@login_required
def oai_identify():
    data = request.get_json(silent=True) or {}
    base_url = data.get('base_url', '').strip()
    if not base_url:
        return error('base_url is required', 400)

    from app.oaipmh.harvester import identify, OAIError
    try:
        info = identify(base_url)
        return success(info)
    except OAIError as e:
        return error(str(e), 422)



@bp.route('/oai/formats', methods=['POST'])
@login_required
def oai_list_formats():
    data = request.get_json(silent=True) or {}
    base_url = data.get('base_url', '').strip()
    if not base_url:
        return error('base_url is required', 400)

    from app.oaipmh.harvester import list_metadata_formats, OAIError
    try:
        formats = list_metadata_formats(base_url)
        return success(formats)
    except OAIError as e:
        return error(str(e), 422)


@bp.route('/oai/harvest', methods=['POST'])
@login_required
@require_write
def oai_harvest():
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}

    base_url        = data.get('base_url', '').strip()
    metadata_prefix = data.get('metadata_prefix', 'oai_dc')
    oai_identifier  = data.get('oai_identifier', '').strip()  # single record
    set_spec        = data.get('set_spec', '').strip() or None
    from_date       = data.get('from_date', '').strip() or None
    until_date      = data.get('until_date', '').strip() or None
    hierarchy_type_id = data.get('hierarchy_type_id')
    parent_node_id  = data.get('parent_node_id')

    if not base_url:
        return error('base_url is required', 400)
    if not hierarchy_type_id:
        return error('hierarchy_type_id is required', 400)

    from app.oaipmh.harvester import get_record, list_records, OAIError
    from app.oaipmh.importer import records_to_nodes

    try:
        if oai_identifier:
            harvest = get_record(base_url, oai_identifier, metadata_prefix)
        else:
            harvest = list_records(
                base_url,
                metadata_prefix=metadata_prefix,
                set_spec=set_spec,
                from_date=from_date,
                until_date=until_date,
            )

        result = records_to_nodes(
            harvest=harvest,
            institution_id=institution_id,
            hierarchy_type_id=int(hierarchy_type_id),
            parent_node_id=int(parent_node_id) if parent_node_id else None,
            created_by_id=current_user.id,
        )
    except OAIError as e:
        return error(str(e), 422)
    except ValueError as e:
        return error(str(e), 422)
    except Exception as e:
        return error(f'Harvest failed: {e}', 500)

    return success(result.to_dict(), 201)