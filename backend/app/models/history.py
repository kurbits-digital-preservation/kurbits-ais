from __future__ import annotations
from datetime import datetime
import sqlalchemy as sa
import sqlalchemy.orm as so
from app.extensions import db


class RecentItem(db.Model):
    __tablename__ = 'recent_items'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    user_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    institution_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('institutions.id', ondelete='CASCADE'), nullable=False)
    entity_type: so.Mapped[str] = so.mapped_column(sa.String(20), nullable=False)  # 'node' | 'agent'
    entity_id: so.Mapped[int] = so.mapped_column(sa.Integer, nullable=False)
    title: so.Mapped[str] = so.mapped_column(sa.String(500), nullable=False)
    subtitle: so.Mapped[str | None] = so.mapped_column(sa.String(200), nullable=True)  # ref_code or agent_type
    viewed_at: so.Mapped[datetime] = so.mapped_column(
        sa.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        sa.UniqueConstraint('user_id', 'institution_id', 'entity_type', 'entity_id',
                            name='uq_recent_item_user_entity'),
    )


class Bookmark(db.Model):
    __tablename__ = 'bookmarks'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    user_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    institution_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('institutions.id', ondelete='CASCADE'), nullable=False)
    entity_type: so.Mapped[str] = so.mapped_column(sa.String(20), nullable=False)
    entity_id: so.Mapped[int] = so.mapped_column(sa.Integer, nullable=False)
    title: so.Mapped[str] = so.mapped_column(sa.String(500), nullable=False)
    subtitle: so.Mapped[str | None] = so.mapped_column(sa.String(200), nullable=True)
    created_at: so.Mapped[datetime] = so.mapped_column(
        sa.DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        sa.UniqueConstraint('user_id', 'institution_id', 'entity_type', 'entity_id',
                            name='uq_bookmark_user_entity'),
    )