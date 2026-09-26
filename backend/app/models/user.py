from datetime import datetime, timezone
from typing import Optional, List
import sqlalchemy as sa
import sqlalchemy.orm as so
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from app.extensions import db
from app.models.institution import user_institution_association


class UserRole:
    SYSTEM_ADMIN = 'system_admin'
    INSTITUTION_ADMIN = 'institution_admin'
    ARCHIVIST = 'archivist'
    READ_ONLY = 'read_only'

    ALL = [SYSTEM_ADMIN, INSTITUTION_ADMIN, ARCHIVIST, READ_ONLY]
    WRITE_ROLES = [SYSTEM_ADMIN, INSTITUTION_ADMIN, ARCHIVIST]


class User(UserMixin, db.Model):
    __tablename__ = 'users'

    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    username: so.Mapped[str] = so.mapped_column(sa.String(100), unique=True)
    email: so.Mapped[str] = so.mapped_column(sa.String(200), unique=True)
    password_hash: so.Mapped[str] = so.mapped_column(sa.String(256))
    is_system_admin: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=False)
    is_active: so.Mapped[bool] = so.mapped_column(sa.Boolean, default=True)
    created_at: so.Mapped[datetime] = so.mapped_column(default=lambda: datetime.now(timezone.utc))
    last_login: so.Mapped[Optional[datetime]] = so.mapped_column(nullable=True)

    # Active institution context — which institution the user is currently working in
    active_institution_id: so.Mapped[Optional[int]] = so.mapped_column(
        sa.ForeignKey('institutions.id', name='fk_user_active_institution', use_alter=True),
        nullable=True
    )
    active_institution: so.Mapped[Optional['Institution']] = so.relationship(
        'Institution',
        foreign_keys=[active_institution_id]
    )

    institutions: so.Mapped[List['Institution']] = so.relationship(
        'Institution',
        secondary=user_institution_association,
        back_populates='users'
    )

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    def get_role_for(self, institution: 'Institution') -> Optional[str]:
        return institution.get_user_role(self)

    def has_write_access(self, institution: 'Institution') -> bool:
        if self.is_system_admin:
            return True
        role = self.get_role_for(institution)
        return role in UserRole.WRITE_ROLES

    def is_institution_admin_of(self, institution: 'Institution') -> bool:
        if self.is_system_admin:
            return True
        role = self.get_role_for(institution)
        return role in (UserRole.INSTITUTION_ADMIN, UserRole.SYSTEM_ADMIN)

    def switch_institution(self, institution: 'Institution') -> bool:
        if institution not in self.institutions and not self.is_system_admin:
            return False
        self.active_institution_id = institution.id
        return True

    def __repr__(self):
        return f'<User {self.username}>'
