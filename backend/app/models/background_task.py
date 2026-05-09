from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Optional
import sqlalchemy as sa
import sqlalchemy.orm as so
from app.extensions import db


class BackgroundTask(db.Model):
    __tablename__ = 'background_tasks'

    id: so.Mapped[str] = so.mapped_column(
        sa.String(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )
    institution_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('institutions.id', ondelete='CASCADE'), nullable=False, index=True
    )
    created_by_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('users.id'), nullable=False
    )

    task_type: so.Mapped[str] = so.mapped_column(sa.String(50), nullable=False)
    # 'ocr', 'whisper', 'reindex_attachment'

    entity_type: so.Mapped[str] = so.mapped_column(sa.String(50), nullable=False)
    # 'node_attachment'
    entity_id: so.Mapped[int] = so.mapped_column(sa.Integer, nullable=False)

    status: so.Mapped[str] = so.mapped_column(
        sa.String(20), nullable=False, default='pending'
    )
    # 'pending' | 'running' | 'done' | 'error'

    progress: so.Mapped[int] = so.mapped_column(sa.Integer, default=0, nullable=False)
    # 0-100

    result: so.Mapped[Optional[dict]] = so.mapped_column(sa.JSON, nullable=True)
    error_message: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)

    created_at: so.Mapped[datetime] = so.mapped_column(
        default=lambda: datetime.now(timezone.utc)
    )
    updated_at: so.Mapped[datetime] = so.mapped_column(
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc)
    )

    created_by: so.Mapped['User'] = so.relationship('User')

    def set_running(self) -> None:
        self.status = 'running'
        self.updated_at = datetime.now(timezone.utc)

    def set_progress(self, pct: int) -> None:
        self.progress = max(0, min(100, pct))
        self.updated_at = datetime.now(timezone.utc)

    def set_done(self, result: dict | None = None) -> None:
        self.status = 'done'
        self.progress = 100
        self.result = result
        self.updated_at = datetime.now(timezone.utc)

    def set_error(self, message: str) -> None:
        self.status = 'error'
        self.error_message = message
        self.updated_at = datetime.now(timezone.utc)