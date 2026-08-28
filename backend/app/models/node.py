from datetime import datetime, timezone, date
from typing import Optional, List, Dict
from enum import Enum
import sqlalchemy as sa
import sqlalchemy.orm as so
from app.extensions import db


class NodeStatus(str, Enum):
    DRAFT = 'draft'
    PUBLISHED = 'published'
    RESTRICTED = 'restricted'


node_association = sa.Table(
    'node_association',
    db.Model.metadata,
    sa.Column('source_id', sa.Integer, sa.ForeignKey('nodes.id', ondelete='CASCADE'), primary_key=True),
    sa.Column('target_id', sa.Integer, sa.ForeignKey('nodes.id', ondelete='CASCADE'), primary_key=True),
    sa.Column('relation_type', sa.String(100), nullable=False),
    sa.CheckConstraint('source_id != target_id', name='no_self_association'),
)


class NodeRelationType(db.Model):
    """Configurable relation types between nodes (e.g. 'related to', 'continues')"""
    __tablename__ = 'node_relation_types'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('institutions.id', ondelete='CASCADE'))
    name: so.Mapped[str] = so.mapped_column(sa.String(100))
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.String(300), nullable=True)
    is_symmetric: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=True)
    complementary_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('node_relation_types.id', name='fk_node_relation_complementary'),
        nullable=True
    )
    complementary: so.Mapped[Optional['NodeRelationType']] = so.relationship(
        'NodeRelationType', remote_side='NodeRelationType.id', foreign_keys=[complementary_id]
    )

    __table_args__ = (
        sa.UniqueConstraint('institution_id', 'name', name='uq_node_relation_type_per_institution'),
    )

    def __repr__(self):
        return f'<NodeRelationType {self.name}>'


