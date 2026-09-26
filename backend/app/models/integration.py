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
    entity_type: so.Mapped[str] = so.mapped_column(sa.String(50))  # 'agent', 'resource', 'classification'

    # e.g. https://api.example.com
    base_url: so.Mapped[str] = so.mapped_column(sa.String(500))

    # e.g. search-person?query={query}  — {query} is replaced at search time
    search_path: so.Mapped[str] = so.mapped_column(sa.String(500))

    # JSON object: {"Authorization": "Bearer secret", "X-Api-Key": "abc"}
    headers: so.Mapped[Optional[dict]] = so.mapped_column(sa.JSON, nullable=True)

    # Dot-path into the response to get the results array, e.g. "persons"
    # Supports one level of nesting: "results.items"
    result_path: so.Mapped[str] = so.mapped_column(sa.String(200), default='')

    # JSON object mapping agent fields → dot-paths in each result item
    # e.g. {"name": "name_full", "identifier": "acc", "description": "aff_name_en"}
    field_mappings: so.Mapped[Optional[dict]] = so.mapped_column(sa.JSON, nullable=True)

    is_active: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=True, server_default='1')

    __table_args__ = (
        sa.UniqueConstraint('institution_id', 'name', name='uq_integration_name_per_institution'),
    )

    def __repr__(self):
        return f'<ExternalIntegration {self.name}>'