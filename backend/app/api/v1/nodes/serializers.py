import sqlalchemy as sa

from app.extensions import db
from app.models.node import Node, NodeChange, NodeAttachment, NodeNote


def compute_has_children(nodes) -> set:
    """Return the set of node ids (from `nodes`) that have at least one child.

    One query for the whole batch instead of one COUNT per node.
    """
    ids = [n.id for n in nodes]
    if not ids:
        return set()
    rows = db.session.execute(
        sa.select(Node.parent_id)
        .where(Node.parent_id.in_(ids))
        .group_by(Node.parent_id)
    ).scalars().all()
    return set(rows)


def serialize_node_stub(node: Node, has_children: bool | None = None) -> dict:
    """Minimal representation for tree views and lists.

    Pass `has_children` (from compute_has_children) when serializing a batch.
    When omitted, a single EXISTS query is issued for this node.
    """
    if has_children is None:
        has_children = db.session.execute(
            sa.select(sa.exists().where(Node.parent_id == node.id))
        ).scalar()

    return {
        'id': node.id,
        'title': node.title,
        'ref_code': node.ref_code,
        'local_ref': node.local_ref,
        'level_of_description': node.level_of_description,
        'status': node.status.value,
        'date_start': node.date_start.isoformat() if node.date_start else None,
        'date_end': node.date_end.isoformat() if node.date_end else None,
        'has_children': bool(has_children),
        'parent_id': node.parent_id,
    }


def serialize_node_detail(node: Node) -> dict:
    """Full representation for the detail view."""
    children_count = db.session.execute(
        sa.select(sa.func.count())
        .select_from(Node)
        .where(Node.parent_id == node.id)
    ).scalar()

    return {
        'id': node.id,
        'institution_id': node.institution_id,
        'title': node.title,
        'ref_code': node.ref_code,
        'local_ref': node.local_ref,
        'level_of_description': node.level_of_description,
        'hierarchy_type_id': node.hierarchy_type_id,
        'hierarchy_type_name': node.hierarchy_type.name if node.hierarchy_type else None,
        'status': node.status.value,
        'description': node.description,
        'date_start': node.date_start.isoformat() if node.date_start else None,
        'date_end': node.date_end.isoformat() if node.date_end else None,
        'date_certainty': node.date_certainty,
        'extent': node.extent,
        'scope_and_content': node.scope_and_content,
        'arrangement': node.arrangement,
        'access_conditions': node.access_conditions,
        'reproduction_conditions': node.reproduction_conditions,
        'language': node.language,
        'finding_aids': node.finding_aids,
        'metadata_spec': node.metadata_spec or {},
        'metadata_fields': node.get_metadata_fields(),
        'open_flag_count': sum(1 for f in node.flags if f.status != 'resolved'),
        'places': [p.to_dict() for p in node.places],
        'tags': [t.to_dict() for t in node.tags],
        'parent_id': node.parent_id,
        'breadcrumb': node.get_breadcrumb(),
        'has_children': children_count > 0,
        'children_count': children_count,
        'can_have_location': node.can_have_location(),
        'is_object': node.is_object(),
        'representations': [
            {
                'id': r.id,
                'rep_type_id': r.rep_type_id,
                'rep_type_name': r.rep_type_obj.name if r.rep_type_obj else None,
                'label': r.label,
                'file_count': len(r.files),
            }
            for r in node.representations
        ],
        'created_at': node.created_at.isoformat(),
        'updated_at': node.updated_at.isoformat(),
        'created_by': node.created_by.username if node.created_by else None,
        'updated_by': node.updated_by.username if node.updated_by else None,
        'attachments': [serialize_attachment(a) for a in node.attachments
                        if a.representation_id is None],
        'notes': [serialize_note(n) for n in node.notes],
        'identifiers': [i.to_dict() for i in node.identifiers],
    }


def serialize_change(change: NodeChange) -> dict:
    return {
        'id': change.id,
        'change_type': change.change_type,
        'description': change.description,
        'before_data': change.before_data,
        'after_data': change.after_data,
        'created_at': change.created_at.isoformat(),
        'created_by': change.created_by.username if change.created_by else None,
    }


def serialize_attachment(attachment: NodeAttachment) -> dict:
    return {
        'id': attachment.id,
        'original_filename': attachment.original_filename,
        'file_size': attachment.file_size,
        'mime_type': attachment.mime_type,
        'description': attachment.description,
        'representation_id': attachment.representation_id,
        'representation_name': attachment.representation_obj.rep_type_obj.name
                               if attachment.representation_obj else None,
        'uploaded_at': attachment.uploaded_at.isoformat(),
        'uploaded_by': attachment.uploaded_by.username if attachment.uploaded_by else None,
        # Integrity
        'checksum_md5': attachment.checksum_md5,
        'checksum_sha256': attachment.checksum_sha256,
        'pronom_id': attachment.pronom_id,
        # Image
        'image_width': attachment.image_width,
        'image_height': attachment.image_height,
        'image_dpi_x': attachment.image_dpi_x,
        'image_dpi_y': attachment.image_dpi_y,
        'image_mode': attachment.image_mode,
        'image_bit_depth': attachment.image_bit_depth,
        'exif_data': attachment.exif_data,
        # OCR — extracted_text is a deferred column; use the timestamp as the
        # presence indicator so the (potentially huge) text is never loaded here
        'extracted_text': attachment.extracted_text_at is not None,
        'extracted_text_at': attachment.extracted_text_at.isoformat() if attachment.extracted_text_at else None,
        # AV
        'duration_seconds': attachment.duration_seconds,
        'av_codec': attachment.av_codec,
        'av_bitrate': attachment.av_bitrate,
        # Thumbnail
        'has_thumbnail': attachment.thumbnail_path is not None,
        'tech_extracted_at': attachment.tech_extracted_at.isoformat()
                             if attachment.tech_extracted_at else None,
    }


def serialize_note(note: NodeNote) -> dict:
    return {
        'id': note.id,
        'note_type': note.note_type,
        'content': note.content,
        'is_public': note.is_public,
        'created_at': note.created_at.isoformat(),
        'updated_at': note.updated_at.isoformat(),
        'created_by': note.created_by.username if note.created_by else None,
    }