class Node(db.Model):
    __tablename__ = 'nodes'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('institutions.id', ondelete='CASCADE'))

    # --- Reference code ---
    # Full globally unique ref: SE-GBG-A1 / SE-GBG-A1:B2 etc.
    # local_ref is the archivist-assigned portion within its parent
    local_ref: so.Mapped[str] = so.mapped_column(sa.String(100))
    ref_code: so.Mapped[str] = so.mapped_column(sa.String(500), unique=True)  # full computed ref

    # --- Core description fields (ISAD(G) inspired) ---
    title: so.Mapped[str] = so.mapped_column(sa.String(500))
    level_of_description: so.Mapped[str] = so.mapped_column(sa.String(100))
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    date_start: so.Mapped[Optional[date]] = so.mapped_column(sa.Date, nullable=True)
    date_end: so.Mapped[Optional[date]] = so.mapped_column(sa.Date, nullable=True)
    date_certainty: so.Mapped[Optional[str]] = so.mapped_column(sa.String(50), nullable=True)  # 'exact', 'approximate', 'inferred'
    extent: so.Mapped[Optional[str]] = so.mapped_column(sa.String(200), nullable=True)
    scope_and_content: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    arrangement: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    access_conditions: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    reproduction_conditions: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    language: so.Mapped[Optional[str]] = so.mapped_column(sa.String(100), nullable=True)
    finding_aids: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)

    # --- Location tracking (museum) ---
    current_location_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('locations.id', ondelete='SET NULL', name='fk_node_current_location'), nullable=True)

    # --- Extended/level-specific metadata ---
    metadata_spec: so.Mapped[Optional[dict]] = so.mapped_column(sa.JSON, nullable=True, default=dict)

    # --- Status ---
    status: so.Mapped[NodeStatus] = so.mapped_column(
        sa.Enum(NodeStatus), nullable=False, default=NodeStatus.DRAFT
    )

    # --- Hierarchy ---
    hierarchy_type_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('hierarchy_types.id', name='fk_node_hierarchy_type')
    )
    hierarchy_type: so.Mapped['HierarchyType'] = so.relationship('HierarchyType')

    parent_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.Integer,
        sa.ForeignKey('nodes.id', ondelete='CASCADE', name='fk_node_parent'),
        nullable=True
    )
    parent: so.Mapped[Optional['Node']] = so.relationship(
        'Node', remote_side='Node.id',
        backref=so.backref('children', lazy='dynamic', cascade='all, delete-orphan', passive_deletes=True)
    )

    # --- Timestamps ---
    created_at: so.Mapped[datetime] = so.mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: so.Mapped[datetime] = so.mapped_column(
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc)
    )
    created_by_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('users.id', name='fk_node_created_by'), nullable=True
    )
    updated_by_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('users.id', name='fk_node_updated_by'), nullable=True
    )
    created_by: so.Mapped[Optional['User']] = so.relationship('User', foreign_keys=[created_by_id])
    updated_by: so.Mapped[Optional['User']] = so.relationship('User', foreign_keys=[updated_by_id])

    # --- Relationships ---
    institution: so.Mapped['Institution'] = so.relationship('Institution', back_populates='nodes')

    related_nodes: so.Mapped[List['Node']] = so.relationship(
        'Node',
        secondary=node_association,
        primaryjoin='Node.id==node_association.c.source_id',
        secondaryjoin='Node.id==node_association.c.target_id',
        backref=so.backref('related_from', lazy='dynamic'),
        lazy='dynamic'
    )

    flags: so.Mapped[List['NodeFlag']] = so.relationship(
        'NodeFlag', back_populates='node',
        cascade='all, delete-orphan',
        order_by='NodeFlag.created_at.desc()',
    )

    places: so.Mapped[List['NodePlace']] = so.relationship(
        'NodePlace', back_populates='node',
        cascade='all, delete-orphan', order_by='NodePlace.sort_order'
    )
    tags: so.Mapped[List['Tag']] = so.relationship(
        'Tag', secondary='node_tags', back_populates='nodes', lazy='dynamic'
    )

    changes: so.Mapped[List['NodeChange']] = so.relationship(
        'NodeChange', back_populates='node', cascade='all, delete-orphan',
        order_by='NodeChange.created_at.desc()'
    )
    attachments: so.Mapped[List['NodeAttachment']] = so.relationship(
        'NodeAttachment', back_populates='node', cascade='all, delete-orphan'
    )

    representations: so.Mapped[List['NodeRepresentation']] = so.relationship(
        'NodeRepresentation', back_populates='node', cascade='all, delete-orphan',
        order_by='NodeRepresentation.created_at'
    )

    notes: so.Mapped[List['NodeNote']] = so.relationship(
        'NodeNote', back_populates='node', cascade='all, delete-orphan'
    )

    identifiers: so.Mapped[List['NodeIdentifier']] = so.relationship(
        'NodeIdentifier', back_populates='node', cascade='all, delete-orphan',
        order_by='NodeIdentifier.created_at'
    )

    __table_args__ = (
        sa.UniqueConstraint('local_ref', 'parent_id', 'institution_id', name='uq_local_ref_per_parent'),
        # Serves children lookups AND their ORDER BY local_ref in one index
        sa.Index('ix_nodes_parent_local_ref', 'parent_id', 'local_ref'),
        # Serves root listing per institution (parent_id IS NULL scans)
        sa.Index('ix_nodes_institution_parent', 'institution_id', 'parent_id'),
    )

    def __repr__(self):
        return f'<Node {self.ref_code}: {self.title}>'

    # --- Ref code ---

    def compute_ref_code(self) -> str:
        institution = self.institution
        if self.parent:
            return f'{self.parent.ref_code}/{self.local_ref}'
        return f'{institution.ref_prefix}/{self.local_ref}'

    def refresh_ref_code(self) -> None:
        """Recompute ref_code for this node and its entire subtree.

        Iterative breadth-first, one query per tree level instead of one per
        node, and each descendant is written exactly once.
        """
        self.ref_code = self.compute_ref_code()
        current: Dict[int, str] = {self.id: self.ref_code}
        while current:
            rows = db.session.execute(
                sa.select(Node).where(Node.parent_id.in_(current.keys()))
            ).scalars().all()
            nxt: Dict[int, str] = {}
            for child in rows:
                child.ref_code = f'{current[child.parent_id]}/{child.local_ref}'
                nxt[child.id] = child.ref_code
            current = nxt

    # --- Hierarchy helpers ---

    def is_top_node(self) -> bool:
        return self.parent_id is None

    def get_top_node(self) -> 'Node':
        current = self
        while current.parent is not None:
            current = current.parent
        return current

    def get_ancestors(self) -> List['Node']:
        ancestors = []
        current = self
        while current.parent is not None:
            ancestors.append(current.parent)
            current = current.parent
        return list(reversed(ancestors))

    def get_breadcrumb(self) -> List[dict]:
        return [{'id': n.id, 'title': n.title, 'ref_code': n.ref_code} for n in self.get_ancestors()] \
               + [{'id': self.id, 'title': self.title, 'ref_code': self.ref_code}]

    def is_descendant_of(self, other: 'Node') -> bool:
        ancestor = self.parent
        while ancestor:
            if ancestor.id == other.id:
                return True
            ancestor = ancestor.parent
        return False

    def validate_hierarchy(self) -> bool:
        from app.models.hierarchy import HierarchyLevel, hierarchy_level_relationships
        current_level = db.session.execute(
            sa.select(HierarchyLevel).where(
                HierarchyLevel.hierarchy_type_id == self.hierarchy_type_id,
                sa.func.lower(HierarchyLevel.name) == self.level_of_description.lower()
            )
        ).scalar_one_or_none()

        if not current_level:
            return False

        if self.parent is None:
            return len(current_level.allowed_parents) == 0

        parent_level = db.session.execute(
            sa.select(HierarchyLevel).where(
                HierarchyLevel.hierarchy_type_id == self.hierarchy_type_id,
                sa.func.lower(HierarchyLevel.name) == self.parent.level_of_description.lower()
            )
        ).scalar_one_or_none()

        return parent_level is not None and parent_level in current_level.allowed_parents

    def get_metadata_fields(self) -> List[dict]:
        from app.models.hierarchy import HierarchyLevel
        level = db.session.execute(
            sa.select(HierarchyLevel).where(
                HierarchyLevel.hierarchy_type_id == self.hierarchy_type_id,
                sa.func.lower(HierarchyLevel.name) == self.level_of_description.lower()
            )
        ).scalar_one_or_none()
        return level.get_metadata_fields() if level else []

    def can_have_location(self) -> bool:
        from app.models.hierarchy import HierarchyLevel, HierarchyEntityType
        if self.hierarchy_type.entity_type != HierarchyEntityType.RESOURCE:
            return False
        level = db.session.execute(
            sa.select(HierarchyLevel).where(
                HierarchyLevel.hierarchy_type_id == self.hierarchy_type_id,
                sa.func.lower(HierarchyLevel.name) == self.level_of_description.lower()
            )
        ).scalar_one_or_none()
        return level.effective_can_have_location if level else False

    def is_object(self) -> bool:
        from app.models.hierarchy import HierarchyLevel
        level = db.session.execute(
            sa.select(HierarchyLevel).where(
                HierarchyLevel.hierarchy_type_id == self.hierarchy_type_id,
                sa.func.lower(HierarchyLevel.name) == self.level_of_description.lower()
            )
        ).scalar_one_or_none()
        return level.effective_is_object_level if level else False

    # --- Versioning ---

    def to_dict(self) -> Dict:
        return {
            'title': self.title,
            'local_ref': self.local_ref,
            'ref_code': self.ref_code,
            'level_of_description': self.level_of_description,
            'description': self.description,
            'date_start': self.date_start.isoformat() if self.date_start else None,
            'date_end': self.date_end.isoformat() if self.date_end else None,
            'date_certainty': self.date_certainty,
            'extent': self.extent,
            'scope_and_content': self.scope_and_content,
            'arrangement': self.arrangement,
            'access_conditions': self.access_conditions,
            'reproduction_conditions': self.reproduction_conditions,
            'language': self.language,
            'finding_aids': self.finding_aids,
            'metadata_spec': self.metadata_spec,
            'status': self.status.value,
            'parent_id': self.parent_id,
            'hierarchy_type_id': self.hierarchy_type_id,
        }

    def record_change(self, change_type: str, description: str, created_by_id: int,
                      before_data: Dict, after_data: Dict) -> 'NodeChange':
        change = NodeChange(
            node_id=self.id,
            change_type=change_type,
            description=description,
            created_by_id=created_by_id,
            before_data=before_data,
            after_data=after_data,
        )
        db.session.add(change)
        return change

    def revert_to(self, change_id: int, created_by_id: int) -> None:
        target = db.session.get(NodeChange, change_id)
        if not target:
            raise ValueError(f'Change {change_id} not found')
        if target.node_id != self.id:
            raise ValueError('Change does not belong to this node')

        before_data = self.to_dict()
        restore = target.after_data if target.change_type == 'create' else target.before_data

        for field, value in restore.items():
            if field in ('parent_id', 'hierarchy_type_id', 'ref_code'):
                continue
            # Convert types stored as strings in JSON back to Python types
            if field == 'status' and isinstance(value, str):
                value = NodeStatus(value)
            elif field in ('date_start', 'date_end') and isinstance(value, str):
                from datetime import date
                value = date.fromisoformat(value)
            setattr(self, field, value)

        self.record_change(
            change_type='revert',
            description=f'Reverted to state from {target.created_at.isoformat()}',
            created_by_id=created_by_id,
            before_data=before_data,
            after_data=self.to_dict()
        )
        db.session.commit()


