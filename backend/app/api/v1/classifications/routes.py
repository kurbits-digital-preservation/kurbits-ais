from datetime import datetime
import json

from flask import request
from flask_login import login_required, current_user
import sqlalchemy as sa

from app.api.v1 import bp
from app.api.v1.helpers import success, error, require_write
from app.api.v1.classifications.serializers import (
    serialize_classification_stub, serialize_classification_detail,
    serialize_classification_change
)
from app.api.v1.nodes.serializers import serialize_node_stub
from app.extensions import db
from app.models import Classification, ClassificationChange
from app.models.classification import BpmnTaskLink, RecordsVocabularyTerm, DEFAULT_RECORDS_VOCAB
from app.models.classification import classification_node_association
from app.models.hierarchy import HierarchyLevel, HierarchyType


def _get_classification_or_404(classification_id: int, institution_id: int):
    return Classification.query.filter_by(
        id=classification_id, institution_id=institution_id
    ).first()


@bp.route('/classifications/tree', methods=['GET'])
@login_required
def get_classification_tree():
    if not current_user.active_institution_id:
        return error('No active institution', 400)

    hierarchy_type_id = request.args.get('hierarchy_type_id', type=int)
    query = Classification.query.filter_by(
        institution_id=current_user.active_institution_id,
        parent_id=None
    )
    if hierarchy_type_id:
        query = query.filter_by(hierarchy_type_id=hierarchy_type_id)

    roots = query.order_by(Classification.code).all()
    return success([serialize_classification_stub(c) for c in roots])


@bp.route('/classifications/<int:classification_id>/children', methods=['GET'])
@login_required
def get_classification_children(classification_id):
    if not current_user.active_institution_id:
        return error('No active institution', 400)

    c = _get_classification_or_404(classification_id, current_user.active_institution_id)
    if not c:
        return error('Classification not found', 404)

    children = c.children.order_by(Classification.code).all()
    return success([serialize_classification_stub(ch) for ch in children])


@bp.route('/classifications/<int:classification_id>', methods=['GET'])
@login_required
def get_classification(classification_id):
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    c = _get_classification_or_404(classification_id, current_user.active_institution_id)
    if not c:
        return error('Classification not found', 404)
    return success(serialize_classification_detail(c))


@bp.route('/classifications', methods=['POST'])
@login_required
@require_write
def create_classification():
    institution_id = current_user.active_institution_id
    data = request.get_json(silent=True) or {}

    required = ['name', 'code', 'level_name', 'hierarchy_type_id']
    missing = [f for f in required if not data.get(f)]
    if missing:
        return error(f'Missing required fields: {", ".join(missing)}', 400)

    parent = None
    if data.get('parent_id'):
        parent = _get_classification_or_404(data['parent_id'], institution_id)
        if not parent:
            return error('Parent classification not found', 404)

    c = Classification(
        institution_id=institution_id,
        name=data['name'],
        code=data['code'],
        level_name=data['level_name'],
        hierarchy_type_id=data['hierarchy_type_id'],
        description=data.get('description'),
        scope_note=data.get('scope_note'),
        parent=parent,
        created_by_id=current_user.id,
    )

    if data.get('valid_from'):
        try:
            c.valid_from = datetime.strptime(data['valid_from'], '%Y-%m-%d').date()
        except ValueError:
            return error('Invalid valid_from format. Use YYYY-MM-DD', 400)

    if data.get('valid_to'):
        try:
            c.valid_to = datetime.strptime(data['valid_to'], '%Y-%m-%d').date()
        except ValueError:
            return error('Invalid valid_to format. Use YYYY-MM-DD', 400)

    db.session.add(c)
    db.session.flush()

    if not c.validate_hierarchy():
        db.session.rollback()
        return error(f'Invalid hierarchy: "{c.level_name}" is not allowed at this position', 422)

    c.record_change(
        change_type='create',
        description=f'Created classification "{c.name}"',
        created_by_id=current_user.id,
        before_data={},
        after_data=c.to_dict(),
    )
    db.session.commit()
    return success(serialize_classification_detail(c), 201)


