from __future__ import annotations
from datetime import date, datetime
from typing import Optional, List, TYPE_CHECKING
import sqlalchemy as sa
import sqlalchemy.orm as so
from app.extensions import db

if TYPE_CHECKING:
    from app.models.agent import Agent
    from app.models.user import User
    from app.models.node import Node

# ── Default checklist ─────────────────────────────────────────────────

DEFAULT_CHECKLIST = [
    {'key': 'completeness',  'label': 'Completeness check',         'checked': False, 'note': ''},
    {'key': 'virus_scan',    'label': 'Virus scan',                 'checked': False, 'note': ''},
    {'key': 'format_id',     'label': 'Format identification',      'checked': False, 'note': ''},
    {'key': 'fixity',        'label': 'Fixity verification',        'checked': False, 'note': ''},
    {'key': 'personal_data', 'label': 'Personal data review',       'checked': False, 'note': ''},
    {'key': 'access_review', 'label': 'Access restriction review',  'checked': False, 'note': ''},
    {'key': 'condition',     'label': 'Physical condition check',   'checked': False, 'note': ''},
]

SA_STATUSES      = ['draft', 'active', 'suspended', 'terminated']
DELIVERY_STATUSES = ['expected', 'received', 'in_review', 'accepted', 'rejected', 'partially_accepted']
DELIVERY_METHODS  = ['physical', 'digital_transfer', 'email', 'sftp', 'cloud', 'other']
ACCESSION_STATUSES = ['open', 'closed']


# ── Submission Agreement ──────────────────────────────────────────────

class SubmissionAgreement(db.Model):
    __tablename__ = 'submission_agreements'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('institutions.id', ondelete='CASCADE')
    )
    reference_number: so.Mapped[str] = so.mapped_column(sa.String(100))
    title: so.Mapped[str] = so.mapped_column(sa.String(500))
    agent_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('agents.id', ondelete='SET NULL'), nullable=True
    )
    status: so.Mapped[str] = so.mapped_column(sa.String(20), default='draft')
    agreement_date: so.Mapped[Optional[date]] = so.mapped_column(sa.Date, nullable=True)
    review_date: so.Mapped[Optional[date]] = so.mapped_column(sa.Date, nullable=True)
    delivery_schedule: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    scope_and_content: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    access_conditions: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    appraisal_notes: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    disposition_authority: so.Mapped[Optional[str]] = so.mapped_column(sa.String(500), nullable=True)
    notes: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    created_by_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )
    created_at: so.Mapped[datetime] = so.mapped_column(sa.DateTime, default=datetime.utcnow)
    updated_at: so.Mapped[datetime] = so.mapped_column(
        sa.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    agent: so.Mapped[Optional['Agent']] = so.relationship('Agent', foreign_keys=[agent_id])
    created_by: so.Mapped[Optional['User']] = so.relationship('User', foreign_keys=[created_by_id])
    attachments: so.Mapped[List['SAAttachment']] = so.relationship(
        'SAAttachment', back_populates='agreement', cascade='all, delete-orphan'
    )
    deliveries: so.Mapped[List['Delivery']] = so.relationship(
        'Delivery', back_populates='submission_agreement'
    )

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'reference_number': self.reference_number,
            'title': self.title,
            'status': self.status,
            'agent_id': self.agent_id,
            'agent_name': self.agent.name if self.agent else None,
            'agreement_date': self.agreement_date.isoformat() if self.agreement_date else None,
            'review_date': self.review_date.isoformat() if self.review_date else None,
            'delivery_schedule': self.delivery_schedule,
            'scope_and_content': self.scope_and_content,
            'access_conditions': self.access_conditions,
            'appraisal_notes': self.appraisal_notes,
            'disposition_authority': self.disposition_authority,
            'notes': self.notes,
            'delivery_count': len(self.deliveries),
            'attachment_count': len(self.attachments),
            'attachments': [a.to_dict() for a in self.attachments],
            'created_by': self.created_by.username if self.created_by else None,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
        }


