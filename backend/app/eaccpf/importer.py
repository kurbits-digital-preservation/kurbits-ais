"""
Converts EAC-CPF into Kurbits Agent model instances.

"""
from __future__ import annotations
from app.extensions import db
from app.models.agent import (
    Agent, AgentType, AgentRelationType, AgentIdentifier, AgentNameForm, AgentNameFormType,
)
from app.models.node import IdentifierScheme
from app.eaccpf.parser import ParsedAgent, ParseResult


_AGENT_TYPE_MAP = {
    'person':       AgentType.PERSON,
    'organization': AgentType.ORGANIZATION,
    'family':       AgentType.FAMILY,
    'software':     AgentType.SOFTWARE,
}

_EAC_RECORD_SCHEME_NAME = 'EAC-CPF Record ID'

# EAC-CPF tokens -> name form type names to look for, in order.
_NAME_FORM_TYPE_ALIASES = {
    'parallel':     ('parallellnamn', 'parallel name'),
    'abbreviation': ('förkortning', 'abbreviation'),
    'former':       ('tidigare namn', 'former name'),
    'later':        ('senare namn', 'later name'),
    'variant':      ('variantform', 'variant form'),
    'other':        ('variantform', 'variant form'),
}
_DEFAULT_NAME_FORM_TOKEN = 'variant'


class ImportResult:
    def __init__(self):
        self.created: list[dict] = []
        self.updated: list[dict] = []
        self.skipped: list[str] = []
        self.warnings: list[str] = []

    @property
    def total_created(self) -> int:
        return len(self.created)

    @property
    def total_updated(self) -> int:
        return len(self.updated)

    def to_dict(self) -> dict:
        return {
            'created': self.created,
            'updated': self.updated,
            'skipped': self.skipped,
            'warnings': self.warnings,
            'total_created': self.total_created,
            'total_updated': self.total_updated,
        }


def _get_eac_scheme(institution_id: int) -> IdentifierScheme:
    return IdentifierScheme.get_or_create(
        institution_id, _EAC_RECORD_SCHEME_NAME,
        description='<recordId>/<otherRecordId> from an imported EAC-CPF file — '
                     'used to recognise the same record on a later re-import.',
    )


def _set_source_id_identifier(agent: Agent, eac_scheme: IdentifierScheme, source_id: str) -> None:
    if not source_id:
        return
    existing = AgentIdentifier.query.filter_by(agent_id=agent.id, scheme_id=eac_scheme.id).first()
    if existing:
        existing.value = source_id
        return
    clash = AgentIdentifier.query.filter_by(scheme_id=eac_scheme.id, value=source_id).first()
    if clash:
        return
    db.session.add(AgentIdentifier(agent_id=agent.id, scheme_id=eac_scheme.id, value=source_id))


class _NameFormTypeResolver:
    """Maps EAC-CPF name form types onto the institution's vocabulary,
    creating missing types once per import."""

    def __init__(self, institution_id: int, result: ImportResult):
        self.institution_id = institution_id
        self.result = result
        self.by_name = {
            t.name.lower(): t
            for t in AgentNameFormType.query.filter_by(institution_id=institution_id).all()
        }

    def resolve(self, raw: str | None) -> AgentNameFormType:
        token = (raw or _DEFAULT_NAME_FORM_TOKEN).strip()
        key = token.lower()

        if key in self.by_name:
            return self.by_name[key]
        for alias in _NAME_FORM_TYPE_ALIASES.get(key, ()):
            if alias in self.by_name:
                return self.by_name[alias]

        name = _NAME_FORM_TYPE_ALIASES.get(key, (token,))[0][:100]
        created = AgentNameFormType(institution_id=self.institution_id, name=name)
        db.session.add(created)
        db.session.flush()
        self.by_name[name.lower()] = created
        self.result.warnings.append(f'Created name form type "{name}"')
        return created


def _add_name_forms(agent: Agent, name_forms: list[dict], resolver: _NameFormTypeResolver,
                    created_by_id: int) -> None:
    existing = {nf.name.lower() for nf in agent.name_forms}
    for form in name_forms:
        name = (form.get('name') or '').strip()[:500]
        if not name or name.lower() in existing:
            continue
        existing.add(name.lower())
        agent.name_forms.append(AgentNameForm(
            type_id=resolver.resolve(form.get('type')).id,
            name=name,
            date_from=form.get('date_from'),
            date_to=form.get('date_to'),
            created_by_id=created_by_id,
        ))


