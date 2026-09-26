from datetime import datetime, timezone
from typing import Optional, List
import sqlalchemy as sa
import sqlalchemy.orm as so
from app.extensions import db


class RepresentationType(db.Model):
    """Institution-configurable vocabulary for representation types.
    e.g. 'Preservation Master', 'Access Copy', 'Thumbnail', 'Derivative'
    """
    __tablename__ = 'representation_types'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('institutions.id', ondelete='CASCADE')
    )
    name: so.Mapped[str] = so.mapped_column(sa.String(100))
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.String(300), nullable=True)
    sort_order: so.Mapped[int] = so.mapped_column(sa.Integer, default=0)

    __table_args__ = (
        sa.UniqueConstraint('institution_id', 'name', name='uq_rep_type_per_institution'),
    )

    representations: so.Mapped[List['NodeRepresentation']] = so.relationship(
        'NodeRepresentation', back_populates='rep_type_obj'
    )

    def __repr__(self):
        return f'<RepresentationType {self.name}>'

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'sort_order': self.sort_order,
        }


class NodeRepresentation(db.Model):
    """A PREMIS-style representation of an intellectual entity (object node).
    Groups one or more files (NodeAttachments) under a single representation.
    """
    __tablename__ = 'node_representations'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    node_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('nodes.id', ondelete='CASCADE')
    )
    rep_type_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('representation_types.id', ondelete='RESTRICT')
    )
    label: so.Mapped[Optional[str]] = so.mapped_column(sa.String(200), nullable=True)
    note: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    created_at: so.Mapped[datetime] = so.mapped_column(
        default=lambda: datetime.now(timezone.utc)
    )
    created_by_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )

    node: so.Mapped['Node'] = so.relationship('Node', back_populates='representations')
    rep_type_obj: so.Mapped['RepresentationType'] = so.relationship(
        'RepresentationType', back_populates='representations'
    )
    files: so.Mapped[List['NodeAttachment']] = so.relationship(
        'NodeAttachment', back_populates='representation_obj',
        cascade='all, delete-orphan'
    )
    created_by: so.Mapped[Optional['User']] = so.relationship('User')

    def __repr__(self):
        return f'<NodeRepresentation {self.id} node={self.node_id}>'