class SAAttachment(db.Model):
    __tablename__ = 'submission_agreement_attachments'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    submission_agreement_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('submission_agreements.id', ondelete='CASCADE')
    )
    filename: so.Mapped[str] = so.mapped_column(sa.String(500))
    original_filename: so.Mapped[str] = so.mapped_column(sa.String(500))
    mime_type: so.Mapped[Optional[str]] = so.mapped_column(sa.String(200), nullable=True)
    file_size: so.Mapped[Optional[int]] = so.mapped_column(sa.Integer, nullable=True)
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.String(500), nullable=True)
    uploaded_by_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )
    uploaded_at: so.Mapped[datetime] = so.mapped_column(sa.DateTime, default=datetime.utcnow)

    agreement: so.Mapped['SubmissionAgreement'] = so.relationship(
        'SubmissionAgreement', back_populates='attachments'
    )
    uploaded_by: so.Mapped[Optional['User']] = so.relationship('User', foreign_keys=[uploaded_by_id])

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'original_filename': self.original_filename,
            'mime_type': self.mime_type,
            'file_size': self.file_size,
            'description': self.description,
            'uploaded_by': self.uploaded_by.username if self.uploaded_by else None,
            'uploaded_at': self.uploaded_at.isoformat(),
        }


# ── Delivery ──────────────────────────────────────────────────────────