def _find_existing(institution_id: int, parsed: ParsedAgent, eac_scheme: IdentifierScheme) -> Agent | None:
    """Try to find an existing agent matching by EAC-CPF record id, then authorized_form."""
    if parsed.source_id:
        ident = AgentIdentifier.query.filter_by(
            scheme_id=eac_scheme.id, value=parsed.source_id).first()
        if ident:
            return ident.agent

    if parsed.authorized_form:
        existing = Agent.query.filter_by(
            institution_id=institution_id,
            authorized_form=parsed.authorized_form,
        ).first()
        if existing:
            return existing

    return None


def agents_from_eaccpf(
    parse_result: ParseResult,
    institution_id: int,
    created_by_id: int,
    update_existing: bool = False,
) -> ImportResult:
    """
    Import parsed EAC-CPF agents into the database.

    Args:
        parse_result: output from eaccpf.parser.parse_file()
        institution_id: target institution
        created_by_id: user performing the import
        update_existing: if True, update agents matched by record id/name;
                         if False, skip them
    """
    result = ImportResult()
    result.warnings.extend(parse_result.warnings)

    eac_scheme = _get_eac_scheme(institution_id)
    resolver = _NameFormTypeResolver(institution_id, result)

    # First pass: create/update all agents (without relations, to avoid FK issues)
    id_map: dict[str, int] = {}  # source_id → agent.id

    for parsed in parse_result.agents:
        existing = _find_existing(institution_id, parsed, eac_scheme)

        if existing and not update_existing:
            result.skipped.append(f'{parsed.name} (already exists)')
            id_map[parsed.source_id] = existing.id
            continue

        agent_type = _AGENT_TYPE_MAP.get(parsed.agent_type, AgentType.ORGANIZATION)

        if existing:
            agent = existing
            agent.name = parsed.name
            agent.authorized_form = parsed.authorized_form or parsed.name
            agent.agent_type = agent_type
            if parsed.description:
                agent.description = parsed.description
            if parsed.date_from:
                agent.date_from = parsed.date_from
            if parsed.date_to:
                agent.date_to = parsed.date_to
            _add_name_forms(agent, parsed.name_forms, resolver, created_by_id)
            db.session.flush()
            result.updated.append({'id': agent.id, 'name': agent.name})
        else:
            agent = Agent(
                institution_id=institution_id,
                name=parsed.name,
                authorized_form=parsed.authorized_form or parsed.name,
                agent_type=agent_type,
                description=parsed.description,
                date_from=parsed.date_from,
                date_to=parsed.date_to,
                created_by_id=created_by_id,
            )
            db.session.add(agent)
            _add_name_forms(agent, parsed.name_forms, resolver, created_by_id)
            db.session.flush()

            result.created.append({'id': agent.id, 'name': agent.name})

        _set_source_id_identifier(agent, eac_scheme, parsed.source_id)
        id_map[parsed.source_id] = agent.id

    # Second pass: wire up cpfRelation → agent_to_agent_association
    import sqlalchemy as sa
    from app.models.agent import agent_to_agent_association

    for parsed in parse_result.agents:
        if parsed.source_id not in id_map:
            continue

        agent_id = id_map[parsed.source_id]

        for rel in parsed.relations:
            target = None
            if rel['identifier']:
                ident = AgentIdentifier.query.filter_by(
                    scheme_id=eac_scheme.id, value=rel['identifier']).first()
                if ident:
                    target = ident.agent
            if not target and rel['name']:
                target = Agent.query.filter_by(
                    institution_id=institution_id,
                    name=rel['name'],
                ).first()

            if not target or target.id == agent_id:
                if rel['name'] and not target:
                    result.warnings.append(
                        f'Could not match relation "{rel["name"]}" '
                        f'for agent "{parsed.name}"'
                    )
                continue

            already = db.session.execute(
                sa.text(
                    'SELECT 1 FROM agent_to_agent_association '
                    'WHERE agent_id = :a AND related_agent_id = :b LIMIT 1'
                ),
                {'a': agent_id, 'b': target.id}
            ).first()

            if not already:
                rel_type = AgentRelationType.query.filter_by(
                    institution_id=institution_id,
                ).filter(
                    AgentRelationType.name.ilike(f'%{rel["relation_type"]}%')
                ).first()

                try:
                    db.session.execute(
                        sa.insert(agent_to_agent_association).values(
                            agent_id=agent_id,
                            related_agent_id=target.id,
                            relation_type_id=rel_type.id if rel_type else None,
                        )
                    )
                    db.session.flush()
                except Exception:
                    db.session.rollback()

    db.session.commit()
    return result