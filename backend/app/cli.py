import click
from flask import Flask
from app.extensions import db


def register_commands(app: Flask) -> None:

    @app.cli.command('dev-setup')
    @click.option('--language', type=click.Choice(['en', 'sv']), default='en', show_default=True, help='Vocabulary language')
    @click.option('--institution-name', default='Demo Institution', show_default=True)
    @click.option('--country-code',     default='SE',              show_default=True)
    @click.option('--institution-code', default='DEMO',            show_default=True)
    @click.option('--admin-email',      default='admin@kurbits.dev', show_default=True)
    @click.option('--admin-password',   default='admin',           show_default=True)
    @click.option('--extra-users/--no-extra-users', default=True,  show_default=True,
                  help='Also create archivist and read-only users')
    def dev_setup(institution_name, country_code, institution_code,
                  admin_email, admin_password, extra_users, language):
        """
        One-command dev environment bootstrap.

        Creates an institution, a system admin, seeds all default
        hierarchy types, and optionally creates archivist + read-only
        users so you can test role-based access without extra steps.
        """
        from app.models import Institution, User, HierarchyType, AgentRelationType
        from app.models.institution import user_institution_association

        click.echo('\n── Kurbits dev setup ──────────────────────────────')

        # Institution
        slug = institution_name.lower().replace(' ', '-')
        institution = Institution.query.filter_by(slug=slug).first()
        if institution:
            click.echo(f'  Institution already exists: {institution.name} (id={institution.id})')
        else:
            institution = Institution(
                name=institution_name,
                slug=slug,
                country_code=country_code.upper(),
                institution_code=institution_code.upper(),
            )
            db.session.add(institution)
            db.session.flush()
            click.echo(f'  ✓ Institution: {institution.name}  [{institution.ref_prefix}]  id={institution.id}')

        # System admin
        admin = User.query.filter_by(email=admin_email).first()
        if admin:
            click.echo(f'  Admin already exists: {admin.email}')
        else:
            admin = User(
                username='admin',
                email=admin_email,
                is_system_admin=True,
                active_institution_id=institution.id,
            )
            admin.set_password(admin_password)
            db.session.add(admin)
            db.session.flush()
            db.session.execute(
                user_institution_association.insert().values(
                    user_id=admin.id,
                    institution_id=institution.id,
                    role='institution_admin',
                )
            )
            click.echo(f'  ✓ Admin user created')

        # Extra users
        extra_accounts = []
        if extra_users:
            extras = [
                ('archivist', 'archivist@kurbits.dev', 'archivist', 'archivist'),
                ('readonly',  'readonly@kurbits.dev',  'readonly',  'read_only'),
            ]
            for username, email, password, role in extras:
                u = User.query.filter_by(email=email).first()
                if u:
                    click.echo(f'  User already exists: {email}')
                else:
                    u = User(
                        username=username,
                        email=email,
                        is_system_admin=False,
                        active_institution_id=institution.id,
                    )
                    u.set_password(password)
                    db.session.add(u)
                    db.session.flush()
                    db.session.execute(
                        user_institution_association.insert().values(
                            user_id=u.id,
                            institution_id=institution.id,
                            role=role,
                        )
                    )
                    extra_accounts.append((username, email, password, role))
                    click.echo(f'  ✓ User created: {username} ({role})')

        # Hierarchies
        existing = HierarchyType.query.filter_by(institution_id=institution.id).count()
        if existing:
            click.echo(f'  Hierarchies already seeded ({existing} types), skipping.')
        else:
            _seed_isadg(institution)
            _seed_library(institution)
            _seed_location(institution)
            _seed_classification(institution)
            click.echo('  ✓ Default hierarchies seeded (ISAD(G), Library, Physical Storage, Classification)')

        # Vocabularies
        existing_vocab = AgentRelationType.query.filter_by(institution_id=institution.id).count()
        if existing_vocab:
            click.echo(f'  Vocabularies already seeded ({existing_vocab} agent relation types), skipping.')
        else:
            _seed_vocabularies(institution, language)
            click.echo(f'  ✓ Default vocabularies seeded (language: {language})')

        db.session.commit()

        # Summary
        click.echo('\n── Credentials ────────────────────────────────────')
        click.echo(f'  {"Role":<22} {"Email":<30} Password')
        click.echo(f'  {"─"*22} {"─"*30} {"─"*12}')
        click.echo(f'  {"system_admin":<22} {admin_email:<30} {admin_password}')
        for _, email, password, role in extra_accounts:
            click.echo(f'  {role:<22} {email:<30} {password}')
        click.echo(f'\n  Institution : {institution.name}')
        click.echo(f'  Ref prefix  : {institution.ref_prefix}')
        click.echo('───────────────────────────────────────────────────\n')

    @app.cli.command('seed-vocabularies')
    @click.argument('institution_id', type=int)
    @click.option('--language', type=click.Choice(['en', 'sv']), default='en', show_default=True)
    @click.option('--force', is_flag=True, default=False, help='Re-seed even if vocabularies exist')
    def seed_vocabularies_cmd(institution_id, language, force):
        """Seed default relation type vocabularies for an institution."""
        from app.models import Institution, AgentRelationType
        institution = Institution.query.get(institution_id)
        if not institution:
            click.echo(f'Institution {institution_id} not found.')
            return
        existing = AgentRelationType.query.filter_by(institution_id=institution_id).count()
        if existing and not force:
            click.echo(f'Vocabularies already seeded ({existing} agent relation types). Use --force to re-seed.')
            return
        _seed_vocabularies(institution, language)
        db.session.commit()
        click.echo(f'✓ Vocabularies seeded for {institution.name} (language: {language})')

    @app.cli.command('seed-hierarchies')
    @click.argument('institution_id', type=int)
    def seed_hierarchies(institution_id):
        """Install default hierarchy types for an existing institution."""
        from app.models import Institution, HierarchyType

        institution = Institution.query.get(institution_id)
        if not institution:
            click.echo(f'Institution {institution_id} not found.')
            return

        existing = HierarchyType.query.filter_by(institution_id=institution.id).count()
        if existing:
            click.echo(f'Hierarchies already seeded ({existing} types exist).')
            return

        _seed_isadg(institution)
        _seed_library(institution)
        _seed_location(institution)
        _seed_classification(institution)
        db.session.commit()
        click.echo(f'Default hierarchies installed for {institution.name}.')

    @app.cli.command('create-institution')
    @click.option('--name', prompt=True)
    @click.option('--slug', prompt=True)
    @click.option('--country-code', prompt=True)
    @click.option('--institution-code', prompt=True)
    def create_institution(name, slug, country_code, institution_code):
        """Create a new institution."""
        from app.models import Institution
        inst = Institution(
            name=name,
            slug=slug,
            country_code=country_code.upper(),
            institution_code=institution_code.upper(),
        )
        db.session.add(inst)
        db.session.commit()
        click.echo(f'Created institution: {inst.name} (id={inst.id})')


    @app.cli.command('add-user')
    @click.option('--email', prompt=True, help='Email of the user to add')
    @click.option('--institution-id', type=int, prompt=True, help='Institution ID')
    @click.option('--role', prompt=True,
                  type=click.Choice(['institution_admin', 'archivist', 'read_only']),
                  default='archivist', show_default=True)
    def add_user(email, institution_id, role):
        """Add an existing user to an institution with a given role."""
        from app.models import User, Institution
        from app.models.institution import user_institution_association
        import sqlalchemy as sa

        user = User.query.filter_by(email=email).first()
        if not user:
            click.echo(f'No user found with email: {email}')
            return

        institution = Institution.query.get(institution_id)
        if not institution:
            click.echo(f'No institution found with id: {institution_id}')
            return

        existing = db.session.execute(
            sa.select(user_institution_association).where(
                user_institution_association.c.user_id == user.id,
                user_institution_association.c.institution_id == institution.id,
            )
        ).first()

        if existing:
            db.session.execute(
                user_institution_association.update().where(
                    user_institution_association.c.user_id == user.id,
                    user_institution_association.c.institution_id == institution.id,
                ).values(role=role)
            )
            db.session.commit()
            click.echo(f'Updated {user.username} role to {role} in {institution.name}')
        else:
            db.session.execute(
                user_institution_association.insert().values(
                    user_id=user.id,
                    institution_id=institution.id,
                    role=role,
                )
            )
            if not user.active_institution_id:
                user.active_institution_id = institution.id
            db.session.commit()
            click.echo(f'Added {user.username} to {institution.name} as {role}')

    @app.cli.command('list-users')
    @click.option('--institution-id', type=int, default=None,
                  help='Filter by institution ID (omit for all users)')
    def list_users(institution_id):
        """List users, optionally filtered by institution."""
        from app.models import User, Institution
        from app.models.institution import user_institution_association
        import sqlalchemy as sa

        if institution_id:
            institution = Institution.query.get(institution_id)
            if not institution:
                click.echo(f'No institution found with id: {institution_id}')
                return

            rows = db.session.execute(
                sa.select(User, user_institution_association.c.role)
                .join(user_institution_association,
                      User.id == user_institution_association.c.user_id)
                .where(user_institution_association.c.institution_id == institution_id)
                .order_by(User.username)
            ).all()

            click.echo(f'\n── {institution.name} ({institution.ref_prefix}) ────')
            click.echo(f'  {"Username":<20} {"Email":<30} Role')
            click.echo(f'  {"─"*20} {"─"*30} {"─"*20}')
            for user, role in rows:
                click.echo(f'  {user.username:<20} {user.email:<30} {role}')
        else:
            users = User.query.order_by(User.username).all()
            click.echo(f'\n── All users ({len(users)}) ────')
            click.echo(f'  {"Username":<20} {"Email":<30} {"Admin":<8} Institutions')
            click.echo(f'  {"─"*20} {"─"*30} {"─"*8} {"─"*20}')
            for user in users:
                insts = ', '.join(i.slug for i in user.institutions) or '—'
                admin = 'yes' if user.is_system_admin else ''
                click.echo(f'  {user.username:<20} {user.email:<30} {admin:<8} {insts}')

        click.echo()

    @app.cli.command('list-institutions')
    def list_institutions():
        """List all institutions."""
        from app.models import Institution

        institutions = Institution.query.order_by(Institution.name).all()
        click.echo(f'\n── Institutions ({len(institutions)}) ────────────────────')
        click.echo(f'  {"ID":<5} {"Name":<30} {"Ref prefix":<15} Users')
        click.echo(f'  {"─"*5} {"─"*30} {"─"*15} {"─"*5}')
        for inst in institutions:
            click.echo(
                f'  {inst.id:<5} {inst.name:<30} {inst.ref_prefix:<15} {len(inst.users)}'
            )
        click.echo()

    @app.cli.command('create-admin')
    @click.option('--username', prompt=True)
    @click.option('--email', prompt=True)
    @click.option('--password', prompt=True, hide_input=True, confirmation_prompt=True)
    def create_admin(username, email, password):
        """Create a system admin user."""
        from app.models import User
        user = User(username=username, email=email, is_system_admin=True)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        click.echo(f'System admin created: {username}')


