from datetime import datetime, timezone
from typing import Optional, List, Dict
from enum import Enum
import sqlalchemy as sa
import sqlalchemy.orm as so
from app.extensions import db
from typing import List


class AgentType(str, Enum):
    PERSON = 'person'
    ORGANIZATION = 'organization'
    FAMILY = 'family'
    SOFTWARE = 'software'


agent_node_association = sa.Table(
    'agent_node_association',
    db.Model.metadata,
    sa.Column('agent_id', sa.Integer, sa.ForeignKey('agents.id', ondelete='CASCADE'), primary_key=True),
    sa.Column('node_id', sa.Integer, sa.ForeignKey('nodes.id', ondelete='CASCADE'), primary_key=True),
    sa.Column('relation_type', sa.String(100), nullable=False),  # e.g. 'creator', 'contributor', 'subject'
)

agent_to_agent_association = sa.Table(
    'agent_to_agent_association',
    db.Model.metadata,
    sa.Column('source_agent_id', sa.Integer, sa.ForeignKey('agents.id', ondelete='CASCADE'), primary_key=True),
    sa.Column('target_agent_id', sa.Integer, sa.ForeignKey('agents.id', ondelete='CASCADE'), primary_key=True),
    sa.Column('association_type', sa.String(100), nullable=False),
    sa.CheckConstraint('source_agent_id != target_agent_id', name='no_self_agent_relation'),
)


class AgentRelationType(db.Model):
    """Configurable agent-to-agent relation types per institution."""
    __tablename__ = 'agent_relation_types'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('institutions.id', ondelete='CASCADE'))
    name: so.Mapped[str] = so.mapped_column(sa.String(100))
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.String(300), nullable=True)
    is_symmetric: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=True)
    complementary_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('agent_relation_types.id', name='fk_agent_relation_complementary', use_alter=True),
        nullable=True
    )
    complementary: so.Mapped[Optional['AgentRelationType']] = so.relationship(
        'AgentRelationType',
        foreign_keys=[complementary_id],
        remote_side='AgentRelationType.id',
        post_update=True,
    )

    __table_args__ = (
        sa.UniqueConstraint('institution_id', 'name', name='uq_agent_relation_type_per_institution'),
    )

    def __repr__(self):
        return f'<AgentRelationType {self.name}>'


class AgentNodeRelationType(db.Model):
    """Configurable relation types between agents and nodes per institution."""
    __tablename__ = 'agent_node_relation_types'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('institutions.id', ondelete='CASCADE'))
    name: so.Mapped[str] = so.mapped_column(sa.String(100))
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.String(300), nullable=True)
    is_symmetric: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=True, server_default='1')
    complementary_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('agent_node_relation_types.id', name='fk_agent_node_relation_complementary', use_alter=True),
        nullable=True,
    )
    complementary: so.Mapped[Optional['AgentNodeRelationType']] = so.relationship(
        'AgentNodeRelationType',
        foreign_keys='[AgentNodeRelationType.complementary_id]',
        remote_side='AgentNodeRelationType.id',
        uselist=False,
    )

    __table_args__ = (
        sa.UniqueConstraint('institution_id', 'name', name='uq_agent_node_relation_type_per_institution'),
    )

    def __repr__(self):
        return f'<AgentNodeRelationType {self.name}>'


