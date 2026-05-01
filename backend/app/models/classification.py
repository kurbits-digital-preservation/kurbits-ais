from datetime import datetime, timezone, date
from typing import Optional, List, Dict
import sqlalchemy as sa
import sqlalchemy.orm as so
from app.extensions import db


classification_node_association = sa.Table(
    'classification_node_association',
    db.Model.metadata,
    sa.Column('classification_id', sa.Integer, sa.ForeignKey('classifications.id', ondelete='CASCADE'), primary_key=True),
    sa.Column('node_id', sa.Integer, sa.ForeignKey('nodes.id', ondelete='CASCADE'), primary_key=True),
)


class Classification(db.Model):
    __tablename__ = 'classifications'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('institutions.id', ondelete='CASCADE'))

    name: so.Mapped[str] = so.mapped_column(sa.String(300))
    code: so.Mapped[str] = so.mapped_column(sa.String(100))          # unique within parent
    level_name: so.Mapped[str] = so.mapped_column(sa.String(100))    # e.g. Class, Division, Section
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    scope_note: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)

    # Validity period — classifications can be retired
    valid_from: so.Mapped[Optional[date]] = so.mapped_column(sa.Date, nullable=True)
    valid_to: so.Mapped[Optional[date]] = so.mapped_column(sa.Date, nullable=True)

    # Publishing and versioning
    status: so.Mapped[str] = so.mapped_column(sa.String(20), default='draft', server_default='draft')
    # draft | published | retired
    version: so.Mapped[int] = so.mapped_column(sa.Integer, default=1, server_default='1')
    version_label: so.Mapped[Optional[str]] = so.mapped_column(sa.String(50), nullable=True)

    # Optional Mermaid diagram (process flows, org charts, etc.)
    diagram: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)

    hierarchy_type_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('hierarchy_types.id', name='fk_classification_hierarchy_type')
    )
    hierarchy_type: so.Mapped['HierarchyType'] = so.relationship('HierarchyType')

    parent_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.Integer,
        sa.ForeignKey('classifications.id', ondelete='CASCADE', name='fk_classification_parent'),
        nullable=True
    )
    parent: so.Mapped[Optional['Classification']] = so.relationship(
        'Classification', remote_side='Classification.id',
        backref=so.backref('children', lazy='dynamic', cascade='all, delete-orphan', passive_deletes=True)
    )

    created_at: so.Mapped[datetime] = so.mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: so.Mapped[datetime] = so.mapped_column(
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc)
    )
    created_by_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('users.id', name='fk_classification_created_by'), nullable=True
    )

    institution: so.Mapped['Institution'] = so.relationship('Institution', back_populates='classifications')
    created_by: so.Mapped[Optional['User']] = so.relationship('User', foreign_keys=[created_by_id])

    nodes: so.Mapped[List['Node']] = so.relationship(
        'Node',
        secondary=classification_node_association,
        backref=so.backref('classifications', lazy='dynamic'),
        lazy='dynamic'
    )
    changes: so.Mapped[List['ClassificationChange']] = so.relationship(
        'ClassificationChange', back_populates='classification', cascade='all, delete-orphan',
        order_by='ClassificationChange.created_at.desc()'
    )

    __table_args__ = (
        sa.UniqueConstraint('code', 'parent_id', 'institution_id', name='uq_classification_code_per_parent'),
    )

    def __repr__(self):
        return f'<Classification {self.code}: {self.name}>'

    @property
    def is_active(self) -> bool:
        today = date.today()
        if self.valid_from and today < self.valid_from:
            return False
        if self.valid_to and today > self.valid_to:
            return False
        return True

    def get_full_code(self) -> str:
        parts = []
        current = self
        while current is not None:
            parts.append(current.code)
            current = current.parent
        return '.'.join(reversed(parts))

    def get_breadcrumb(self) -> List[dict]:
        ancestors = []
        current = self
        while current.parent is not None:
            ancestors.append(current.parent)
            current = current.parent
        return [
            {'id': n.id, 'name': n.name, 'code': n.code}
            for n in reversed(ancestors)
        ] + [{'id': self.id, 'name': self.name, 'code': self.code}]

    def is_descendant_of(self, other: 'Classification') -> bool:
        ancestor = self.parent
        while ancestor:
            if ancestor.id == other.id:
                return True
            ancestor = ancestor.parent
        return False

    def validate_hierarchy(self) -> bool:
        from app.models.hierarchy import HierarchyLevel
        current_level = db.session.execute(
            sa.select(HierarchyLevel).where(
                HierarchyLevel.hierarchy_type_id == self.hierarchy_type_id,
                sa.func.lower(HierarchyLevel.name) == self.level_name.lower()
            )
        ).scalar_one_or_none()

        if not current_level:
            return False

        if self.parent is None:
            return len(current_level.allowed_parents) == 0

        parent_level = db.session.execute(
            sa.select(HierarchyLevel).where(
                HierarchyLevel.hierarchy_type_id == self.hierarchy_type_id,
                sa.func.lower(HierarchyLevel.name) == self.parent.level_name.lower()
            )
        ).scalar_one_or_none()

        return parent_level is not None and parent_level in current_level.allowed_parents

    def publish(self, user_id: int) -> None:
        """Publish this classification, incrementing version if already published."""
        before = self.to_dict()
        if self.status == 'published':
            self.version += 1
        self.status = 'published'
        self.record_change(
            'publish',
            f'Published as version {self.version_label or self.version}',
            created_by_id=user_id,
            before_data=before,
            after_data=self.to_dict(),
        )

    def retire(self, user_id: int) -> None:
        before = self.to_dict()
        self.status = 'retired'
        self.record_change(
            'retire', 'Retired',
            created_by_id=user_id,
            before_data=before,
            after_data=self.to_dict(),
        )

    def to_dict(self) -> Dict:
        return {
            'name': self.name,
            'code': self.code,
            'level_name': self.level_name,
            'description': self.description,
            'scope_note': self.scope_note,
            'valid_from': self.valid_from.isoformat() if self.valid_from else None,
            'valid_to': self.valid_to.isoformat() if self.valid_to else None,
            'parent_id': self.parent_id,
            'hierarchy_type_id': self.hierarchy_type_id,
            'status': self.status,
            'version': self.version,
            'version_label': self.version_label,
            'diagram': self.diagram,
        }

    def record_change(self, change_type: str, description: str,
                      created_by_id: int, before_data: Dict, after_data: Dict) -> 'ClassificationChange':
        change = ClassificationChange(
            classification_id=self.id,
            change_type=change_type,
            description=description,
            created_by_id=created_by_id,
            before_data=before_data,
            after_data=after_data,
        )
        db.session.add(change)
        return change


class ClassificationChange(db.Model):
    __tablename__ = 'classification_changes'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    classification_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('classifications.id', ondelete='CASCADE')
    )
    change_type: so.Mapped[str] = so.mapped_column(sa.String(50))
    description: so.Mapped[str] = so.mapped_column(sa.Text)
    before_data: so.Mapped[dict] = so.mapped_column(sa.JSON)
    after_data: so.Mapped[dict] = so.mapped_column(sa.JSON)
    created_at: so.Mapped[datetime] = so.mapped_column(default=lambda: datetime.now(timezone.utc))
    created_by_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('users.id'))

    classification: so.Mapped['Classification'] = so.relationship('Classification', back_populates='changes')
    created_by: so.Mapped['User'] = so.relationship('User')

    def __repr__(self):
        return f'<ClassificationChange {self.change_type} on classification {self.classification_id}>'