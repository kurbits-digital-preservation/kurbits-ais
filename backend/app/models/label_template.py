"""
Saved, reusable WYSIWYG label template.

The template stores element positions as FRACTIONS (0..1) of the label area, so
the same JSON renders identically in the browser designer (scaled to pixels) and
in the ReportLab PDF (scaled to millimetres). This shared-fraction contract is
what makes the editor truly WYSIWYG.
"""
from datetime import datetime, timezone
from typing import Optional

import sqlalchemy as sa
import sqlalchemy.orm as so
from app.extensions import db


class LabelTemplate(db.Model):
    __tablename__ = 'label_templates'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('institutions.id', ondelete='CASCADE'))

    name: so.Mapped[str] = so.mapped_column(sa.String(200))
    # Which physical label format this design targets (key into labels.FORMATS)
    format_key: so.Mapped[str] = so.mapped_column(sa.String(60))
    is_default: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=False)

    # Array of element dicts — see labels.render_template for the shape.
    elements: so.Mapped[list] = so.mapped_column(sa.JSON, default=list)

    created_at: so.Mapped[datetime] = so.mapped_column(
        default=lambda: datetime.now(timezone.utc))
    updated_at: so.Mapped[datetime] = so.mapped_column(
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc))
    updated_by_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('users.id', name='fk_label_template_updated_by'), nullable=True)

    __table_args__ = (
        sa.UniqueConstraint('institution_id', 'name', name='uq_label_template_name'),
    )

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'format_key': self.format_key,
            'is_default': self.is_default,
            'elements': self.elements or [],
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