class NodeChange(db.Model):
    __tablename__ = 'node_changes'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    node_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('nodes.id', ondelete='CASCADE'))
    change_type: so.Mapped[str] = so.mapped_column(sa.String(50))   # create, edit, revert, move, status_change
    description: so.Mapped[str] = so.mapped_column(sa.Text)
    before_data: so.Mapped[dict] = so.mapped_column(sa.JSON)
    after_data: so.Mapped[dict] = so.mapped_column(sa.JSON)
    created_at: so.Mapped[datetime] = so.mapped_column(default=lambda: datetime.now(timezone.utc))
    created_by_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('users.id'))

    node: so.Mapped['Node'] = so.relationship('Node', back_populates='changes')
    created_by: so.Mapped['User'] = so.relationship('User')

    def __repr__(self):
        return f'<NodeChange {self.change_type} on node {self.node_id}>'


class NodeAttachment(db.Model):
    """PDF finding aids and other documents attached to a node."""
    __tablename__ = 'node_attachments'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    node_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('nodes.id', ondelete='CASCADE'))
    filename: so.Mapped[str] = so.mapped_column(sa.String(255))
    original_filename: so.Mapped[str] = so.mapped_column(sa.String(255))
    file_size: so.Mapped[int] = so.mapped_column(sa.Integer)
    mime_type: so.Mapped[str] = so.mapped_column(sa.String(100))
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.String(300), nullable=True)
    uploaded_at: so.Mapped[datetime] = so.mapped_column(default=lambda: datetime.now(timezone.utc))
    uploaded_by_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('users.id'))

    # ── Technical metadata ──────────────────────────────────────────
    checksum_md5:    so.Mapped[Optional[str]] = so.mapped_column(sa.String(32),  nullable=True)
    checksum_sha256: so.Mapped[Optional[str]] = so.mapped_column(sa.String(64),  nullable=True)
    pronom_id:       so.Mapped[Optional[str]] = so.mapped_column(sa.String(20),  nullable=True)
    image_width:     so.Mapped[Optional[int]] = so.mapped_column(sa.Integer,     nullable=True)
    image_height:    so.Mapped[Optional[int]] = so.mapped_column(sa.Integer,     nullable=True)
    image_dpi_x:     so.Mapped[Optional[float]] = so.mapped_column(sa.Float,     nullable=True)
    image_dpi_y:     so.Mapped[Optional[float]] = so.mapped_column(sa.Float,     nullable=True)
    image_mode:      so.Mapped[Optional[str]] = so.mapped_column(sa.String(20),  nullable=True)
    image_bit_depth: so.Mapped[Optional[int]] = so.mapped_column(sa.Integer,     nullable=True)
    exif_data:       so.Mapped[Optional[dict]] = so.mapped_column(sa.JSON,       nullable=True)
    duration_seconds:so.Mapped[Optional[float]] = so.mapped_column(sa.Float,     nullable=True)
    av_codec:        so.Mapped[Optional[str]] = so.mapped_column(sa.String(100), nullable=True)
    av_bitrate:      so.Mapped[Optional[int]] = so.mapped_column(sa.Integer,     nullable=True)

    thumbnail_path:  so.Mapped[Optional[str]] = so.mapped_column(sa.String(500), nullable=True)
    tech_extracted_at: so.Mapped[Optional[datetime]] = so.mapped_column(sa.DateTime, nullable=True)
    extracted_text: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True, deferred=True)
    extracted_text_at: so.Mapped[Optional[datetime]] = so.mapped_column(sa.DateTime, nullable=True)

    node: so.Mapped['Node'] = so.relationship('Node', back_populates='attachments')
    uploaded_by: so.Mapped['User'] = so.relationship('User')

    representation_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('node_representations.id', ondelete='SET NULL', name='fk_attachment_representation'),
        nullable=True
    )
    representation_obj: so.Mapped[Optional['NodeRepresentation']] = so.relationship(
        'NodeRepresentation', back_populates='files'
    )

    def __repr__(self):
        return f'<NodeAttachment {self.original_filename}>'