@bp.route('/classifications/<int:classification_id>', methods=['PATCH'])
@login_required
@require_write
def update_classification(classification_id):
    institution_id = current_user.active_institution_id
    c = _get_classification_or_404(classification_id, institution_id)
    if not c:
        return error('Classification not found', 404)

    data = request.get_json(silent=True) or {}
    before_data = c.to_dict()

    updatable = ['name', 'code', 'description', 'scope_note']
    for field in updatable:
        if field in data:
            setattr(c, field, data[field])

    if 'valid_from' in data:
        c.valid_from = datetime.strptime(data['valid_from'], '%Y-%m-%d').date() if data['valid_from'] else None
    if 'valid_to' in data:
        c.valid_to = datetime.strptime(data['valid_to'], '%Y-%m-%d').date() if data['valid_to'] else None

    after_data = c.to_dict()
    if before_data != after_data:
        changed_fields = [k for k in after_data if after_data[k] != before_data.get(k)]
        c.record_change(
            change_type='edit',
            description=f'Updated: {", ".join(changed_fields)}',
            created_by_id=current_user.id,
            before_data=before_data,
            after_data=after_data,
        )

    db.session.commit()
    return success(serialize_classification_detail(c))


@bp.route('/classifications/<int:classification_id>', methods=['DELETE'])
@login_required
@require_write
def delete_classification(classification_id):
    institution_id = current_user.active_institution_id
    c = _get_classification_or_404(classification_id, institution_id)
    if not c:
        return error('Classification not found', 404)

    def collect_subtree(node):
        result = [node]
        for child in node.children.order_by(Classification.id).all():
            result.extend(collect_subtree(child))
        return result

    all_nodes = collect_subtree(c)

    published = [n for n in all_nodes if getattr(n, 'status', 'draft') == 'published']
    if published:
        return error(
            f'Cannot delete: {len(published)} node(s) are still published. Retire them first.',
            409
        )

    linked = [n for n in all_nodes if n.nodes.count() > 0]
    if linked:
        return error(
            f'Cannot delete: {len(linked)} node(s) have linked resources. Unlink them first.',
            409
        )

    db.session.delete(c)
    db.session.commit()
    return success({'message': f'Deleted {len(all_nodes)} classification(s)'})


@bp.route('/classifications/<int:classification_id>/nodes', methods=['GET'])
@login_required
def get_classification_nodes(classification_id):
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    c = _get_classification_or_404(classification_id, current_user.active_institution_id)
    if not c:
        return error('Classification not found', 404)
    return success([serialize_node_stub(n) for n in c.nodes])


@bp.route('/classifications/<int:classification_id>/nodes', methods=['POST'])
@login_required
@require_write
def add_classification_node(classification_id):
    institution_id = current_user.active_institution_id
    c = _get_classification_or_404(classification_id, institution_id)
    if not c:
        return error('Classification not found', 404)

    data = request.get_json(silent=True) or {}
    node_id = data.get('node_id')
    if not node_id:
        return error('node_id is required', 400)

    from app.models import Node
    node = Node.query.filter_by(id=node_id, institution_id=institution_id).first()
    if not node:
        return error('Node not found', 404)

    existing = db.session.execute(
        sa.select(classification_node_association).where(
            classification_node_association.c.classification_id == classification_id,
            classification_node_association.c.node_id == node_id,
        )
    ).first()
    if existing:
        return error('Association already exists', 409)

    db.session.execute(
        classification_node_association.insert().values(
            classification_id=classification_id, node_id=node_id
        )
    )
    db.session.commit()
    return success({'message': 'Node associated'}, 201)


@bp.route('/classifications/<int:classification_id>/nodes/<int:node_id>', methods=['DELETE'])
@login_required
@require_write
def remove_classification_node(classification_id, node_id):
    institution_id = current_user.active_institution_id
    c = _get_classification_or_404(classification_id, institution_id)
    if not c:
        return error('Classification not found', 404)

    db.session.execute(
        classification_node_association.delete().where(
            classification_node_association.c.classification_id == classification_id,
            classification_node_association.c.node_id == node_id,
        )
    )
    db.session.commit()
    return success({'message': 'Association removed'})


