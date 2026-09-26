from datetime import datetime, timezone
from flask import request
from flask_login import login_user, logout_user, login_required, current_user
from app.api.v1 import bp
from app.api.v1.helpers import success, error
from app.extensions import db
from app.models import User, Institution
from app.models.institution import user_institution_association
import sqlalchemy as sa


def _serialize_user(user: User) -> dict:
    institutions = []
    for inst in user.institutions:
        role = inst.get_user_role(user)
        institutions.append({
            'id': inst.id,
            'name': inst.name,
            'slug': inst.slug,
            'ref_prefix': inst.ref_prefix,
            'role': role,
        })

    active = None
    if user.active_institution:
        active = {
            'id': user.active_institution.id,
            'name': user.active_institution.name,
            'slug': user.active_institution.slug,
            'ref_prefix': user.active_institution.ref_prefix,
            'role': user.active_institution.get_user_role(user),
        }

    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'is_system_admin': user.is_system_admin,
        'active_institution': active,
        'institutions': institutions,
    }



@bp.route('/auth/login', methods=['POST'])
def login():
    if current_user.is_authenticated:
        return success(_serialize_user(current_user))

    data = request.get_json(silent=True) or {}
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not email or not password:
        return error('Email and password are required', 400)

    user = User.query.filter_by(email=email).first()
    if not user or not user.check_password(password):
        return error('Invalid email or password', 401)

    if not user.is_active:
        return error('Account is disabled', 403)

    user.last_login = datetime.now(timezone.utc)

    if not user.active_institution_id and len(user.institutions) == 1:
        user.active_institution_id = user.institutions[0].id

    db.session.commit()
    login_user(user)

    return success(_serialize_user(user))



@bp.route('/auth/logout', methods=['POST'])
@login_required
def logout():
    logout_user()
    return success({'message': 'Logged out'})



@bp.route('/auth/me', methods=['GET'])
@login_required
def me():
    return success(_serialize_user(current_user))



@bp.route('/auth/switch-institution', methods=['POST'])
@login_required
def switch_institution():
    data = request.get_json(silent=True) or {}
    institution_id = data.get('institution_id')

    if not institution_id:
        return error('institution_id is required', 400)

    institution = Institution.query.get(institution_id)
    if not institution:
        return error('Institution not found', 404)

    if not current_user.switch_institution(institution):
        return error('You do not have access to this institution', 403)

    db.session.commit()
    return success(_serialize_user(current_user))


@bp.route('/auth/institutions/<int:institution_id>/members', methods=['POST'])
@login_required
def add_member(institution_id):
    institution = Institution.query.get_or_404(institution_id)

    if not current_user.is_system_admin:
        if not current_user.is_institution_admin_of(institution):
            return error('Admin access required', 403)

    data = request.get_json(silent=True) or {}
    user_id = data.get('user_id')
    role = data.get('role', 'archivist')

    from app.models.user import UserRole
    if role not in UserRole.ALL:
        return error(f'Invalid role. Must be one of: {", ".join(UserRole.ALL)}', 400)

    user = User.query.get_or_404(user_id)

    if institution in user.institutions:
        return error('User is already a member of this institution', 409)

    stmt = user_institution_association.insert().values(
        user_id=user.id,
        institution_id=institution.id,
        role=role,
    )
    db.session.execute(stmt)
    db.session.commit()

    return success({'message': f'{user.username} added to {institution.name} as {role}'}, 201)


@bp.route('/auth/institutions/<int:institution_id>/members/<int:user_id>', methods=['DELETE'])
@login_required
def remove_member(institution_id, user_id):
    institution = Institution.query.get_or_404(institution_id)

    if not current_user.is_system_admin:
        if not current_user.is_institution_admin_of(institution):
            return error('Admin access required', 403)

    stmt = user_institution_association.delete().where(
        user_institution_association.c.user_id == user_id,
        user_institution_association.c.institution_id == institution_id,
    )
    db.session.execute(stmt)
    db.session.commit()

    return success({'message': 'Member removed'})


