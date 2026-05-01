from flask import request, Response
from flask_login import login_required, current_user
from app.api.v1 import bp
from app.api.v1.helpers import success, error, require_write
from app.models.node import Node


# GET /api/v1/nodes/<id>/ead-export
# Query params: include_children=true|false
@bp.route('/nodes/<int:node_id>/ead-export', methods=['GET'])
@login_required
def export_ead(node_id):
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    node = Node.query.filter_by(id=node_id, institution_id=institution_id).first()
    if not node:
        return error('Node not found', 404)

    include_children = request.args.get('include_children', 'true').lower() != 'false'

    from app.ead import export_node
    xml_bytes = export_node(node, include_children=include_children)

    filename = f'{node.ref_code.replace("/", "-")}.xml'
    return Response(
        xml_bytes,
        mimetype='application/xml',
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Content-Length': str(len(xml_bytes)),
        }
    )


# POST /api/v1/ead-import
# Multipart form: file=<xml>, hierarchy_type_id=<int>, parent_node_id=<int|null>
@bp.route('/ead-import', methods=['POST'])
@login_required
@require_write
def import_ead():
    institution_id = current_user.active_institution_id

    if 'file' not in request.files:
        return error('No file provided', 400)

    file = request.files['file']
    if not file.filename:
        return error('No file selected', 400)

    if not file.filename.lower().endswith('.xml'):
        return error('File must be an XML file (.xml)', 400)

    hierarchy_type_id = request.form.get('hierarchy_type_id', type=int)
    if not hierarchy_type_id:
        return error('hierarchy_type_id is required', 400)

    parent_node_id = request.form.get('parent_node_id', type=int)

    xml_bytes = file.read()
    if len(xml_bytes) > 20 * 1024 * 1024:
        return error('File too large (max 20MB)', 413)

    from app.ead import import_ead as do_import, EADImportError
    try:
        result = do_import(
            xml_bytes=xml_bytes,
            institution_id=institution_id,
            hierarchy_type_id=hierarchy_type_id,
            parent_node_id=parent_node_id,
            created_by_id=current_user.id,
        )
    except EADImportError as e:
        return error(str(e), 422)

    return success(result.to_dict(), 201)