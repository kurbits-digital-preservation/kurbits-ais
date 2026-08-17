from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional
import sqlalchemy as sa
import sqlalchemy.orm as so
from app.extensions import db


class InstitutionAIConfig(db.Model):
    __tablename__ = 'institution_ai_configs'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('institutions.id', ondelete='CASCADE'),
        unique=True, nullable=False,
    )

    # Provider: 'anthropic' | 'openai' | 'ollama' | 'azure_openai'
    provider: so.Mapped[str] = so.mapped_column(sa.String(50), nullable=False)

    # Model name — provider-specific, e.g. 'claude-sonnet-4-20250514', 'llama3', 'gpt-4o'
    model: so.Mapped[str] = so.mapped_column(sa.String(200), nullable=False)

    # Base URL — required for Ollama and Azure, optional override for others
    base_url: so.Mapped[Optional[str]] = so.mapped_column(sa.String(500), nullable=True)

    # Add this field to InstitutionAIConfig
    language: so.Mapped[str] = so.mapped_column(sa.String(10), nullable=False, default='en')

    # Encrypted API key — empty string for Ollama (no auth needed)
    _api_key_encrypted: so.Mapped[str] = so.mapped_column(
        'api_key_encrypted', sa.Text, nullable=False, default=''
    )

    # Extra provider-specific options stored as JSON
    # e.g. Azure deployment name, timeout, max_tokens
    options: so.Mapped[Optional[dict]] = so.mapped_column(sa.JSON, nullable=True)

    is_enabled: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=True, nullable=False)

    task_configs: so.Mapped[Optional[dict]] = so.mapped_column(sa.JSON, nullable=True, default=dict)

    created_at: so.Mapped[datetime] = so.mapped_column(
        default=lambda: datetime.now(timezone.utc))
    updated_at: so.Mapped[datetime] = so.mapped_column(
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc))
    updated_by_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('users.id'), nullable=True)

    @property
    def api_key(self) -> str:
        from app.ai.crypto import decrypt_api_key
        return decrypt_api_key(self._api_key_encrypted)

    @api_key.setter
    def api_key(self, plaintext: str) -> None:
        from app.ai.crypto import encrypt_api_key
        self._api_key_encrypted = encrypt_api_key(plaintext)