@bp.route('/auth/institutions/<int:institution_id>/members/<int:user_id>', methods=['PATCH'])
@login_required
def update_member_role(institution_id, user_id):
    institution = Institution.query.get_or_404(institution_id)

    if not current_user.is_system_admin:
        if not current_user.is_institution_admin_of(institution):
            return error('Admin access required', 403)

    data = request.get_json(silent=True) or {}
    role = data.get('role')

    from app.models.user import UserRole
    if not role or role not in UserRole.ALL:
        return error(f'Invalid role. Must be one of: {", ".join(UserRole.ALL)}', 400)

    stmt = user_institution_association.update().where(
        user_institution_association.c.user_id == user_id,
        user_institution_association.c.institution_id == institution_id,
    ).values(role=role)
    db.session.execute(stmt)
    db.session.commit()

    return success({'message': 'Role updated'})



def _serialize_institution(inst) -> dict:
    from app.models.institution import user_institution_association
    import sqlalchemy as sa
    member_count = db.session.execute(
        sa.select(sa.func.count()).select_from(user_institution_association).where(
            user_institution_association.c.institution_id == inst.id
        )
    ).scalar()
    return {
        'id': inst.id,
        'name': inst.name,
        'slug': inst.slug,
        'country_code': inst.country_code,
        'institution_code': inst.institution_code,
        'ref_prefix': inst.ref_prefix,
        'description': inst.description,
        'website': inst.website,
        'is_active': inst.is_active,
        'member_count': member_count,
        'settings': inst.settings or {},
    }


def _serialize_member(user, role: str) -> dict:
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'role': role,
        'is_system_admin': user.is_system_admin,
        'last_login': user.last_login.isoformat() if user.last_login else None,
        'is_active': user.is_active,
    }


@bp.route('/auth/institutions/current', methods=['GET'])
@login_required
def get_current_institution():
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    inst = Institution.query.get(current_user.active_institution_id)
    if not inst:
        return error('Institution not found', 404)
    return success(_serialize_institution(inst))


@bp.route('/auth/institutions/current', methods=['PATCH'])
@login_required
def update_current_institution():
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    if not current_user.is_institution_admin_of(
        Institution.query.get(current_user.active_institution_id)
    ):
        return error('Institution admin access required', 403)

    inst = Institution.query.get(current_user.active_institution_id)
    data = request.get_json(silent=True) or {}

    updatable = ['name', 'description', 'website', 'country_code', 'institution_code','settings']
    for field in updatable:
        if field in data:
            setattr(inst, field, data[field])

    db.session.commit()
    return success(_serialize_institution(inst))


@bp.route('/auth/institutions/current/members', methods=['GET'])
@login_required
def list_members():
    if not current_user.active_institution_id:
        return error('No active institution', 400)

    inst = Institution.query.get(current_user.active_institution_id)
    members = []
    for user in inst.users:
        role = inst.get_user_role(user)
        members.append(_serialize_member(user, role))

    members.sort(key=lambda m: m['username'])
    return success(members)


@bp.route('/auth/institutions/current/invite', methods=['POST'])
@login_required
def invite_user():
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    inst = Institution.query.get(current_user.active_institution_id)
    if not current_user.is_institution_admin_of(inst):
        return error('Institution admin access required', 403)

    data = request.get_json(silent=True) or {}
    required = ['username', 'email', 'password', 'role']
    missing = [f for f in required if not data.get(f)]
    if missing:
        return error(f'Missing required fields: {", ".join(missing)}', 400)

    from app.models.user import UserRole
    if data['role'] not in UserRole.ALL:
        return error(f'Invalid role. Must be one of: {", ".join(UserRole.ALL)}', 400)

    if User.query.filter_by(email=data['email']).first():
        return error('A user with this email already exists', 409)
    if User.query.filter_by(username=data['username']).first():
        return error('A user with this username already exists', 409)

    user = User(
        username=data['username'],
        email=data['email'],
        is_system_admin=False,
        active_institution_id=inst.id,
    )
    user.set_password(data['password'])
    db.session.add(user)
    db.session.flush()

    from app.models.institution import user_institution_association
    db.session.execute(
        user_institution_association.insert().values(
            user_id=user.id,
            institution_id=inst.id,
            role=data['role'],
        )
    )
    db.session.commit()
    return success(_serialize_member(user, data['role']), 201)