# ── Seed helpers ──────────────────────────────────────────────────────
# Use direct INSERT for the many-to-many level relationships to avoid
# SQLAlchemy autoflush triggering the CHECK constraint prematurely.

import sqlalchemy as sa
from app.models.hierarchy import hierarchy_level_relationships


def _insert_level_rel(parent_id: int, child_id: int) -> None:
    db.session.execute(
        hierarchy_level_relationships.insert().values(
            parent_id=parent_id, child_id=child_id
        )
    )


def _seed_isadg(institution) -> None:
    from app.models import HierarchyType, HierarchyLevel, HierarchyEntityType

    ht = HierarchyType(
        institution_id=institution.id,
        name='ISAD(G)',
        description='General International Standard Archival Description',
        entity_type=HierarchyEntityType.RESOURCE,
        is_default=True,
    )
    db.session.add(ht)
    db.session.flush()

    levels_def = [
        ('Fonds',      0, False),
        ('Sub-fonds',  1, False),
        ('Series',     2, False),
        ('Sub-series', 3, False),
        ('File',       4, True),
        ('Item',       5, True),
    ]
    levels = {}
    for name, order, can_loc in levels_def:
        level = HierarchyLevel(
            hierarchy_type_id=ht.id,
            name=name,
            sort_order=order,
            can_have_location=can_loc,
        )
        db.session.add(level)
        db.session.flush()
        levels[name] = level

    parent_child = [
        ('Fonds',      'Sub-fonds'),
        ('Fonds',      'Series'),
        ('Fonds',      'File'),
        ('Fonds',      'Item'),
        ('Sub-fonds',  'Series'),
        ('Sub-fonds',  'File'),
        ('Series',     'Sub-series'),
        ('Series',     'File'),
        ('Sub-series', 'File'),
        ('File',       'Item'),
    ]
    for parent_name, child_name in parent_child:
        _insert_level_rel(levels[parent_name].id, levels[child_name].id)


