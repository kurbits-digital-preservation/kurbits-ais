"""
Per-institution Whisper transcription configuration.

This is the stripped-down remnant of the former AI configuration model.
LLM provider support (Anthropic/OpenAI/Ollama/Azure) has been removed —
only the connection to the Whisper transcription microservice remains.
"""
from __future__ import annotations
from datetime import datetime, timezone

from app.extensions import db
from app.utils.crypto import encrypt_api_key, decrypt_api_key


class InstitutionAIConfig(db.Model):
    __tablename__ = 'institution_ai_config'

    id             = db.Column(db.Integer, primary_key=True)
    institution_id = db.Column(
        db.Integer,
        db.ForeignKey('institutions.id', ondelete='CASCADE'),
        nullable=False,
        unique=True,
        index=True,
    )

    # ── Whisper service connection ────────────────────────────────────
    whisper_service_url    = db.Column(db.String(512), nullable=False, default='')
    _whisper_key_encrypted = db.Column('whisper_api_key', db.Text, nullable=False, default='')
    whisper_model          = db.Column(db.String(256), nullable=False, default='')

    # ── Audit ─────────────────────────────────────────────────────────
    updated_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at    = db.Column(
        db.DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    institution = db.relationship('Institution', backref=db.backref(
        'ai_config', uselist=False, cascade='all, delete-orphan'
    ))

    # ── Encrypted API key accessors ───────────────────────────────────
    @property
    def whisper_api_key(self) -> str:
        return decrypt_api_key(self._whisper_key_encrypted)

    @whisper_api_key.setter
    def whisper_api_key(self, value: str) -> None:
        self._whisper_key_encrypted = encrypt_api_key(value or '')

    @property
    def has_whisper_api_key(self) -> bool:
        return bool(self._whisper_key_encrypted)

    def __repr__(self) -> str:
        return f'<InstitutionAIConfig inst={self.institution_id} whisper={bool(self.whisper_service_url)}>'
