from __future__ import annotations
from typing import Optional, TYPE_CHECKING
import sqlalchemy as sa
import sqlalchemy.orm as so
from app.extensions import db


class MetadataTemplate(db.Model):
    """
    Reusable metadata field schemas per institution and entity type.
    Can be applied to hierarchy levels to pre-fill the metadata_schema.
    """
    __tablename__ = 'metadata_templates'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('institutions.id', ondelete='CASCADE')
    )
    name: so.Mapped[str] = so.mapped_column(sa.String(200))
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.String(500), nullable=True)
    entity_type: so.Mapped[str] = so.mapped_column(
        sa.String(50), default='resource'
    )  # resource | location | classification
    fields: so.Mapped[dict] = so.mapped_column(sa.JSON, default=list)
    # fields: [{"name": "...", "label": "...", "type": "text|textarea|date|number", "required": bool}]

    __table_args__ = (
        sa.UniqueConstraint('institution_id', 'name', 'entity_type',
                           name='uq_metadata_template_per_institution'),
    )

    def __repr__(self):
        return f'<MetadataTemplate {self.name}>'