def _seed_library(institution) -> None:
    from app.models import HierarchyType, HierarchyLevel, HierarchyEntityType

    ht = HierarchyType(
        institution_id=institution.id,
        name='Library Collection',
        description='Hierarchical library/collection description',
        entity_type=HierarchyEntityType.RESOURCE,
        is_default=False,
    )
    db.session.add(ht)
    db.session.flush()

    levels_def = [
        ('Collection',     0, False),
        ('Sub-collection', 1, False),
        ('Volume',         2, True),
        ('Item',           3, True),
    ]
    levels = {}
    for name, order, can_loc in levels_def:
        level = HierarchyLevel(
            hierarchy_type_id=ht.id,
            name=name,
            sort_order=order,
            can_have_location=can_loc,
        )
        db.session.add(level)
        db.session.flush()
        levels[name] = level

    _insert_level_rel(levels['Collection'].id,     levels['Sub-collection'].id)
    _insert_level_rel(levels['Collection'].id,     levels['Volume'].id)
    _insert_level_rel(levels['Sub-collection'].id, levels['Volume'].id)
    _insert_level_rel(levels['Volume'].id,         levels['Item'].id)


def _seed_location(institution) -> None:
    from app.models import HierarchyType, HierarchyLevel, HierarchyEntityType

    ht = HierarchyType(
        institution_id=institution.id,
        name='Physical Storage',
        description='Physical storage location hierarchy',
        entity_type=HierarchyEntityType.LOCATION,
        is_default=True,
    )
    db.session.add(ht)
    db.session.flush()

    level_names = ['Building', 'Floor', 'Room', 'Shelf', 'Box']
    levels = {}
    for i, name in enumerate(level_names):
        level = HierarchyLevel(
            hierarchy_type_id=ht.id,
            name=name,
            sort_order=i,
            can_have_location=(name in ('Shelf', 'Box')),
        )
        db.session.add(level)
        db.session.flush()
        levels[name] = level

    for parent, child in zip(level_names, level_names[1:]):
        _insert_level_rel(levels[parent].id, levels[child].id)