@bp.route('/classifications/<int:classification_id>/history', methods=['GET'])
@login_required
def get_classification_history(classification_id):
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    c = _get_classification_or_404(classification_id, current_user.active_institution_id)
    if not c:
        return error('Classification not found', 404)

    changes = ClassificationChange.query.filter_by(
        classification_id=classification_id
    ).order_by(ClassificationChange.created_at.desc()).all()

    return success([serialize_classification_change(ch) for ch in changes])


@bp.route('/classifications/search', methods=['GET'])
@login_required
def search_classifications():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    q = request.args.get('q', '').strip()
    scheme_id = request.args.get('scheme_id', type=int)
    root_id = request.args.get('root_id', type=int) or scheme_id
    published_only = request.args.get('published_only', 'false').lower() == 'true'

    stmt = sa.select(Classification).where(
        Classification.institution_id == institution_id,
    ).distinct()

    if published_only:
        stmt = stmt.where(Classification.status == 'published')

    if root_id:
        all_ids = _get_descendant_ids(root_id)
        if not all_ids:
            return success([])
        stmt = stmt.where(Classification.id.in_(all_ids))

    if q:
        stmt = stmt.where(
            sa.or_(
                Classification.name.ilike(f'%{q}%'),
                Classification.code.ilike(f'%{q}%'),
            )
        )

    results = db.session.execute(
        stmt.order_by(Classification.code, Classification.name).limit(50)
    ).scalars().all()

    return success([{
        'id': c.id,
        'name': c.name,
        'code': c.code,
        'full_code': c.get_full_code(),
        'level_name': c.level_name,
        'status': getattr(c, 'status', 'draft'),
    } for c in results])


def _get_descendant_ids(parent_id: int) -> list[int]:
    result = [parent_id]
    children = Classification.query.filter_by(parent_id=parent_id).with_entities(Classification.id).all()
    for (child_id,) in children:
        result.extend(_get_descendant_ids(child_id))
    return result


@bp.route('/classifications/roots', methods=['GET'])
@login_required
def get_classification_roots():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    roots = Classification.query.filter_by(
        institution_id=institution_id,
        parent_id=None,
    ).order_by(Classification.code).all()

    return success([{
        'id': c.id,
        'name': c.name,
        'code': c.code,
        'full_code': c.get_full_code(),
        'level_name': c.level_name,
        'description': c.description,
        'child_count': c.children.count(),
    } for c in roots])


@bp.route('/classifications/schemes', methods=['GET'])
@login_required
def list_classification_schemes():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    published_only = request.args.get('published_only', 'false').lower() == 'true'

    q = sa.select(Classification).where(
        Classification.institution_id == institution_id,
        Classification.parent_id == None,  # noqa: E711
    )
    if published_only:
        q = q.where(Classification.status == 'published')
    schemes = db.session.execute(q.order_by(Classification.name)).scalars().all()

    return success([{
        'id': c.id,
        'name': c.name,
        'code': c.code,
        'level_name': c.level_name,
        'node_count': c.nodes.count() if hasattr(c, 'nodes') else 0,
    } for c in schemes])


@bp.route('/classifications/valid-levels', methods=['GET'])
@login_required
def get_classification_valid_levels():
    institution_id = current_user.active_institution_id
    hierarchy_type_id = request.args.get('hierarchy_type_id', type=int)
    parent_id = request.args.get('parent_id', type=int)

    if not hierarchy_type_id:
        return error('hierarchy_type_id is required', 400)

    if parent_id:
        parent = Classification.query.filter_by(
            id=parent_id, institution_id=institution_id
        ).first()
        if not parent:
            return error('Parent classification not found', 404)

        parent_level = db.session.execute(
            sa.select(HierarchyLevel).where(
                HierarchyLevel.hierarchy_type_id == hierarchy_type_id,
                sa.func.lower(HierarchyLevel.name) == parent.level_name.lower()
            )
        ).scalar_one_or_none()

        if not parent_level:
            return success([])

        all_levels = HierarchyLevel.query.filter_by(
            hierarchy_type_id=hierarchy_type_id
        ).all()
        valid = [
            {'id': l.id, 'name': l.name, 'sort_order': l.sort_order}
            for l in all_levels
            if parent_level in l.allowed_parents
        ]
    else:
        all_levels = HierarchyLevel.query.filter_by(
            hierarchy_type_id=hierarchy_type_id
        ).all()
        valid = [
            {'id': l.id, 'name': l.name, 'sort_order': l.sort_order}
            for l in all_levels
            if len(l.allowed_parents) == 0
        ]

    return success(sorted(valid, key=lambda x: x['sort_order']))