class Delivery(db.Model):
    __tablename__ = 'deliveries'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('institutions.id', ondelete='CASCADE')
    )
    submission_agreement_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('submission_agreements.id', ondelete='SET NULL'), nullable=True
    )
    reference_number: so.Mapped[str] = so.mapped_column(sa.String(100))
    title: so.Mapped[str] = so.mapped_column(sa.String(500))
    status: so.Mapped[str] = so.mapped_column(sa.String(30), default='expected')
    delivery_method: so.Mapped[Optional[str]] = so.mapped_column(sa.String(50), nullable=True)
    delivery_date: so.Mapped[Optional[date]] = so.mapped_column(sa.Date, nullable=True)
    received_at: so.Mapped[Optional[datetime]] = so.mapped_column(sa.DateTime, nullable=True)
    received_by_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    item_count: so.Mapped[Optional[int]] = so.mapped_column(sa.Integer, nullable=True)
    physical_extent: so.Mapped[Optional[str]] = so.mapped_column(sa.String(300), nullable=True)
    size_bytes: so.Mapped[Optional[int]] = so.mapped_column(sa.BigInteger, nullable=True)
    checklist: so.Mapped[Optional[list]] = so.mapped_column(sa.JSON, nullable=True)
    notes: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    created_by_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )
    created_at: so.Mapped[datetime] = so.mapped_column(sa.DateTime, default=datetime.utcnow)
    updated_at: so.Mapped[datetime] = so.mapped_column(
        sa.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    submission_agreement: so.Mapped[Optional['SubmissionAgreement']] = so.relationship(
        'SubmissionAgreement', back_populates='deliveries'
    )
    received_by: so.Mapped[Optional['User']] = so.relationship('User', foreign_keys=[received_by_id])
    created_by: so.Mapped[Optional['User']] = so.relationship('User', foreign_keys=[created_by_id])
    accessions: so.Mapped[List['Accession']] = so.relationship('Accession', back_populates='delivery')

    @property
    def checklist_progress(self) -> dict:
        items = self.checklist or DEFAULT_CHECKLIST
        done = sum(1 for i in items if i.get('checked'))
        return {'done': done, 'total': len(items)}

    def to_dict(self) -> dict:
        progress = self.checklist_progress
        return {
            'id': self.id,
            'reference_number': self.reference_number,
            'title': self.title,
            'status': self.status,
            'submission_agreement_id': self.submission_agreement_id,
            'submission_agreement_ref': self.submission_agreement.reference_number if self.submission_agreement else None,
            'delivery_method': self.delivery_method,
            'delivery_date': self.delivery_date.isoformat() if self.delivery_date else None,
            'received_at': self.received_at.isoformat() if self.received_at else None,
            'received_by': self.received_by.username if self.received_by else None,
            'description': self.description,
            'item_count': self.item_count,
            'physical_extent': self.physical_extent,
            'size_bytes': self.size_bytes,
            'checklist': self.checklist or DEFAULT_CHECKLIST,
            'checklist_done': progress['done'],
            'checklist_total': progress['total'],
            'notes': self.notes,
            'accession_count': len(self.accessions),
            'created_by': self.created_by.username if self.created_by else None,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
        }


# ── Accession ─────────────────────────────────────────────────────────

accession_nodes = sa.Table(
    'accession_nodes',
    db.Model.metadata,
    sa.Column('accession_id', sa.Integer,
              sa.ForeignKey('accessions.id', ondelete='CASCADE'), primary_key=True),
    sa.Column('node_id', sa.Integer,
              sa.ForeignKey('nodes.id', ondelete='CASCADE'), primary_key=True),
)


class Accession(db.Model):
    __tablename__ = 'accessions'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('institutions.id', ondelete='CASCADE')
    )
    delivery_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('deliveries.id', ondelete='SET NULL'), nullable=True
    )
    submission_agreement_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('submission_agreements.id', ondelete='SET NULL'), nullable=True
    )
    accession_number: so.Mapped[str] = so.mapped_column(sa.String(100))
    title: so.Mapped[str] = so.mapped_column(sa.String(500))
    status: so.Mapped[str] = so.mapped_column(sa.String(20), default='open')
    date_received: so.Mapped[Optional[date]] = so.mapped_column(sa.Date, nullable=True)
    date_accessioned: so.Mapped[Optional[date]] = so.mapped_column(sa.Date, nullable=True)
    creator_agent_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('agents.id', ondelete='SET NULL'), nullable=True
    )
    extent: so.Mapped[Optional[str]] = so.mapped_column(sa.String(300), nullable=True)
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    appraisal_decision: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    disposition_notes: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    access_restrictions: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    processing_notes: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    accessioned_by_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )
    created_by_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )
    created_at: so.Mapped[datetime] = so.mapped_column(sa.DateTime, default=datetime.utcnow)
    updated_at: so.Mapped[datetime] = so.mapped_column(
        sa.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    delivery: so.Mapped[Optional['Delivery']] = so.relationship('Delivery', back_populates='accessions')
    creator_agent: so.Mapped[Optional['Agent']] = so.relationship('Agent', foreign_keys=[creator_agent_id])
    accessioned_by: so.Mapped[Optional['User']] = so.relationship('User', foreign_keys=[accessioned_by_id])
    created_by: so.Mapped[Optional['User']] = so.relationship('User', foreign_keys=[created_by_id])
    nodes: so.Mapped[List['Node']] = so.relationship(
        'Node', secondary=accession_nodes, lazy='dynamic'
    )

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'accession_number': self.accession_number,
            'title': self.title,
            'status': self.status,
            'delivery_id': self.delivery_id,
            'delivery_ref': self.delivery.reference_number if self.delivery else None,
            'submission_agreement_id': self.submission_agreement_id,
            'creator_agent_id': self.creator_agent_id,
            'creator_agent_name': self.creator_agent.name if self.creator_agent else None,
            'date_received': self.date_received.isoformat() if self.date_received else None,
            'date_accessioned': self.date_accessioned.isoformat() if self.date_accessioned else None,
            'extent': self.extent,
            'description': self.description,
            'appraisal_decision': self.appraisal_decision,
            'disposition_notes': self.disposition_notes,
            'access_restrictions': self.access_restrictions,
            'processing_notes': self.processing_notes,
            'node_count': self.nodes.count(),
            'accessioned_by': self.accessioned_by.username if self.accessioned_by else None,
            'created_by': self.created_by.username if self.created_by else None,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
        }


# ── Delivery checklist template ───────────────────────────────────────

class DeliveryChecklistTemplate(db.Model):
    __tablename__ = 'delivery_checklist_templates'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('institutions.id', ondelete='CASCADE')
    )
    name: so.Mapped[str] = so.mapped_column(sa.String(200))
    delivery_method: so.Mapped[Optional[str]] = so.mapped_column(sa.String(50), nullable=True)
    is_default: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=False)
    items: so.Mapped[list] = so.mapped_column(sa.JSON, default=list)
    sort_order: so.Mapped[int] = so.mapped_column(sa.Integer, default=0)
    created_at: so.Mapped[datetime] = so.mapped_column(sa.DateTime, default=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'delivery_method': self.delivery_method,
            'is_default': self.is_default,
            'items': self.items or [],
            'sort_order': self.sort_order,
        }