class NodeNote(db.Model):
    __tablename__ = 'node_notes'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    node_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('nodes.id', ondelete='CASCADE'))
    note_type: so.Mapped[str] = so.mapped_column(sa.String(100))    # e.g. 'general', 'accruals', 'appraisal'
    content: so.Mapped[str] = so.mapped_column(sa.Text)
    is_public: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=False)
    created_at: so.Mapped[datetime] = so.mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: so.Mapped[datetime] = so.mapped_column(
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc)
    )
    created_by_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('users.id'))

    node: so.Mapped['Node'] = so.relationship('Node', back_populates='notes')
    created_by: so.Mapped['User'] = so.relationship('User')

    def __repr__(self):
        return f'<NodeNote {self.note_type} on node {self.node_id}>'




class IdentifierScheme(db.Model):
    """Admin-managed list of identifier schemes (ARK, Handle, DOI, ISBN, …).

    Mirrors the NodeRelationType pattern: one configurable vocabulary per
    institution, referenced by NodeIdentifier rows.
    """
    __tablename__ = 'identifier_schemes'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('institutions.id', ondelete='CASCADE'))
    name: so.Mapped[str] = so.mapped_column(sa.String(100))          # e.g. "ARK"
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.String(300), nullable=True)

    # Optional URL template for resolving the identifier, {value} is substituted.
    # e.g. "https://n2t.net/{value}" or "https://doi.org/{value}"
    url_template: so.Mapped[Optional[str]] = so.mapped_column(sa.String(500), nullable=True)

    # Optional external service endpoint the "fetch" hook POSTs to, to mint a value.
    generator_url: so.Mapped[Optional[str]] = so.mapped_column(sa.String(500), nullable=True)
    # Auth/content headers sent with the mint request, e.g. {"Authorization": "Bearer …"}
    generator_headers: so.Mapped[Optional[dict]] = so.mapped_column(sa.JSON, nullable=True)
    # JSON body template. Placeholders {node_id} {ref_code} {title} {target_url} {shoulder}
    # are substituted. e.g. {"shoulder": "{shoulder}", "target_url": "{target_url}", "label": "{title}"}
    generator_body_template: so.Mapped[Optional[dict]] = so.mapped_column(sa.JSON, nullable=True)
    # Dot-path to the minted value in the response, e.g. "pid" or "data.identifier"
    generator_response_path: so.Mapped[Optional[str]] = so.mapped_column(sa.String(200), nullable=True)
    # Fixed shoulder/namespace for this scheme (substituted into {shoulder})
    generator_shoulder: so.Mapped[Optional[str]] = so.mapped_column(sa.String(200), nullable=True)
    # Template to build the target_url from a node, {ref_code} {node_id} substituted
    target_url_template: so.Mapped[Optional[str]] = so.mapped_column(sa.String(500), nullable=True)

    is_active: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=True)
    sort_order: so.Mapped[int] = so.mapped_column(sa.Integer, default=0)

    __table_args__ = (
        sa.UniqueConstraint('institution_id', 'name', name='uq_identifier_scheme_per_institution'),
    )

    def __repr__(self):
        return f'<IdentifierScheme {self.name}>'

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'url_template': self.url_template,
            'generator_url': self.generator_url,
            'generator_headers': self.generator_headers or {},
            'generator_body_template': self.generator_body_template or {},
            'generator_response_path': self.generator_response_path,
            'generator_shoulder': self.generator_shoulder,
            'target_url_template': self.target_url_template,
            'has_generator': bool(self.generator_url),
            'is_active': self.is_active,
            'sort_order': self.sort_order,
        }