@bp.route('/classifications/<int:classification_id>/publish', methods=['POST'])
@login_required
@require_write
def publish_classification(classification_id):
    institution_id = current_user.active_institution_id
    c = Classification.query.filter_by(
        id=classification_id, institution_id=institution_id
    ).first()
    if not c:
        return error('Classification not found', 404)

    data = request.get_json(silent=True) or {}
    version_label = data.get('version_label', '').strip() or None

    def collect_subtree(node):
        result = [node]
        for child in node.children.order_by(Classification.id).all():
            result.extend(collect_subtree(child))
        return result

    all_nodes = collect_subtree(c)

    with db.session.no_autoflush:
        for node in all_nodes:
            if version_label:
                node.version_label = version_label
            if node.status == 'published':
                node.version += 1
            node.status = 'published'

    for node in all_nodes:
        node.record_change(
            'publish',
            f'Published as version {node.version_label or node.version}',
            created_by_id=current_user.id,
            before_data={},
            after_data=node.to_dict(),
        )

    db.session.commit()
    return success(serialize_classification_detail(c))


@bp.route('/classifications/<int:classification_id>/retire', methods=['POST'])
@login_required
@require_write
def retire_classification(classification_id):
    institution_id = current_user.active_institution_id
    c = Classification.query.filter_by(
        id=classification_id, institution_id=institution_id
    ).first()
    if not c:
        return error('Classification not found', 404)

    recursive = request.args.get('recursive', 'false').lower() == 'true'

    def collect_subtree(node):
        result = [node]
        for child in node.children.order_by(Classification.id).all():
            result.extend(collect_subtree(child))
        return result

    nodes_to_retire = collect_subtree(c) if recursive else [c]

    with db.session.no_autoflush:
        for node in nodes_to_retire:
            node.status = 'retired'

    for node in nodes_to_retire:
        node.record_change(
            'retire', 'Retired' + (' (full tree)' if recursive and node.id != c.id else ''),
            created_by_id=current_user.id,
            before_data={},
            after_data=node.to_dict(),
        )

    db.session.commit()
    return success(serialize_classification_detail(c))


@bp.route('/classifications/<int:classification_id>/bpmn', methods=['GET'])
@login_required
def get_classification_bpmn(classification_id):
    institution_id = current_user.active_institution_id
    c = Classification.query.filter_by(
        id=classification_id, institution_id=institution_id
    ).first()
    if not c:
        return error('Classification not found', 404)
    return success({'bpmn_xml': c.bpmn_xml})


@bp.route('/classifications/<int:classification_id>/bpmn', methods=['PATCH'])
@login_required
@require_write
def update_classification_bpmn(classification_id):
    institution_id = current_user.active_institution_id
    c = Classification.query.filter_by(
        id=classification_id, institution_id=institution_id
    ).first()
    if not c:
        return error('Classification not found', 404)

    data = request.get_json(silent=True) or {}
    xml = data.get('bpmn_xml')
    c.bpmn_xml = xml.strip() if xml and xml.strip() else None

    BpmnTaskLink.query.filter_by(diagram_classification_id=c.id).delete()
    if c.bpmn_xml:
        records = data.get('task_links') or []
        seen = set()
        for rec in records:
            task_id = (rec.get('task_bpmn_id') or '').strip()
            if not task_id or task_id in seen:
                continue
            seen.add(task_id)

            linked_id = rec.get('linked_classification_id')
            if linked_id:
                target = Classification.query.filter_by(
                    id=linked_id, institution_id=institution_id).first()
                if not target:
                    linked_id = None

            db.session.add(BpmnTaskLink(
                diagram_classification_id=c.id,
                linked_classification_id=linked_id,
                task_bpmn_id=task_id,
                task_label=(rec.get('task_label') or '').strip()[:300] or None,
                retention_period=(rec.get('retention_period') or '').strip()[:120] or None,
                retention_rule=(rec.get('retention_rule') or '').strip()[:200] or None,
                disposal_action=(rec.get('disposal_action') or '').strip()[:120] or None,
                security_class=(rec.get('security_class') or '').strip()[:120] or None,
                medium_format=(rec.get('medium_format') or '').strip()[:120] or None,
                legal_basis=(rec.get('legal_basis') or '').strip()[:300] or None,
                description=(rec.get('description') or '').strip() or None,
                produced_by=(rec.get('produced_by') or '').strip()[:500] or None,
                used_by=(rec.get('used_by') or '').strip()[:500] or None,
            ))

    db.session.commit()
    return success({'bpmn_xml': c.bpmn_xml, 'has_bpmn': bool(c.bpmn_xml)})