class Agent(db.Model):
    __tablename__ = 'agents'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('institutions.id', ondelete='CASCADE'))

    name: so.Mapped[str] = so.mapped_column(sa.String(300))
    agent_type: so.Mapped[AgentType] = so.mapped_column(sa.Enum(AgentType), nullable=False)
    authorized_form: so.Mapped[Optional[str]] = so.mapped_column(sa.String(300), nullable=True)
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)

    # Dates of existence
    date_from: so.Mapped[Optional[str]] = so.mapped_column(sa.String(50), nullable=True)   # flexible — could be year only
    date_to: so.Mapped[Optional[str]] = so.mapped_column(sa.String(50), nullable=True)

    # Contact / identity
    identifier: so.Mapped[Optional[str]] = so.mapped_column(sa.String(200), nullable=True)  # external ID, ISNI, VIAF etc.
    website: so.Mapped[Optional[str]] = so.mapped_column(sa.String(300), nullable=True)

    created_at: so.Mapped[datetime] = so.mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: so.Mapped[datetime] = so.mapped_column(
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc)
    )
    created_by_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('users.id', name='fk_agent_created_by'), nullable=True
    )

    institution: so.Mapped['Institution'] = so.relationship('Institution', back_populates='agents')
    created_by: so.Mapped[Optional['User']] = so.relationship('User', foreign_keys=[created_by_id])

    nodes: so.Mapped[List['Node']] = so.relationship(
        'Node',
        secondary=agent_node_association,
        backref=so.backref('agents', lazy='dynamic'),
        lazy='dynamic'
    )

    places: so.Mapped[List['AgentPlace']] = so.relationship(
        'AgentPlace', back_populates='agent',
        cascade='all, delete-orphan', order_by='AgentPlace.sort_order'
    )
    tags: so.Mapped[List['Tag']] = so.relationship(
        'Tag', secondary='agent_tags', back_populates='agents', lazy='dynamic'
    )

    related_agents: so.Mapped[List['Agent']] = so.relationship(
        'Agent',
        secondary=agent_to_agent_association,
        primaryjoin='Agent.id == agent_to_agent_association.c.source_agent_id',
        secondaryjoin='Agent.id == agent_to_agent_association.c.target_agent_id',
        backref=so.backref('related_agents_backref', lazy='dynamic'),
        lazy='dynamic'
    )

    notes: so.Mapped[List['AgentNote']] = so.relationship(
        'AgentNote', back_populates='agent', cascade='all, delete-orphan'
    )

    def __repr__(self):
        return f'<Agent {self.name} ({self.agent_type.value})>'

    def add_relation(self, other: 'Agent', relation_type: str) -> None:
        if other.id == self.id:
            raise ValueError('Cannot relate an agent to itself')

        rel = AgentRelationType.query.filter_by(
            institution_id=self.institution_id, name=relation_type
        ).first()
        if not rel:
            raise ValueError(f'Unknown relation type: {relation_type}')

        self.remove_relation(other)

        db.session.execute(
            agent_to_agent_association.insert().values(
                source_agent_id=self.id,
                target_agent_id=other.id,
                association_type=relation_type,
            )
        )

        if not rel.is_symmetric:
            complement_type = rel.complementary.name if rel.complementary else relation_type
            db.session.execute(
                agent_to_agent_association.insert().values(
                    source_agent_id=other.id,
                    target_agent_id=self.id,
                    association_type=complement_type,
                )
            )

    def remove_relation(self, other: 'Agent') -> None:
        db.session.execute(
            agent_to_agent_association.delete().where(
                sa.or_(
                    sa.and_(
                        agent_to_agent_association.c.source_agent_id == self.id,
                        agent_to_agent_association.c.target_agent_id == other.id,
                    ),
                    sa.and_(
                        agent_to_agent_association.c.source_agent_id == other.id,
                        agent_to_agent_association.c.target_agent_id == self.id,
                    ),
                )
            )
        )

    def get_relations(self) -> List[Dict]:
        outgoing = db.session.execute(
            sa.select(Agent, agent_to_agent_association.c.association_type)
            .join(agent_to_agent_association, Agent.id == agent_to_agent_association.c.target_agent_id)
            .where(agent_to_agent_association.c.source_agent_id == self.id)
        ).all()

        incoming = db.session.execute(
            sa.select(Agent, agent_to_agent_association.c.association_type)
            .join(agent_to_agent_association, Agent.id == agent_to_agent_association.c.source_agent_id)
            .where(agent_to_agent_association.c.target_agent_id == self.id)
        ).all()

        result = []
        seen = set()

        for related, rel_type in outgoing:
            key = (min(self.id, related.id), max(self.id, related.id))
            if key not in seen:
                seen.add(key)
                result.append({
                    'agent': {'id': related.id, 'name': related.name, 'agent_type': related.agent_type.value},
                    'association_type': rel_type,
                    'direction': 'outgoing',
                })

        for related, rel_type in incoming:
            key = (min(self.id, related.id), max(self.id, related.id))
            if key not in seen:
                seen.add(key)
                result.append({
                    'agent': {'id': related.id, 'name': related.name, 'agent_type': related.agent_type.value},
                    'association_type': rel_type,
                    'direction': 'incoming',
                })

        return result


class AgentNote(db.Model):
    __tablename__ = 'agent_notes'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    agent_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('agents.id', ondelete='CASCADE'))
    note_type: so.Mapped[str] = so.mapped_column(sa.String(100))
    content: so.Mapped[str] = so.mapped_column(sa.Text)
    created_at: so.Mapped[datetime] = so.mapped_column(default=lambda: datetime.now(timezone.utc))
    created_by_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey('users.id'))

    agent: so.Mapped['Agent'] = so.relationship('Agent', back_populates='notes')
    created_by: so.Mapped['User'] = so.relationship('User')

    def __repr__(self):
        return f'<AgentNote {self.note_type} on agent {self.agent_id}>'