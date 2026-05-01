from datetime import datetime, date, timezone
from typing import Optional, List
import sqlalchemy as sa
import sqlalchemy.orm as so
from app.extensions import db


location_node_association = sa.Table(
    'location_node_association',
    db.Model.metadata,
    sa.Column('location_id', sa.Integer, sa.ForeignKey('locations.id', ondelete='CASCADE'), primary_key=True),
    sa.Column('node_id', sa.Integer, sa.ForeignKey('nodes.id', ondelete='CASCADE'), primary_key=True),
)


class Location(db.Model):
    __tablename__ = 'locations'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('institutions.id', ondelete='CASCADE'))

    name: so.Mapped[str] = so.mapped_column(sa.String(200))
    code: so.Mapped[str] = so.mapped_column(sa.String(100))         # unique within parent
    level_name: so.Mapped[str] = so.mapped_column(sa.String(100))   # e.g. Building, Room, Shelf
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.String(500), nullable=True)
    can_store_nodes: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=False)
    capacity: so.Mapped[Optional[int]] = so.mapped_column(sa.Integer, nullable=True)
    location_type: so.Mapped[Optional[str]] = so.mapped_column(sa.String(30), nullable=True)
    # building | room | gallery | storage | cabinet | shelf | case | drawer | external
    is_public: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=False)
    address: so.Mapped[Optional[str]] = so.mapped_column(sa.String(500), nullable=True)

    hierarchy_type_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('hierarchy_types.id', name='fk_location_hierarchy_type')
    )
    hierarchy_type: so.Mapped['HierarchyType'] = so.relationship('HierarchyType')

    parent_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.Integer,
        sa.ForeignKey('locations.id', ondelete='CASCADE', name='fk_location_parent'),
        nullable=True
    )
    parent: so.Mapped[Optional['Location']] = so.relationship(
        'Location', remote_side='Location.id',
        backref=so.backref('children', lazy='dynamic', cascade='all, delete-orphan', passive_deletes=True)
    )

    created_at: so.Mapped[datetime] = so.mapped_column(default=lambda: datetime.now(timezone.utc))

    institution: so.Mapped['Institution'] = so.relationship('Institution', back_populates='locations')

    stored_nodes: so.Mapped[List['Node']] = so.relationship(
        'Node',
        secondary=location_node_association,
        backref=so.backref('storage_locations', lazy='dynamic'),
        lazy='dynamic'
    )
    movements: so.Mapped[List['LocationMovement']] = so.relationship(
        'LocationMovement', back_populates='location',
        foreign_keys='LocationMovement.location_id',
        cascade='save-update, merge',
    )

    __table_args__ = (
        sa.UniqueConstraint('code', 'parent_id', 'institution_id', name='uq_location_code_per_parent'),
    )

    def __repr__(self):
        return f'<Location {self.get_full_path()}>'

    def get_full_path(self) -> str:
        parts = []
        current = self
        while current is not None:
            parts.append(current.name)
            current = current.parent
        return ' / '.join(reversed(parts))

    def get_available_capacity(self) -> Optional[int]:
        if not self.can_store_nodes or self.capacity is None:
            return None
        return self.capacity - self.stored_nodes.count()

    def is_descendant_of(self, other: 'Location') -> bool:
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

    def get_storage_tree(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'code': self.code,
            'level_name': self.level_name,
            'can_store_nodes': self.can_store_nodes,
            'stored_count': self.stored_nodes.count() if self.can_store_nodes else 0,
            'available_capacity': self.get_available_capacity(),
            'children': [c.get_storage_tree() for c in self.children],
        }


class LocationMovement(db.Model):
    """Records every time a node moves to/from a location (check-in / check-out)."""
    __tablename__ = 'location_movements'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    node_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('nodes.id', ondelete='CASCADE'))
    location_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('locations.id', ondelete='CASCADE'))
    movement_type: so.Mapped[str] = so.mapped_column(sa.String(50))
    # in_storage | on_display | on_loan_out | on_loan_in | in_conservation | missing | transfer
    notes: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    condition_note: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    expected_return: so.Mapped[Optional[date]] = so.mapped_column(sa.Date, nullable=True)
    from_location_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('locations.id', ondelete='SET NULL', name='fk_lm_from_location'), nullable=True)
    moved_at: so.Mapped[datetime] = so.mapped_column(default=lambda: datetime.now(timezone.utc))
    moved_by_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('users.id'))

    node: so.Mapped['Node'] = so.relationship('Node', backref=so.backref('location_movements', lazy='dynamic'))
    location: so.Mapped['Location'] = so.relationship('Location', back_populates='movements', foreign_keys=[location_id])
    from_location: so.Mapped[Optional['Location']] = so.relationship('Location', foreign_keys=[from_location_id])
    moved_by: so.Mapped['User'] = so.relationship('User')

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'node_id': self.node_id,
            'location_id': self.location_id,
            'location_name': self.location.name if self.location else None,
            'location_path': self.location.get_full_path() if self.location else None,
            'from_location_id': self.from_location_id,
            'from_location_name': self.from_location.name if self.from_location else None,
            'movement_type': self.movement_type,
            'notes': self.notes,
            'condition_note': self.condition_note,
            'expected_return': self.expected_return.isoformat() if self.expected_return else None,
            'moved_at': self.moved_at.isoformat(),
            'moved_by': self.moved_by.username if self.moved_by else None,
        }

    def __repr__(self):
        return f'<LocationMovement {self.movement_type} node={self.node_id}>'