@bp.route('/classifications/<int:classification_id>/produced-by', methods=['GET'])
@login_required
def get_classification_produced_by(classification_id):
    institution_id = current_user.active_institution_id
    c = Classification.query.filter_by(
        id=classification_id, institution_id=institution_id
    ).first()
    if not c:
        return error('Classification not found', 404)

    links = BpmnTaskLink.query.filter_by(
        linked_classification_id=classification_id).all()
    result = []
    for link in links:
        diagram_c = link.diagram_classification
        if not diagram_c:
            continue
        result.append({
            'task_bpmn_id': link.task_bpmn_id,
            'task_label': link.task_label,
            'diagram_classification_id': diagram_c.id,
            'diagram_name': diagram_c.name,
            'diagram_code': diagram_c.get_full_code(),
            'retention_period': link.retention_period,
            'retention_rule': link.retention_rule,
            'disposal_action': link.disposal_action,
            'security_class': link.security_class,
            'medium_format': link.medium_format,
        })
    return success(result)


@bp.route('/classifications/import', methods=['POST'])
@login_required
@require_write
def import_classification():
    institution_id = current_user.active_institution_id

    if 'file' not in request.files:
        return error('No file uploaded', 400)

    f = request.files['file']
    hierarchy_type_id = request.form.get('hierarchy_type_id', type=int)
    if not hierarchy_type_id:
        return error('hierarchy_type_id is required', 400)

    try:
        data = json.loads(f.read().decode('utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        return error(f'Invalid JSON: {e}', 400)

    ht = HierarchyType.query.filter_by(
        id=hierarchy_type_id, institution_id=institution_id
    ).first()
    if not ht:
        return error('Hierarchy type not found', 404)

    result = {'created': 0, 'errors': []}

    def import_node(node_data: dict, parent: Classification | None) -> Classification | None:
        code = str(node_data.get('code', '')).strip()
        name = str(node_data.get('name', '')).strip()
        level = str(node_data.get('level', '')).strip()

        if not code or not name or not level:
            result['errors'].append(
                f'Skipped node missing code/name/level: {node_data}'
            )
            return None

        existing = Classification.query.filter_by(
            institution_id=institution_id,
            code=code,
            parent_id=parent.id if parent else None,
        ).first()

        if existing:
            obj = existing
        else:
            obj = Classification(
                institution_id=institution_id,
                hierarchy_type_id=hierarchy_type_id,
                parent=parent,
            )
            db.session.add(obj)

        obj.name = name
        obj.code = code
        obj.level_name = level
        obj.description = node_data.get('description') or None
        obj.scope_note = node_data.get('scope_note') or None
        obj.status = node_data.get('status', 'draft')
        obj.version_label = node_data.get('version_label') or None
        obj.created_by_id = obj.created_by_id or current_user.id

        db.session.flush()
        result['created'] += 1

        for child in node_data.get('children', []):
            import_node(child, obj)

        return obj

    try:
        schemes = data if isinstance(data, list) else [data]
        for scheme in schemes:
            import_node(scheme, None)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return error(f'Import failed: {e}', 500)

    return success(result, 201)


@bp.route('/classifications/<int:classification_id>/major-version', methods=['POST'])
@login_required
@require_write
def create_major_version(classification_id):
    institution_id = current_user.active_institution_id
    root = Classification.query.filter_by(
        id=classification_id, institution_id=institution_id
    ).first()
    if not root:
        return error('Classification not found', 404)
    if root.parent_id:
        return error('Major versions can only be created from a root classification', 422)

    data = request.get_json(silent=True) or {}
    version_label = data.get('version_label', '').strip() or None

    def copy_node(source: Classification, new_parent: Classification | None) -> Classification:
        new_node = Classification(
            institution_id=institution_id,
            name=source.name,
            code=source.code,
            level_name=source.level_name,
            description=source.description,
            scope_note=source.scope_note,
            hierarchy_type_id=source.hierarchy_type_id,
            parent=new_parent,
            status='draft',
            version=source.version + 1,
            version_label=version_label,
            created_by_id=current_user.id,
        )
        db.session.add(new_node)
        db.session.flush()
        for child in source.children.all():
            copy_node(child, new_node)
        return new_node

    new_root = copy_node(root, None)
    db.session.commit()
    return success(serialize_classification_detail(new_root), 201)


@bp.route('/classifications/<int:classification_id>/records', methods=['GET'])
@login_required
def list_classification_records(classification_id):
    institution_id = current_user.active_institution_id
    c = Classification.query.filter_by(
        id=classification_id, institution_id=institution_id).first()
    if not c:
        return error('Classification not found', 404)

    links = BpmnTaskLink.query.filter_by(diagram_classification_id=c.id).all()
    result = []
    for link in links:
        linked = link.linked_classification
        d = link.to_dict()
        d['record_name'] = link.task_label
        d['linked_code'] = linked.get_full_code() if linked else None
        d['linked_name'] = linked.name if linked else None
        result.append(d)
    result.sort(key=lambda r: (r.get('record_name') or '').lower())
    return success(result)


def _seed_records_vocab(institution_id):
    existing = RecordsVocabularyTerm.query.filter_by(institution_id=institution_id).count()
    if existing:
        return
    for field, values in DEFAULT_RECORDS_VOCAB.items():
        for i, v in enumerate(values):
            db.session.add(RecordsVocabularyTerm(
                institution_id=institution_id, field=field, value=v, sort_order=i))
    db.session.flush()


@bp.route('/records-vocabulary', methods=['GET'])
@login_required
def get_records_vocabulary():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)
    _seed_records_vocab(institution_id)
    db.session.commit()
    terms = RecordsVocabularyTerm.query.filter_by(
        institution_id=institution_id).order_by(
        RecordsVocabularyTerm.field, RecordsVocabularyTerm.sort_order,
        RecordsVocabularyTerm.value).all()
    grouped = {'disposal': [], 'security': [], 'medium': []}
    for t in terms:
        grouped.setdefault(t.field, []).append(t.to_dict())
    return success(grouped)


@bp.route('/records-vocabulary', methods=['POST'])
@login_required
@require_write
def add_records_vocabulary_term():
    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)
    data = request.get_json(silent=True) or {}
    field = (data.get('field') or '').strip()
    value = (data.get('value') or '').strip()
    if field not in ('disposal', 'security', 'medium'):
        return error('Invalid field', 400)
    if not value:
        return error('value is required', 400)
    exists = RecordsVocabularyTerm.query.filter_by(
        institution_id=institution_id, field=field, value=value).first()
    if exists:
        return error('That value already exists.', 409)
    term = RecordsVocabularyTerm(
        institution_id=institution_id, field=field, value=value,
        sort_order=data.get('sort_order', 0))
    db.session.add(term)
    db.session.commit()
    return success(term.to_dict(), 201)


@bp.route('/records-vocabulary/<int:term_id>', methods=['DELETE'])
@login_required
@require_write
def delete_records_vocabulary_term(term_id):
    institution_id = current_user.active_institution_id
    term = RecordsVocabularyTerm.query.filter_by(
        id=term_id, institution_id=institution_id).first()
    if not term:
        return error('Term not found', 404)
    db.session.delete(term)
    db.session.commit()
    return success({'message': 'Deleted'})