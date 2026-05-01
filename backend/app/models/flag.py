from __future__ import annotations
from datetime import datetime
from typing import Optional, TYPE_CHECKING
import sqlalchemy as sa
import sqlalchemy.orm as so
from app.extensions import db

if TYPE_CHECKING:
    from app.models.node import Node
    from app.models.user import User

FLAG_TYPES = {
    'metadata':      {'label': 'Metadata issue',     'color': '#7c3aed'},
    'conservation':  {'label': 'Conservation',        'color': '#dc2626'},
    'digitisation':  {'label': 'Digitisation needed', 'color': '#d97706'},
    'rights':        {'label': 'Rights unclear',      'color': '#0891b2'},
    'access':        {'label': 'Access review',       'color': '#059669'},
    'duplicate':     {'label': 'Possible duplicate',  'color': '#6b7280'},
    'other':         {'label': 'Other',               'color': '#9ca3af'},
}

SEVERITIES = {
    'low':    {'label': 'Low',    'color': '#6b7280'},
    'medium': {'label': 'Medium', 'color': '#d97706'},
    'high':   {'label': 'High',   'color': '#dc2626'},
}

STATUSES = {
    'open':        {'label': 'Open'},
    'in_progress': {'label': 'In progress'},
    'resolved':    {'label': 'Resolved'},
}


class NodeFlag(db.Model):
    __tablename__ = 'node_flags'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('institutions.id', ondelete='CASCADE')
    )
    node_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('nodes.id', ondelete='CASCADE')
    )
    flag_type: so.Mapped[str] = so.mapped_column(sa.String(50))
    severity: so.Mapped[str] = so.mapped_column(sa.String(20), default='medium')
    status: so.Mapped[str] = so.mapped_column(sa.String(20), default='open')
    title: so.Mapped[str] = so.mapped_column(sa.String(300))
    body: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)

    assigned_to_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )
    created_by_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )
    resolved_by_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )
    created_at: so.Mapped[datetime] = so.mapped_column(
        sa.DateTime, default=datetime.utcnow
    )
    updated_at: so.Mapped[datetime] = so.mapped_column(
        sa.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
    resolved_at: so.Mapped[Optional[datetime]] = so.mapped_column(
        sa.DateTime, nullable=True
    )

    node: so.Mapped['Node'] = so.relationship('Node', back_populates='flags')
    assigned_to: so.Mapped[Optional['User']] = so.relationship(
        'User', foreign_keys=[assigned_to_id]
    )
    created_by: so.Mapped[Optional['User']] = so.relationship(
        'User', foreign_keys=[created_by_id]
    )
    resolved_by: so.Mapped[Optional['User']] = so.relationship(
        'User', foreign_keys=[resolved_by_id]
    )

    def to_dict(self, include_node: bool = False) -> dict:
        d: dict = {
            'id': self.id,
            'node_id': self.node_id,
            'flag_type': self.flag_type,
            'flag_type_label': FLAG_TYPES.get(self.flag_type, {}).get('label', self.flag_type),
            'flag_type_color': FLAG_TYPES.get(self.flag_type, {}).get('color', '#9ca3af'),
            'severity': self.severity,
            'severity_label': SEVERITIES.get(self.severity, {}).get('label', self.severity),
            'severity_color': SEVERITIES.get(self.severity, {}).get('color', '#9ca3af'),
            'status': self.status,
            'status_label': STATUSES.get(self.status, {}).get('label', self.status),
            'title': self.title,
            'body': self.body,
            'assigned_to': self.assigned_to.username if self.assigned_to else None,
            'assigned_to_id': self.assigned_to_id,
            'created_by': self.created_by.username if self.created_by else None,
            'created_by_id': self.created_by_id,
            'resolved_by': self.resolved_by.username if self.resolved_by else None,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'resolved_at': self.resolved_at.isoformat() if self.resolved_at else None,
        }
        if include_node and self.node:
            d['node'] = {
                'id': self.node.id,
                'title': self.node.title,
                'ref_code': self.node.ref_code,
                'level': self.node.level_of_description,
            }
        return d