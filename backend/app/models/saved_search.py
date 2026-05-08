from __future__ import annotations
from datetime import datetime
import sqlalchemy as sa
import sqlalchemy.orm as so
from app.extensions import db


class SavedSearch(db.Model):
    __tablename__ = 'saved_searches'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    user_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    institution_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('institutions.id', ondelete='CASCADE'), nullable=False)
    name: so.Mapped[str] = so.mapped_column(sa.String(200), nullable=False)
    params: so.Mapped[dict] = so.mapped_column(sa.JSON, nullable=False)
    created_at: so.Mapped[datetime] = so.mapped_column(sa.DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        sa.UniqueConstraint('user_id', 'institution_id', 'name', name='uq_saved_search_user_name'),
    )