from datetime import datetime, timezone
from typing import Optional, List
import sqlalchemy as sa
import sqlalchemy.orm as so
from app.extensions import db


user_institution_association = sa.Table(
    'user_institution_association',
    db.Model.metadata,
    sa.Column('user_id', sa.Integer, sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
    sa.Column('institution_id', sa.Integer, sa.ForeignKey('institutions.id', ondelete='CASCADE'), primary_key=True),
    sa.Column('role', sa.String(50), nullable=False, default='archivist'),
    sa.Column('joined_at', sa.DateTime, default=lambda: datetime.now(timezone.utc)),
)


class Institution(db.Model):
    __tablename__ = 'institutions'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    name: so.Mapped[str] = so.mapped_column(sa.String(200))
    slug: so.Mapped[str] = so.mapped_column(sa.String(100), unique=True)  # URL-safe identifier
    country_code: so.Mapped[str] = so.mapped_column(sa.String(10))        # e.g. SE, GB, US
    institution_code: so.Mapped[str] = so.mapped_column(sa.String(50))    # e.g. GBG, PRO
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    website: so.Mapped[Optional[str]] = so.mapped_column(sa.String(200), nullable=True)
    is_active: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=True)
    created_at: so.Mapped[datetime] = so.mapped_column(default=lambda: datetime.now(timezone.utc))
    settings: so.Mapped[Optional[dict]] = so.mapped_column(sa.JSON, nullable=True)

    users: so.Mapped[List['User']] = so.relationship(
        'User',
        secondary=user_institution_association,
        back_populates='institutions'
    )
    hierarchy_types: so.Mapped[List['HierarchyType']] = so.relationship(
        'HierarchyType',
        back_populates='institution',
        cascade='all, delete-orphan'
    )
    nodes: so.Mapped[List['Node']] = so.relationship(
        'Node',
        back_populates='institution',
        cascade='all, delete-orphan'
    )
    agents: so.Mapped[List['Agent']] = so.relationship(
        'Agent',
        back_populates='institution',
        cascade='all, delete-orphan'
    )
    locations: so.Mapped[List['Location']] = so.relationship(
        'Location',
        back_populates='institution',
        cascade='all, delete-orphan'
    )
    classifications: so.Mapped[List['Classification']] = so.relationship(
        'Classification',
        back_populates='institution',
        cascade='all, delete-orphan'
    )

    __table_args__ = (
        sa.UniqueConstraint('country_code', 'institution_code', name='uq_institution_ref'),
    )

    def __repr__(self):
        return f'<Institution {self.slug}>'

    @property
    def ref_prefix(self) -> str:
        return f'{self.country_code.upper()}-{self.institution_code.upper()}'

    @property
    def index_attachment_text(self) -> bool:
        return bool((self.settings or {}).get('index_attachment_text', False))

    def get_user_role(self, user: 'User') -> Optional[str]:
        row = db.session.execute(
            sa.select(user_institution_association.c.role).where(
                user_institution_association.c.user_id == user.id,
                user_institution_association.c.institution_id == self.id,
            )
        ).first()
        return row[0] if row else None