def _seed_classification(institution) -> None:
    from app.models import HierarchyType, HierarchyLevel, HierarchyEntityType

    ht = HierarchyType(
        institution_id=institution.id,
        name='Subject Classification',
        description='Subject/function based classification scheme',
        entity_type=HierarchyEntityType.CLASSIFICATION,
        is_default=True,
    )
    db.session.add(ht)
    db.session.flush()

    level_names = ['Class', 'Division', 'Section', 'Subsection']
    levels = {}
    for i, name in enumerate(level_names):
        level = HierarchyLevel(
            hierarchy_type_id=ht.id,
            name=name,
            sort_order=i,
        )
        db.session.add(level)
        db.session.flush()
        levels[name] = level

    for parent, child in zip(level_names, level_names[1:]):
        _insert_level_rel(levels[parent].id, levels[child].id)


def _seed_vocabularies(institution, language: str = 'en') -> None:
    """Seed default relation type vocabularies for an institution."""
    from app.models.agent import AgentRelationType, AgentNodeRelationType
    from app.models.node import NodeRelationType

    institution_id = institution.id

    # ── Agent ↔ node relation types ──────────────────────────────────────
    # How agents relate to archival resources
    agent_node_types = {
        'en': [
            ('creator',       'The agent who created the material'),
            ('contributor',   'Agent who contributed to the creation'),
            ('publisher',     'Agent responsible for making the material available'),
            ('subject',       'Agent the material is about'),
            ('custodian',     'Agent who had custody of the material'),
            ('accumulator',   'Agent who accumulated the material over time'),
            ('collector',     'Agent who collected the material'),
            ('commissioner',  'Agent who commissioned the creation'),
            ('correspondent', 'Agent who exchanged correspondence'),
            ('donor',         'Agent who donated the material to the archive'),
        ],
        'sv': [
            ('skapare',        'Den aktör som skapat materialet'),
            ('bidragsgivare',  'Aktör som bidragit till skapandet'),
            ('utgivare',       'Aktör ansvarig för att tillgängliggöra materialet'),
            ('ämne',           'Aktör som materialet handlar om'),
            ('förvarare',      'Aktör som förvarat materialet'),
            ('ackumulatör',    'Aktör som samlat på materialet över tid'),
            ('insamlare',      'Aktör som samlat in materialet'),
            ('uppdragsgivare', 'Aktör som beställt skapandet'),
            ('brevskrivare',   'Aktör som utväxlat korrespondens'),
            ('donator',        'Aktör som donerat materialet till arkivet'),
        ],
    }

    for name, description in agent_node_types.get(language, agent_node_types['en']):
        existing = AgentNodeRelationType.query.filter_by(
            institution_id=institution_id, name=name
        ).first()
        if not existing:
            db.session.add(AgentNodeRelationType(
                institution_id=institution_id,
                name=name,
                description=description,
            ))

    # ── Agent ↔ agent relation types ─────────────────────────────────────
    # Relationships between agents — created as symmetric or complementary pairs
    agent_agent_types = {
        'en': [
            # (name, description, is_symmetric, complement_name, complement_desc)
            ('is associated with', 'General associative relationship', True,  None, None),
            ('is member of',       'Agent is a member of another',    False, 'has member',       'Agent has this agent as a member'),
            ('is part of',         'Agent is a subdivision of another',False,'has part',          'Agent has this agent as a subdivision'),
            ('is predecessor of',  'Agent preceded another in time',  False, 'is successor of',  'Agent followed another in time'),
            ('is parent of',       'Parent–child relationship',       False, 'is child of',      'Child–parent relationship'),
            ('controls',           'Agent controls another',          False, 'is controlled by', 'Agent is controlled by another'),
            ('founded',            'Agent founded another',           False, 'was founded by',   'Agent was founded by another'),
            ('is sibling of',      'Agents share the same parent',    True,  None, None),
        ],
        'sv': [
            ('är associerad med',  'Generell associativ relation',             True,  None, None),
            ('är medlem i',        'Aktören är medlem i en annan',             False, 'har medlem',          'Aktören har denna aktör som medlem'),
            ('är del av',          'Aktören är en underavdelning av en annan', False, 'har del',             'Aktören har denna aktör som underavdelning'),
            ('föregår',            'Aktören föregick en annan i tid',          False, 'efterföljer',         'Aktören efterföljde en annan i tid'),
            ('är förälder till',   'Förälder–barn-relation',                   False, 'är barn till',        'Barn–förälder-relation'),
            ('kontrollerar',       'Aktören kontrollerar en annan',            False, 'kontrolleras av',     'Aktören kontrolleras av en annan'),
            ('grundade',           'Aktören grundade en annan',                False, 'grundades av',        'Aktören grundades av en annan'),
            ('är syskon till',     'Aktörerna delar samma förälder',           True,  None, None),
        ],
    }

    for row in agent_agent_types.get(language, agent_agent_types['en']):
        name, desc, is_sym, comp_name, comp_desc = row
        existing = AgentRelationType.query.filter_by(
            institution_id=institution_id, name=name
        ).first()
        if existing:
            continue

        rt = AgentRelationType(
            institution_id=institution_id,
            name=name,
            description=desc,
            is_symmetric=is_sym,
        )
        db.session.add(rt)
        db.session.flush()

        if not is_sym and comp_name:
            complement = AgentRelationType(
                institution_id=institution_id,
                name=comp_name,
                description=comp_desc,
                is_symmetric=False,
                complementary_id=rt.id,
            )
            db.session.add(complement)
            db.session.flush()
            rt.complementary_id = complement.id

    # ── Node ↔ node relation types ────────────────────────────────────────
    node_node_types = {
        'en': [
            ('related to',          'General relationship between resources', True,  None, None),
            ('see also',            'Cross-reference to a related resource',  True,  None, None),
            ('is part of',          'Resource is a component of another',     False, 'has part',        'Resource contains another as a component'),
            ('precedes',            'Resource comes before another in time',  False, 'follows',         'Resource comes after another in time'),
            ('is copy of',          'Resource is a copy of another',          False, 'has copy',        'Resource has a copy'),
            ('is translation of',   'Resource is a translation of another',   False, 'has translation', 'Resource has a translation'),
            ('is version of',       'Resource is a version of another',       False, 'has version',     'Resource has a version'),
            ('replaces',            'Resource supersedes another',            False, 'is replaced by',  'Resource is superseded by another'),
        ],
        'sv': [
            ('relaterad till',       'Generell relation mellan resurser',             True,  None, None),
            ('se även',              'Korsreferens till en relaterad resurs',          True,  None, None),
            ('är del av',            'Resursen är en del av en annan',                False, 'har del',         'Resursen innehåller en annan som del'),
            ('föregår',              'Resursen förekommer före en annan i tid',        False, 'efterföljer',     'Resursen förekommer efter en annan i tid'),
            ('är kopia av',          'Resursen är en kopia av en annan',               False, 'har kopia',       'Resursen har en kopia'),
            ('är översättning av',   'Resursen är en översättning av en annan',        False, 'har översättning','Resursen har en översättning'),
            ('är version av',        'Resursen är en version av en annan',             False, 'har version',     'Resursen har en version'),
            ('ersätter',             'Resursen ersätter en annan',                     False, 'ersätts av',      'Resursen ersätts av en annan'),
        ],
    }

    for row in node_node_types.get(language, node_node_types['en']):
        name, desc, is_sym, comp_name, comp_desc = row
        existing = NodeRelationType.query.filter_by(
            institution_id=institution_id, name=name
        ).first()
        if existing:
            continue

        rt = NodeRelationType(
            institution_id=institution_id,
            name=name,
            description=desc,
            is_symmetric=is_sym,
        )
        db.session.add(rt)
        db.session.flush()

        if not is_sym and comp_name:
            complement = NodeRelationType(
                institution_id=institution_id,
                name=comp_name,
                description=comp_desc,
                is_symmetric=False,
                complementary_id=rt.id,
            )
            db.session.add(complement)
            db.session.flush()
            rt.complementary_id = complement.id

    # ── Place types ───────────────────────────────────────────────────────
    from app.models.geo import PlaceType, TagCategory

    default_place_types = {
        'en': [
            ('born_in',          'Born in',             'agent', 0),
            ('died_in',          'Died in',             'agent', 1),
            ('active_in',        'Active in',           'agent', 2),
            ('headquartered_in', 'Headquartered in',    'agent', 3),
            ('created_in',       'Created in',          'node',  4),
            ('about',            'About / covers',      'node',  5),
            ('origin',           'Origin / provenance', 'node',  6),
        ],
        'sv': [
            ('born_in',          'Född i',              'agent', 0),
            ('died_in',          'Avled i',             'agent', 1),
            ('active_in',        'Verksam i',           'agent', 2),
            ('headquartered_in', 'Säte i',              'agent', 3),
            ('created_in',       'Skapad i',            'node',  4),
            ('about',            'Handlar om',          'node',  5),
            ('origin',           'Ursprung / proveniens', 'node', 6),
        ],
    }

    for name, label, applicable_to, sort_order in default_place_types.get(language, default_place_types['en']):
        if not PlaceType.query.filter_by(institution_id=institution_id, name=name).first():
            db.session.add(PlaceType(
                institution_id=institution_id,
                name=name,
                label=label,
                applicable_to=applicable_to,
                sort_order=sort_order,
            ))

    # ── Tag categories ────────────────────────────────────────────────────
    default_tag_categories = {
        'en': [
            ('topic',      'Topic',      0),
            ('occupation', 'Occupation', 1),
            ('genre',      'Genre',      2),
            ('function',   'Function',   3),
            ('period',     'Period',     4),
            ('other',      'Other',      5),
        ],
        'sv': [
            ('topic',      'Ämne',       0),
            ('occupation', 'Yrke',       1),
            ('genre',      'Genre',      2),
            ('function',   'Funktion',   3),
            ('period',     'Period',     4),
            ('other',      'Övrigt',     5),
        ],
    }

    for name, label, sort_order in default_tag_categories.get(language, default_tag_categories['en']):
        if not TagCategory.query.filter_by(institution_id=institution_id, name=name).first():
            db.session.add(TagCategory(
                institution_id=institution_id,
                name=name,
                label=label,
                sort_order=sort_order,
            ))

    db.session.commit()