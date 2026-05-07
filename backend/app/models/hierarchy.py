from datetime import datetime, timezone
from typing import Optional, List
from enum import Enum
import sqlalchemy as sa
import sqlalchemy.orm as so
from app.extensions import db


class HierarchyEntityType(str, Enum):
    RESOURCE = 'resource'
    LOCATION = 'location'
    CLASSIFICATION = 'classification'


hierarchy_level_relationships = sa.Table(
    'hierarchy_level_relationships',
    db.Model.metadata,
    sa.Column('parent_id', sa.Integer, sa.ForeignKey('hierarchy_levels.id', ondelete='CASCADE'), primary_key=True),
    sa.Column('child_id', sa.Integer, sa.ForeignKey('hierarchy_levels.id', ondelete='CASCADE'), primary_key=True),
    sa.CheckConstraint('parent_id != child_id', name='no_self_reference_level'),
)


class HierarchyType(db.Model):
    __tablename__ = 'hierarchy_types'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('institutions.id', ondelete='CASCADE'))
    name: so.Mapped[str] = so.mapped_column(sa.String(100))
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.String(300), nullable=True)
    entity_type: so.Mapped[HierarchyEntityType] = so.mapped_column(
        sa.Enum(HierarchyEntityType), nullable=False, default=HierarchyEntityType.RESOURCE
    )
    is_default: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=False)
    created_at: so.Mapped[datetime] = so.mapped_column(default=lambda: datetime.now(timezone.utc))

    institution: so.Mapped['Institution'] = so.relationship('Institution', back_populates='hierarchy_types')
    levels: so.Mapped[List['HierarchyLevel']] = so.relationship(
        'HierarchyLevel',
        back_populates='hierarchy_type',
        cascade='all, delete-orphan',
        order_by='HierarchyLevel.sort_order'
    )

    __table_args__ = (
        sa.UniqueConstraint('institution_id', 'name', name='uq_hierarchy_type_per_institution'),
    )

    def __repr__(self):
        return f'<HierarchyType {self.name}>'

    def get_root_levels(self) -> List['HierarchyLevel']:
        """Levels that have no allowed parents — valid at the top of a tree."""
        return db.session.execute(
            sa.select(HierarchyLevel).where(
                HierarchyLevel.hierarchy_type_id == self.id,
                ~HierarchyLevel.id.in_(
                    sa.select(hierarchy_level_relationships.c.child_id).distinct()
                )
            )
        ).scalars().all()

    def get_valid_child_levels(self, parent_level_name: Optional[str] = None) -> List['HierarchyLevel']:
        if parent_level_name is None:
            return self.get_root_levels()

        parent_level = db.session.execute(
            sa.select(HierarchyLevel).where(
                HierarchyLevel.hierarchy_type_id == self.id,
                sa.func.lower(HierarchyLevel.name) == parent_level_name.lower()
            )
        ).scalar_one_or_none()

        return list(parent_level.allowed_children) if parent_level else []


class HierarchyLevel(db.Model):
    __tablename__ = 'hierarchy_levels'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    hierarchy_type_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('hierarchy_types.id', ondelete='CASCADE')
    )
    name: so.Mapped[str] = so.mapped_column(sa.String(100))
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.String(300), nullable=True)
    sort_order: so.Mapped[int] = so.mapped_column(sa.Integer, default=0)
    can_have_location: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=False)
    is_object_level: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=False)

    metadata_schema: so.Mapped[Optional[dict]] = so.mapped_column(sa.JSON, nullable=True, default=dict)

    created_at: so.Mapped[datetime] = so.mapped_column(default=lambda: datetime.now(timezone.utc))

    hierarchy_type: so.Mapped['HierarchyType'] = so.relationship('HierarchyType', back_populates='levels')

    allowed_parents: so.Mapped[List['HierarchyLevel']] = so.relationship(
        'HierarchyLevel',
        secondary=hierarchy_level_relationships,
        primaryjoin='HierarchyLevel.id==hierarchy_level_relationships.c.child_id',
        secondaryjoin='HierarchyLevel.id==hierarchy_level_relationships.c.parent_id',
        backref=db.backref('allowed_children', lazy='dynamic')
    )

    __table_args__ = (
        sa.UniqueConstraint('hierarchy_type_id', 'name', name='uq_level_name_per_type'),
    )

    def __repr__(self):
        return f'<HierarchyLevel {self.name}>'

    def get_metadata_fields(self) -> List[dict]:
        if not self.metadata_schema or not isinstance(self.metadata_schema, dict):
            return []
        return self.metadata_schema.get('fields', [])

    def validate_schema(self) -> bool:
        if not self.metadata_schema:
            return True
        required_keys = {'name', 'label', 'type'}
        try:
            fields = self.metadata_schema.get('fields', [])
            return all(
                isinstance(f, dict) and required_keys.issubset(f.keys())
                for f in fields
            )
        except Exception:
            return False

    @property
    def effective_can_have_location(self) -> bool:
        if self.hierarchy_type.entity_type != HierarchyEntityType.RESOURCE:
            return False
        return self.can_have_location

    @property
    def effective_is_object_level(self) -> bool:
        if self.hierarchy_type.entity_type != HierarchyEntityType.RESOURCE:
            return False
        return self.is_object_level
