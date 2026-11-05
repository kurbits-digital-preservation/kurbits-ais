from __future__ import annotations
from typing import Optional
import sqlalchemy as sa
import sqlalchemy.orm as so
from app.extensions import db


class ExternalIntegration(db.Model):
    __tablename__ = 'external_integrations'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('institutions.id', ondelete='CASCADE')
    )
    name: so.Mapped[str] = so.mapped_column(sa.String(200))

    # 'agent' | 'metadata' → configured lookup below
    # 'source'             → plugin-backed, configured through `config`
    entity_type: so.Mapped[str] = so.mapped_column(sa.String(50))

    # ─── Plugin-backed sources ────────────────────────────────────────
    plugin: so.Mapped[Optional[str]] = so.mapped_column(sa.String(50), nullable=True)
    config: so.Mapped[Optional[dict]] = so.mapped_column(sa.JSON, nullable=True)

    # ─── Configured lookups (agent / metadata) ────────────────────────
    base_url: so.Mapped[str] = so.mapped_column(sa.String(500))
    search_path: so.Mapped[str] = so.mapped_column(sa.String(500))
    headers: so.Mapped[Optional[dict]] = so.mapped_column(sa.JSON, nullable=True)
    result_path: so.Mapped[str] = so.mapped_column(sa.String(200), default='')
    field_mappings: so.Mapped[Optional[dict]] = so.mapped_column(sa.JSON, nullable=True)

    is_active: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=True, server_default='1')

    __table_args__ = (
        sa.UniqueConstraint('institution_id', 'name', name='uq_integration_name_per_institution'),
    )

    def __repr__(self):
        return f'<ExternalIntegration {self.name}>'