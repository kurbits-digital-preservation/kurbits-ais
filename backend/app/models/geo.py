from __future__ import annotations
from typing import Optional, List, TYPE_CHECKING
import sqlalchemy as sa
import sqlalchemy.orm as so
from app.extensions import db

if TYPE_CHECKING:
    from app.models.agent import Agent
    from app.models.node import Node


AGENT_PLACE_TYPES = ['born_in', 'died_in', 'active_in', 'headquartered_in']
NODE_PLACE_TYPES  = ['created_in', 'about', 'origin']

PLACE_TYPE_LABELS = {
    'born_in':          'Born in',
    'died_in':          'Died in',
    'active_in':        'Active in',
    'headquartered_in': 'Headquartered in',
    'created_in':       'Created in',
    'about':            'About / covers',
    'origin':           'Origin / provenance',
}

TAG_CATEGORIES = ['topic', 'occupation', 'genre', 'function', 'period', 'other']


class AgentPlace(db.Model):
    __tablename__ = 'agent_places'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    agent_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('agents.id', ondelete='CASCADE')
    )
    place_type: so.Mapped[str] = so.mapped_column(sa.String(50))
    name: so.Mapped[str] = so.mapped_column(sa.String(300))
    wikidata_id: so.Mapped[Optional[str]] = so.mapped_column(sa.String(50), nullable=True)
    lat: so.Mapped[Optional[float]] = so.mapped_column(sa.Float, nullable=True)
    lon: so.Mapped[Optional[float]] = so.mapped_column(sa.Float, nullable=True)
    note: so.Mapped[Optional[str]] = so.mapped_column(sa.String(500), nullable=True)
    date_from: so.Mapped[Optional[str]] = so.mapped_column(sa.String(20), nullable=True)
    date_to: so.Mapped[Optional[str]] = so.mapped_column(sa.String(20), nullable=True)
    sort_order: so.Mapped[int] = so.mapped_column(sa.Integer, default=0)

    agent: so.Mapped['Agent'] = so.relationship('Agent', back_populates='places')

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'place_type': self.place_type,
            'place_type_label': PLACE_TYPE_LABELS.get(self.place_type, self.place_type),
            'name': self.name,
            'wikidata_id': self.wikidata_id,
            'lat': self.lat,
            'lon': self.lon,
            'note': self.note,
            'date_from': self.date_from,
            'date_to': self.date_to,
            'sort_order': self.sort_order,
        }


class NodePlace(db.Model):
    __tablename__ = 'node_places'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    node_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('nodes.id', ondelete='CASCADE')
    )
    place_type: so.Mapped[str] = so.mapped_column(sa.String(50))
    name: so.Mapped[str] = so.mapped_column(sa.String(300))
    wikidata_id: so.Mapped[Optional[str]] = so.mapped_column(sa.String(50), nullable=True)
    lat: so.Mapped[Optional[float]] = so.mapped_column(sa.Float, nullable=True)
    lon: so.Mapped[Optional[float]] = so.mapped_column(sa.Float, nullable=True)
    note: so.Mapped[Optional[str]] = so.mapped_column(sa.String(500), nullable=True)
    date_from: so.Mapped[Optional[str]] = so.mapped_column(sa.String(20), nullable=True)
    date_to: so.Mapped[Optional[str]] = so.mapped_column(sa.String(20), nullable=True)
    sort_order: so.Mapped[int] = so.mapped_column(sa.Integer, default=0)

    node: so.Mapped['Node'] = so.relationship('Node', back_populates='places')

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'place_type': self.place_type,
            'place_type_label': PLACE_TYPE_LABELS.get(self.place_type, self.place_type),
            'name': self.name,
            'wikidata_id': self.wikidata_id,
            'lat': self.lat,
            'lon': self.lon,
            'note': self.note,
            'date_from': self.date_from,
            'date_to': self.date_to,
            'sort_order': self.sort_order,
        }


# ── Association tables ────────────────────────────────────────────────

node_tags_table = sa.Table(
    'node_tags',
    db.Model.metadata,
    sa.Column('node_id', sa.Integer, sa.ForeignKey('nodes.id', ondelete='CASCADE'), primary_key=True),
    sa.Column('tag_id',  sa.Integer, sa.ForeignKey('tags.id',  ondelete='CASCADE'), primary_key=True),
)

agent_tags_table = sa.Table(
    'agent_tags',
    db.Model.metadata,
    sa.Column('agent_id', sa.Integer, sa.ForeignKey('agents.id', ondelete='CASCADE'), primary_key=True),
    sa.Column('tag_id',   sa.Integer, sa.ForeignKey('tags.id',  ondelete='CASCADE'), primary_key=True),
)


class Tag(db.Model):
    __tablename__ = 'tags'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('institutions.id', ondelete='CASCADE')
    )
    name: so.Mapped[str] = so.mapped_column(sa.String(200))
    category: so.Mapped[Optional[str]] = so.mapped_column(sa.String(100), nullable=True)

    __table_args__ = (
        sa.UniqueConstraint('institution_id', 'name', name='uq_tag_per_institution'),
    )

    nodes: so.Mapped[List['Node']] = so.relationship(
        'Node', secondary=node_tags_table, back_populates='tags'
    )
    agents: so.Mapped[List['Agent']] = so.relationship(
        'Agent', secondary=agent_tags_table, back_populates='tags'
    )

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'category': self.category,
        }


# ── Configurable vocab tables ─────────────────────────────────────────

class PlaceType(db.Model):
    __tablename__ = 'place_types'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('institutions.id', ondelete='CASCADE')
    )
    name: so.Mapped[str] = so.mapped_column(sa.String(100))    # slug: born_in
    label: so.Mapped[str] = so.mapped_column(sa.String(200))   # display: Born in
    applicable_to: so.Mapped[str] = so.mapped_column(
        sa.String(20), default='both'
    )  # 'agent' | 'node' | 'both'
    sort_order: so.Mapped[int] = so.mapped_column(sa.Integer, default=0)

    __table_args__ = (
        sa.UniqueConstraint('institution_id', 'name', name='uq_place_type_per_institution'),
    )

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'label': self.label,
            'applicable_to': self.applicable_to,
            'sort_order': self.sort_order,
        }


class TagCategory(db.Model):
    __tablename__ = 'tag_categories'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    institution_id: so.Mapped[int] = so.mapped_column(
        sa.ForeignKey('institutions.id', ondelete='CASCADE')
    )
    name: so.Mapped[str] = so.mapped_column(sa.String(100))
    label: so.Mapped[str] = so.mapped_column(sa.String(200))
    applicable_to: so.Mapped[str] = so.mapped_column(sa.String(20), default='both', server_default='both')
    # 'agent' | 'node' | 'both'
    sort_order: so.Mapped[int] = so.mapped_column(sa.Integer, default=0)

    __table_args__ = (
        sa.UniqueConstraint('institution_id', 'name', name='uq_tag_category_per_institution'),
    )

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'label': self.label,
            'applicable_to': self.applicable_to,
            'sort_order': self.sort_order,
        }