class NodeIdentifier(db.Model):
    """A single external/persistent identifier attached to a node.

    A node can have many identifiers (one ARK, one DOI, several legacy IDs…).
    Identifier values are globally unique per scheme: no two nodes share an ARK.
    """
    __tablename__ = 'node_identifiers'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    node_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('nodes.id', ondelete='CASCADE'))
    scheme_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('identifier_schemes.id', ondelete='RESTRICT'))
    value: so.Mapped[str] = so.mapped_column(sa.String(500))
    is_primary: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=False)
    note: so.Mapped[Optional[str]] = so.mapped_column(sa.String(300), nullable=True)

    created_at: so.Mapped[datetime] = so.mapped_column(
        default=lambda: datetime.now(timezone.utc))
    created_by_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('users.id', name='fk_node_identifier_created_by'), nullable=True)

    node: so.Mapped['Node'] = so.relationship('Node', back_populates='identifiers')
    scheme: so.Mapped['IdentifierScheme'] = so.relationship('IdentifierScheme')
    created_by: so.Mapped[Optional['User']] = so.relationship('User', foreign_keys=[created_by_id])

    __table_args__ = (
        # Global uniqueness of a value within a scheme
        sa.UniqueConstraint('scheme_id', 'value', name='uq_identifier_value_per_scheme'),
        sa.Index('ix_node_identifiers_node', 'node_id'),
    )

    def __repr__(self):
        return f'<NodeIdentifier {self.value}>'

    def to_dict(self) -> dict:
        url = None
        if self.scheme and self.scheme.url_template:
            url = self.scheme.url_template.replace('{value}', self.value)
        return {
            'id': self.id,
            'node_id': self.node_id,
            'scheme_id': self.scheme_id,
            'scheme_name': self.scheme.name if self.scheme else None,
            'value': self.value,
            'is_primary': self.is_primary,
            'note': self.note,
            'resolve_url': url,
            'created_at': self.created_at.isoformat(),
            'created_by': self.created_by.username if self.created_by else None,
        }
