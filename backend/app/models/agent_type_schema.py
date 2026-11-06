from __future__ import annotations

from typing import Optional

import sqlalchemy as sa
import sqlalchemy.orm as so

from app.extensions import db
from app.models.agent import AgentType


class AgentTypeSchema(db.Model):
    __tablename__ = 'agent_type_schemas'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('institutions.id', ondelete='CASCADE')
    )
    agent_type: so.Mapped[str] = so.mapped_column(sa.String(20))
    metadata_schema: so.Mapped[Optional[dict]] = so.mapped_column(sa.JSON, nullable=True)

    __table_args__ = (
        sa.UniqueConstraint('institution_id', 'agent_type', name='uq_agent_type_schema'),
    )

    def get_metadata_fields(self) -> list[dict]:
        schema = self.metadata_schema if isinstance(self.metadata_schema, dict) else {}
        fields = schema.get('fields')
        return fields if isinstance(fields, list) else []

    @staticmethod
    def type_value(agent_type) -> str:
        return agent_type.value if isinstance(agent_type, AgentType) else str(agent_type)

    @classmethod
    def for_type(cls, institution_id: int, agent_type) -> Optional['AgentTypeSchema']:
        return cls.query.filter_by(
            institution_id=institution_id,
            agent_type=cls.type_value(agent_type),
        ).first()

    @classmethod
    def fields_for(cls, institution_id: int, agent_type) -> list[dict]:
        schema = cls.for_type(institution_id, agent_type)
        return schema.get_metadata_fields() if schema else []

    def __repr__(self):
        return f'<AgentTypeSchema {self.institution_id}:{self.agent_type}>'