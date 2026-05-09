from flask import request
from flask_login import login_required, current_user
from app.api.v1 import bp
from app.api.v1.helpers import success, error, require_institution_admin
from app.extensions import db
from app.models.ai_config import InstitutionAIConfig


def _require_admin():
    if not current_user.active_institution_id:
        return error('No active institution', 400)
    if not (current_user.is_system_admin or current_user.is_institution_admin_of_active()):
        return error('Institution admin access required', 403)
    return None


def _serialize(config: InstitutionAIConfig) -> dict:
    return {
        'provider':    config.provider,
        'model':       config.model,
        'base_url':    config.base_url or '',
        'has_api_key': bool(config._api_key_encrypted),
        'options':     config.options or {},
        'is_enabled':  config.is_enabled,
        'language':    config.language,
        'updated_at':  config.updated_at.isoformat(),
    }


# GET /api/v1/ai/config
@bp.route('/ai/config', methods=['GET'])
@login_required
@require_institution_admin
def get_ai_config():
    config = InstitutionAIConfig.query.filter_by(
        institution_id=current_user.active_institution_id
    ).first()

    if not config:
        return success(None)

    return success(_serialize(config))


# PUT /api/v1/ai/config
@bp.route('/ai/config', methods=['PUT'])
@login_required
@require_institution_admin
def save_ai_config():

    data = request.get_json(silent=True) or {}

    provider = data.get('provider', '').strip()
    model = data.get('model', '').strip()
    base_url = data.get('base_url', '').strip() or None
    api_key = data.get('api_key', '').strip()   # empty string = no change
    options = data.get('options') or {}
    is_enabled = data.get('is_enabled', True)


    if not provider:
        return error('provider is required', 400)
    if not model:
        return error('model is required', 400)

    VALID_PROVIDERS = {'anthropic', 'openai', 'ollama', 'azure_openai'}
    if provider not in VALID_PROVIDERS:
        return error(f'provider must be one of: {", ".join(VALID_PROVIDERS)}', 400)

    if provider == 'azure_openai' and not base_url:
        return error('base_url (Azure endpoint) is required for azure_openai', 400)

    institution_id = current_user.active_institution_id
    config = InstitutionAIConfig.query.filter_by(institution_id=institution_id).first()

    if config is None:
        config = InstitutionAIConfig(institution_id=institution_id)
        db.session.add(config)

    config.provider = provider
    config.model = model
    config.base_url = base_url
    config.options = options
    config.is_enabled = is_enabled
    config.updated_by_id = current_user.id
    config.language = data.get('language', 'en') or 'en'

    # Only update the key if a new one was provided
    if api_key:
        config.api_key = api_key

    db.session.commit()
    return success(_serialize(config))


# POST /api/v1/ai/test
@bp.route('/ai/test', methods=['POST'])
@login_required
@require_institution_admin
def test_ai_config():

    config = InstitutionAIConfig.query.filter_by(
        institution_id=current_user.active_institution_id
    ).first()

    if not config:
        return error('No AI configuration found. Save a configuration first.', 400)

    try:
        from app.ai.providers.factory import get_provider
        provider = get_provider(config)
        ok = provider.ping()
        if ok:
            return success({'ok': True, 'message': 'Connection successful'})
        return error('Provider responded but ping returned False', 502)
    except Exception as e:
        return error(f'Connection failed: {str(e)}', 502)


# GET /api/v1/ai/status  (non-admin: just tells the frontend whether AI is enabled)
@bp.route('/ai/status', methods=['GET'])
@login_required
def get_ai_status():
    if not current_user.active_institution_id:
        return success({'enabled': False})

    config = InstitutionAIConfig.query.filter_by(
        institution_id=current_user.active_institution_id,
        is_enabled=True,
    ).first()

    return success({
        'enabled': config is not None,
        'provider': config.provider if config else None,
        'model': config.model if config else None,
    })

@bp.route('/ai/debug-ping', methods=['GET'])
@login_required
def debug_ping():
    import traceback
    config = InstitutionAIConfig.query.filter_by(
        institution_id=current_user.active_institution_id
    ).first()
    if not config:
        return success({'error': 'No config found'})
    return success({
        'provider': config.provider,
        'model': config.model,
        'base_url': config.base_url,
        'has_key': bool(config._api_key_encrypted),
    })

# POST /api/v1/ai/fetch-sources
@bp.route('/ai/fetch-sources', methods=['POST'])
@login_required
def fetch_sources():
    data = request.get_json(silent=True) or {}
    query = (data.get('query') or '').strip()
    requested = data.get('sources', ['wikidata', 'wikipedia'])

    if not query:
        return error('query is required', 400)

    config = InstitutionAIConfig.query.filter_by(
        institution_id=current_user.active_institution_id,
        is_enabled=True,
    ).first()

    language = config.language if config else 'en'

    from app.ai.sources.wikidata import WikidataSource
    from app.ai.sources.wikipedia import WikipediaSource
    from app.ai.sources.gather import gather_sources

    source_map = {
        'wikidata':  WikidataSource(language=language),
        'wikipedia': WikipediaSource(language=language),
    }

    active_sources = [source_map[s] for s in requested if s in source_map]
    gathered = gather_sources(active_sources, query)

    return success({
        'query':     query,
        'language':  language,
        'results': [
            {
                'source':     r.source,
                'label':      r.label,
                'url':        r.url,
                'text':       r.text,
                'structured': r.structured,
            }
            for r in gathered.results
        ],
        'errors': gathered.errors,
    })

# POST /api/v1/ai/generate-agent
@bp.route('/ai/generate-agent', methods=['POST'])
@login_required
def generate_agent():
    from app.ai.sources.wikidata import WikidataSource
    from app.ai.sources.wikipedia import WikipediaSource
    from app.ai.sources.gather import gather_sources
    from app.ai.providers.factory import get_provider_for_institution

    data = request.get_json(silent=True) or {}
    query        = (data.get('query') or '').strip()
    agent_type   = data.get('agent_type', 'person')
    current_form = data.get('current_form', {})   # existing form values for context
    sources_req  = data.get('sources', ['wikidata', 'wikipedia'])

    if not query:
        return error('query is required', 400)

    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    config = InstitutionAIConfig.query.filter_by(
        institution_id=institution_id,
        is_enabled=True,
    ).first()

    if not config:
        return error('AI is not configured for this institution', 400)

    # ── Fetch sources ─────────────────────────────────────────────────
    language = config.language or 'en'
    source_map = {
        'wikidata':  WikidataSource(language=language),
        'wikipedia': WikipediaSource(language=language),
    }
    active_sources = [source_map[s] for s in sources_req if s in source_map]
    gathered = gather_sources(active_sources, query)

    if not gathered.results:
        return error(
            f'No source data found for "{query}". '
            + (f'Errors: {gathered.errors[0]["reason"]}' if gathered.errors else ''),
            404,
        )

    # ── Build prompt ──────────────────────────────────────────────────
    system_prompt = _build_system_prompt(agent_type)
    user_message  = _build_user_message(query, agent_type, current_form, gathered.context_text)

    # ── Call LLM ─────────────────────────────────────────────────────
    try:
        provider = get_provider_for_institution(institution_id)
        from app.ai.providers.base import AIMessage
        raw = provider.complete(
            messages=[AIMessage(role='user', content=user_message)],
            system=system_prompt,
            max_tokens=1024,
            temperature=0.2,
        )
    except Exception as e:
        return error(f'LLM error: {str(e)}', 502)

    # ── Parse LLM response ────────────────────────────────────────────
    suggestions = _parse_suggestions(raw)
    if not suggestions:
        return error('LLM returned an unexpected format. Try again.', 502)

    return success({
        'suggestions': suggestions,
        'sources':     gathered.citations,
        'errors':      gathered.errors,
        'raw':         raw,   # useful during development
    })


# ── Prompt builders ───────────────────────────────────────────────────

def _build_system_prompt(agent_type: str) -> str:
    entity_label = {
        'person':       'person (individual human being)',
        'organization': 'corporate body or organization',
        'family':       'family',
        'software':     'software or system',
    }.get(agent_type, 'entity')

    return f"""You are an expert archivist creating authority records compliant with ISAD(G) and EAC-CPF standards.
    Your task is to generate a draft authority record for a {entity_label} based on provided source data.

    You MUST respond with ONLY a JSON object — no explanation, no markdown, no prose before or after.
    Only use facts that are present in the provided source data. Do not invent or hallucinate information.
    Keep all string values under 500 characters. Do not copy source text verbatim into field values.

    The JSON object must have exactly these keys (use null for unknown fields):
    {{
      "name": "Primary name (most commonly used form)",
      "authorized_form": "Authorized form of name per ISAD(G) — surname, forename for persons",
      "date_from": "Date of birth or founding — year only or YYYY-MM-DD if known",
      "date_to": "Date of death or dissolution — year only, YYYY-MM-DD, or null if still active",
      "description": "Biographical or organizational history note in 2-4 sentences, max 400 characters",
      "identifier": "Wikidata QID or other external identifier if present",
      "website": "Official website URL or null",
      "history_note": "Detailed history note suitable for an archival authority record, 3-6 sentences, max 500 characters"
    }}

    Respond with the JSON object only. No markdown. No explanation. Start your response with {{"""


def _build_user_message(query: str, agent_type: str, current_form: dict, context_text: str) -> str:
    parts = [f'Create an authority record for: {query} (type: {agent_type})']

    if any(current_form.values()):
        parts.append('\nExisting form values (incorporate and improve these):')
        for k, v in current_form.items():
            if v:
                parts.append(f'  {k}: {v}')

    parts.append(f'\n{context_text}')
    parts.append('\nRespond with the JSON object only.')
    return '\n'.join(parts)


def _parse_suggestions(raw: str) -> dict | None:
    import json, re, logging
    logging.warning(f'LLM RAW RESPONSE:\n{raw}')

    # Strip markdown fences
    clean = re.sub(r'```(?:json)?', '', raw).strip().rstrip('`').strip()

    # Find outermost { } block
    start = clean.find('{')
    end   = clean.rfind('}')
    if start == -1 or end == -1 or end <= start:
        return None

    candidate = clean[start:end + 1]

    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass

    # Second attempt: truncate each string value at 1000 chars and retry
    # This handles models that dump source text verbatim into a field
    truncated = re.sub(
        r'("(?:description|history_note)"\s*:\s*")(.*?)(")',
        lambda m: m.group(1) + m.group(2)[:1000].replace('\n', ' ') + m.group(3),
        candidate,
        flags=re.DOTALL,
    )
    try:
        return json.loads(truncated)
    except json.JSONDecodeError:
        pass

    # Third attempt: use a stricter prompt-level fix by extracting key-value pairs manually
    result = {}
    for key in ['name', 'authorized_form', 'date_from', 'date_to', 'description',
                'identifier', 'website', 'history_note']:
        pattern = rf'"{key}"\s*:\s*"((?:[^"\\]|\\.){{0,2000}})"'
        m = re.search(pattern, candidate, re.DOTALL)
        if m:
            try:
                result[key] = json.loads(f'"{m.group(1)}"')
            except Exception:
                result[key] = m.group(1)[:500]
    return result if result else None

@bp.route('/ai/draft-history-note', methods=['POST'])
@login_required
def draft_history_note():
    from app.ai.sources.resolver import resolve_identifier
    from app.ai.sources.base import SourceFetchError
    from app.ai.sources.wikipedia import WikipediaSource
    from app.ai.sources.gather import gather_sources
    from app.ai.providers.factory import get_provider_for_institution
    from app.ai.providers.base import AIMessage
    from app.models.agent import Agent
    from app.models.agent import agent_node_association
    from app.extensions import db
    import sqlalchemy as sa

    data = request.get_json(silent=True) or {}
    agent_id             = data.get('agent_id')
    extra_sources        = data.get('extra_sources', [])
    include_attachments  = data.get('include_attachments', False)

    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    agent = Agent.query.filter_by(id=agent_id, institution_id=institution_id).first()
    if not agent:
        return error('Agent not found', 404)

    if not agent.identifier:
        return error('This agent has no external identifier set.', 400)

    config = InstitutionAIConfig.query.filter_by(
        institution_id=institution_id, is_enabled=True,
    ).first()
    if not config:
        return error('AI is not configured for this institution', 400)

    language = config.language or 'en'

    # ── Primary source from identifier ───────────────────────────────
    try:
        primary = resolve_identifier(agent.identifier, language=language)
    except SourceFetchError as e:
        return error(str(e), 400)

    # ── Optional extra web sources ────────────────────────────────────
    extra = []
    errors = []
    if extra_sources:
        additional = []
        if 'wikipedia' in extra_sources:
            additional.append(WikipediaSource(language=language))
        if additional:
            gathered = gather_sources(additional, agent.name)
            extra    = gathered.results
            errors   = gathered.errors

    # ── Optional attachment text from linked nodes ────────────────────
    attachment_context = ''
    attachment_citations = []
    if include_attachments:
        # Get all node IDs this agent is linked to
        node_ids = db.session.execute(
            sa.select(agent_node_association.c.node_id).where(
                agent_node_association.c.agent_id == agent_id
            )
        ).scalars().all()

        all_texts = []
        for node_id in node_ids[:5]:   # cap at 5 nodes
            ctx, cits = _get_attachment_context(node_id, max_chars=3000)
            if ctx:
                all_texts.append(ctx)
                attachment_citations.extend(cits)

        if all_texts:
            attachment_context = '\n\n'.join(all_texts)

    # ── Build prompt ──────────────────────────────────────────────────
    all_sources = [primary] + extra
    context_parts = [s.text for s in all_sources]
    if attachment_context:
        context_parts.append(f'--- Extracted from linked archival files ---\n{attachment_context}')

    context = '\n\n'.join(context_parts)

    agent_type_label = agent.agent_type.value
    system = f"""You are an expert archivist writing history notes for authority records compliant with ISAD(G) and EAC-CPF standards.
Write a concise, factual history note for a {agent_type_label} authority record.
Use only facts present in the provided source data.
Write in prose, 3-5 sentences. Do not use bullet points or headers.
Do not start with the entity's name as the first word.
Respond with the history note text only — no preamble, no explanation."""

    user_message = f"""Write a history note for the following {agent_type_label}:

Name: {agent.name}
{f"Authorized form: {agent.authorized_form}" if agent.authorized_form else ""}
{f"Dates: {agent.date_from or '?'} – {agent.date_to or 'present'}" if agent.date_from or agent.date_to else ""}
Identifier: {agent.identifier}

Source data:
{context}

Write the history note now:"""

    try:
        provider = get_provider_for_institution(institution_id)
        draft = provider.complete(
            messages=[AIMessage(role='user', content=user_message)],
            system=system,
            max_tokens=512,
            temperature=0.3,
        ).strip()
    except Exception as e:
        return error(f'LLM error: {str(e)}', 502)

    all_citations = [{'label': s.label, 'url': s.url} for s in all_sources]
    all_citations.extend(attachment_citations)

    return success({
        'draft':   draft,
        'sources': all_citations,
        'errors':  errors,
    })

# POST /api/v1/ai/parse-search
@bp.route('/ai/parse-search', methods=['POST'])
@login_required
def parse_search():
    from app.ai.providers.factory import get_provider_for_institution
    from app.ai.providers.base import AIMessage
    import json, re

    data = request.get_json(silent=True) or {}
    query      = (data.get('query') or '').strip()
    levels     = data.get('levels', [])      # passed from frontend
    statuses   = ['draft', 'published', 'restricted']
    agent_types = ['person', 'organization', 'family', 'software']

    if not query:
        return error('query is required', 400)

    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    config = InstitutionAIConfig.query.filter_by(
        institution_id=institution_id,
        is_enabled=True,
    ).first()
    if not config:
        return error('AI not configured', 400)

    system = """You are a search query parser for an archival description system.
Parse the user's natural language query into structured search parameters.
Respond with ONLY a JSON object, no explanation, no markdown.

The JSON must have these keys (use null for anything not mentioned):
{
  "q": "keyword search terms — the core subject matter only, no filter words",
  "types": "nodes,agents" or "nodes" or "agents" or null,
  "status": one of the valid statuses or null,
  "level": one of the valid levels or null,
  "date_from": "YYYY-MM-DD" or "YYYY" or null,
  "date_to": "YYYY-MM-DD" or "YYYY" or null,
  "agent_type": one of the valid agent types or null,
  "interpretation": "one sentence explaining what you understood"
}

Rules:
- Strip filter language from q. "find fonds about textiles from 1920" → q = "textiles"
- date_from and date_to refer to the dates of the archival records, not today
- If the user says "before X" set date_to = X. "after X" sets date_from = X.
- If only a year is mentioned set both date_from and date_to to that year
- Only set fields that are clearly mentioned or strongly implied
- Respond with the JSON object only. Start your response with {"""

    levels_hint = f'Valid levels: {", ".join(levels)}' if levels else ''
    user_message = f"""Parse this search query:
"{query}"

Valid statuses: {", ".join(statuses)}
Valid agent types: {", ".join(agent_types)}
{levels_hint}

Return the JSON object now:"""

    try:
        provider = get_provider_for_institution(institution_id)
        raw = provider.complete(
            messages=[AIMessage(role='user', content=user_message)],
            system=system,
            max_tokens=256,
            temperature=0.1,
        )
    except Exception as e:
        return error(f'LLM error: {str(e)}', 502)

    # Parse response
    clean = re.sub(r'```(?:json)?|```', '', raw).strip()
    start = clean.find('{')
    end   = clean.rfind('}')
    if start == -1 or end == -1:
        return error('Could not parse LLM response', 502)

    try:
        parsed = json.loads(clean[start:end + 1])
    except json.JSONDecodeError:
        return error('Could not parse LLM response', 502)

    # Sanitise — only return known keys with non-null string values
    allowed_keys = {'q', 'types', 'status', 'level', 'date_from', 'date_to', 'agent_type', 'interpretation'}
    result = {
        k: str(v).strip()
        for k, v in parsed.items()
        if k in allowed_keys and v is not None and str(v).strip()
    }

    # Validate enums
    if 'status' in result and result['status'] not in statuses:
        del result['status']
    if 'agent_type' in result and result['agent_type'] not in agent_types:
        del result['agent_type']
    if 'types' in result and result['types'] not in ('nodes,agents', 'nodes', 'agents'):
        del result['types']
    if 'level' in result and levels and result['level'] not in levels:
        del result['level']

    return success(result)

# POST /api/v1/ai/smart-search
@bp.route('/ai/smart-search', methods=['POST'])
@login_required
def smart_search():
    from app.ai.providers.factory import get_provider_for_institution
    from app.ai.providers.base import AIMessage
    import json, re

    data = request.get_json(silent=True) or {}
    query  = (data.get('query') or '').strip()
    levels = data.get('levels', [])

    if not query:
        return error('query is required', 400)

    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    config = InstitutionAIConfig.query.filter_by(
        institution_id=institution_id, is_enabled=True,
    ).first()
    if not config:
        return error('AI not configured', 400)

    # ── Build capability spec for the LLM ────────────────────────────
    levels_str = ', '.join(f'"{l}"' for l in levels) if levels else '"Fonds", "Series", "File", "Item"'

    system = f"""You are a query planner for an archival description system.
Given a natural language query, produce a JSON array of API calls to answer it.
Respond with ONLY a JSON array. No explanation. No markdown. Start with [

Available endpoints:

1. search — full-text search across nodes and agents
   params: q (string), types ("nodes,agents"|"nodes"|"agents"), status ("draft"|"published"|"restricted"), level (one of: {levels_str}), date_from (YYYY-MM-DD), date_to (YYYY-MM-DD), agent_type ("person"|"organization"|"family"|"software")
   use for: keyword/subject searches

2. nodes — list/filter archival resources
   params: q (string), status, level, date_from, date_to, has_scope_note ("true"|"false"), has_description ("true"|"false"), has_agents ("true"|"false"), has_attachments ("true"|"false"), no_date ("true"|"false"), per_page (number, max 100)
   use for: structural/property queries about resources

3. agents — list/filter authority records
   params: 
     has_website ("true"|"false") — filter by whether website field is set
     has_identifier ("true"|"false")
     has_description ("true"|"false")
     q (string) — name search
     type — ONLY set if user explicitly mentions a specific type. Values: "person", "organization", "family", "software"
     date_from, date_to, per_page (max 100)
   use for: queries about agents/authority records
   
   Examples:
    - "agents with a website" → [{{"endpoint": "agents", "params": {{"has_website": "true"}}, "interpretation": "All agents that have a website"}}]
    - "person agents with no identifier" → [{{"endpoint": "agents", "params": {{"type": "person", "has_identifier": "false"}}, "interpretation": "Person agents without an external identifier"}}]
    - "fonds about textiles" → [{{"endpoint": "search", "params": {{"q": "textiles", "level": "Fonds"}}, "interpretation": "Fonds related to textiles"}}]
    - "nodes without dates" → [{{"endpoint": "nodes", "params": {{"no_date": "true"}}, "interpretation": "Resources with no dates recorded"}}]

Rules:
- Use "search" for subject/keyword queries ("find fonds about textiles")
- Use "nodes" or "agents" for property/attribute queries ("agents with a website", "nodes without dates")
- You can include multiple calls if needed ("agents who are persons with a website")
- per_page defaults to 50 unless the user asks for a specific count
- interpretation: one plain sentence describing what you understood

Return format:
[
  {{"endpoint": "agents", "params": {{"has_website": "true", "type": "person"}}, "interpretation": "Person agents that have a website"}}
]"""

    user_message = f'Query: "{query}"\n\nReturn the JSON array now:'

    try:
        provider = get_provider_for_institution(institution_id)
        raw = provider.complete(
            messages=[AIMessage(role='user', content=user_message)],
            system=system,
            max_tokens=400,
            temperature=0.1,
        )
        import logging
        logging.warning(f'SMART SEARCH RAW:\n{raw}')
    except Exception as e:
        return error(f'LLM error: {str(e)}', 502)

    # ── Parse query plan ──────────────────────────────────────────────
    clean = re.sub(r'```(?:json)?|```', '', raw).strip()
    start = clean.find('[')
    end   = clean.rfind(']')
    if start == -1 or end == -1:
        return error('LLM returned unexpected format', 502)

    try:
        plan = json.loads(clean[start:end + 1])
    except json.JSONDecodeError:
        return error('LLM returned invalid JSON', 502)

    if not isinstance(plan, list) or not plan:
        return error('LLM returned empty plan', 502)

    # ── Execute plan ──────────────────────────────────────────────────
    results = []
    interpretation = ''
    errors = []

    for step in plan[:3]:   # cap at 3 calls
        endpoint   = step.get('endpoint')
        params     = step.get('params', {})
        if not interpretation:
            interpretation = step.get('interpretation', '')

        try:
            if endpoint == 'search':
                step_results = _execute_search(params, institution_id)
            elif endpoint == 'nodes':
                step_results = _execute_nodes(params, institution_id)
            elif endpoint == 'agents':
                step_results = _execute_agents(params, institution_id)
            else:
                errors.append(f'Unknown endpoint: {endpoint}')
                continue
            results.extend(step_results)
        except Exception as e:
            errors.append(f'{endpoint}: {str(e)}')

    # Deduplicate by type+id
    seen = set()
    unique = []
    for r in results:
        key = (r['type'], r['id'])
        if key not in seen:
            seen.add(key)
            unique.append(r)

    return success({
        'results':        unique,
        'total':          len(unique),
        'interpretation': interpretation,
        'plan':           plan,
        'errors':         errors,
    })


# ── Internal executors ────────────────────────────────────────────────

def _execute_search(params: dict, institution_id: int) -> list[dict]:
    from app.search import search as run_search
    q = params.get('q', '')
    if not q:
        return []
    filters = {k: v for k, v in params.items() if k != 'q'}
    per_page = int(params.get('per_page', 50))
    result = run_search(q, institution_id, filters=filters, limit=per_page, offset=0)
    out = []
    for item in result.get('results', []):
        if item.get('type') == 'node':
            out.append({
                'type': 'node', 'id': item['id'],
                'title': item.get('title', ''),
                'subtitle': item.get('ref_code', ''),
                'meta': item.get('level', ''),
                'status': item.get('status'),
            })
        else:
            out.append({
                'type': 'agent', 'id': item['id'],
                'title': item.get('name') or item.get('authorized_form', ''),
                'subtitle': item.get('agent_type', ''),
                'meta': None,
                'status': None,
            })
    return out


def _execute_nodes(params: dict, institution_id: int) -> list[dict]:
    from app.models.node import Node, NodeStatus, NodeAttachment
    import sqlalchemy as sa
    from app.extensions import db
    from app.api.v1.nodes.serializers import serialize_node_stub

    per_page = min(int(params.get('per_page', 50)), 100)
    query = sa.select(Node).where(Node.institution_id == institution_id)

    if params.get('q'):
        query = query.where(Node.title.ilike(f'%{params["q"]}%'))
    if params.get('status'):
        query = query.where(Node.status == params['status'])
    if params.get('level'):
        query = query.where(Node.level_of_description == params['level'])
    if params.get('date_from'):
        from datetime import datetime
        try:
            query = query.where(Node.date_start >= datetime.strptime(params['date_from'], '%Y-%m-%d').date())
        except ValueError:
            pass
    if params.get('date_to'):
        from datetime import datetime
        try:
            query = query.where(Node.date_end <= datetime.strptime(params['date_to'], '%Y-%m-%d').date())
        except ValueError:
            pass
    if params.get('has_scope_note') == 'true':
        query = query.where(Node.scope_and_content.isnot(None), Node.scope_and_content != '')
    if params.get('has_scope_note') == 'false':
        query = query.where(sa.or_(Node.scope_and_content.is_(None), Node.scope_and_content == ''))
    if params.get('has_description') == 'true':
        query = query.where(Node.description.isnot(None), Node.description != '')
    if params.get('has_description') == 'false':
        query = query.where(sa.or_(Node.description.is_(None), Node.description == ''))
    if params.get('has_agents') == 'true':
        from app.models.agent import agent_node_association as ana
        query = query.where(
            sa.exists(sa.select(ana.c.node_id).where(ana.c.node_id == Node.id))
        )
    if params.get('has_attachments') == 'true':
        query = query.where(
            sa.exists(sa.select(NodeAttachment.id).where(NodeAttachment.node_id == Node.id))
        )
    if params.get('no_date') == 'true':
        query = query.where(Node.date_start.is_(None), Node.date_end.is_(None))

    nodes = db.session.execute(query.order_by(Node.ref_code).limit(per_page)).scalars().all()
    return [{
        'type': 'node', 'id': n.id,
        'title': n.title, 'subtitle': n.ref_code,
        'meta': n.level_of_description, 'status': n.status.value,
    } for n in nodes]


def _execute_agents(params: dict, institution_id: int) -> list[dict]:
    from app.models.agent import Agent, AgentType
    import sqlalchemy as sa
    from app.extensions import db

    per_page = min(int(params.get('per_page', 50)), 100)
    query = sa.select(Agent).where(Agent.institution_id == institution_id)

    if params.get('q'):
        query = query.where(Agent.name.ilike(f'%{params["q"]}%'))
    if params.get('type'):
        query = query.where(Agent.agent_type == params['type'])
    if params.get('has_website') == 'true':
        query = query.where(Agent.website.isnot(None), Agent.website != '')
    if params.get('has_website') == 'false':
        query = query.where(sa.or_(Agent.website.is_(None), Agent.website == ''))
    if params.get('has_identifier') == 'true':
        query = query.where(Agent.identifier.isnot(None), Agent.identifier != '')
    if params.get('has_identifier') == 'false':
        query = query.where(sa.or_(Agent.identifier.is_(None), Agent.identifier == ''))
    if params.get('has_description') == 'true':
        query = query.where(Agent.description.isnot(None), Agent.description != '')
    if params.get('has_description') == 'false':
        query = query.where(sa.or_(Agent.description.is_(None), Agent.description == ''))
    if params.get('date_from'):
        query = query.where(Agent.date_from >= params['date_from'])
    if params.get('date_to'):
        query = query.where(sa.or_(Agent.date_to <= params['date_to'], Agent.date_to.is_(None)))

    agents = db.session.execute(query.order_by(Agent.name).limit(per_page)).scalars().all()
    return [{
        'type': 'agent', 'id': a.id,
        'title': a.name, 'subtitle': a.agent_type.value,
        'meta': a.identifier or a.website or None,
        'status': None,
    } for a in agents]

# ── Attachment text helpers ───────────────────────────────────────────

def _get_attachment_context(node_id: int, max_chars: int = 8000) -> tuple[str, list[dict]]:
    """
    Collect extracted text from all attachments on a node.
    Returns (context_text, citations_list).
    Truncates to max_chars to avoid blowing the context window.
    """
    from app.models.node import NodeAttachment
    import sqlalchemy as sa
    from app.extensions import db

    attachments = db.session.execute(
        sa.select(NodeAttachment).where(
            NodeAttachment.node_id == node_id,
            NodeAttachment.extracted_text.isnot(None),
            NodeAttachment.extracted_text != '',
        ).order_by(NodeAttachment.uploaded_at)
    ).scalars().all()

    if not attachments:
        return '', []

    citations = []
    parts = []
    remaining = max_chars

    for att in attachments:
        text = att.extracted_text or ''
        if not text or remaining <= 0:
            break
        chunk = text[:remaining]
        if len(text) > remaining:
            chunk += '… [truncated]'
        parts.append(
            f'--- File: {att.original_filename} ---\n{chunk}'
        )
        remaining -= len(chunk)
        citations.append({
            'label': att.original_filename,
            'url':   None,
            'type':  'attachment',
        })

    context = '\n\n'.join(parts)
    return context, citations


# POST /api/v1/ai/draft-node-note
@bp.route('/ai/draft-node-note', methods=['POST'])
@login_required
def draft_node_note():
    from app.ai.providers.factory import get_provider_for_institution
    from app.ai.providers.base import AIMessage
    from app.models.node import Node

    data = request.get_json(silent=True) or {}
    node_id   = data.get('node_id')
    note_type = data.get('note_type', 'scope_and_content')
    # note_type: 'scope_and_content' | 'arrangement' | 'general'

    institution_id = current_user.active_institution_id
    if not institution_id:
        return error('No active institution', 400)

    node = Node.query.filter_by(id=node_id, institution_id=institution_id).first()
    if not node:
        return error('Node not found', 404)

    config = InstitutionAIConfig.query.filter_by(
        institution_id=institution_id, is_enabled=True,
    ).first()
    if not config:
        return error('AI is not configured for this institution', 400)

    # ── Collect attachment text ───────────────────────────────────────
    attachment_context, citations = _get_attachment_context(node_id, max_chars=10000)

    if not attachment_context:
        return error(
            'No extracted text found on this node\'s attachments. '
            'Run OCR or Whisper transcription first.', 400
        )

    # ── Existing node context ─────────────────────────────────────────
    node_context_parts = [
        f'Title: {node.title}',
        f'Reference code: {node.ref_code}',
        f'Level: {node.level_of_description}',
    ]
    if node.date_start or node.date_end:
        node_context_parts.append(
            f'Dates: {node.date_start or "?"} – {node.date_end or "present"}'
        )
    if node.description:
        node_context_parts.append(f'Existing description: {node.description}')

    node_context = '\n'.join(node_context_parts)

    # ── Prompt by note type ───────────────────────────────────────────
    NOTE_TYPE_INSTRUCTIONS = {
        'scope_and_content': (
            'Write a scope and content note compliant with ISAD(G) element 3.3.1. '
            'Describe what the records contain, their subject matter, document types, '
            'and any significant persons, organisations, or events documented. '
            '3-6 sentences in prose.'
        ),
        'arrangement': (
            'Write an arrangement note compliant with ISAD(G) element 3.3.4. '
            'Describe how the records are organised, any series or sub-series, '
            'and the filing system used. 2-4 sentences in prose.'
        ),
        'general': (
            'Write a general note suitable for an archival description. '
            '3-5 sentences in prose.'
        ),
    }

    instruction = NOTE_TYPE_INSTRUCTIONS.get(note_type, NOTE_TYPE_INSTRUCTIONS['general'])

    system = f"""You are an expert archivist writing descriptions compliant with ISAD(G) standards.
{instruction}
Use only facts present in the provided source material.
Do not invent, hallucinate, or assume information not in the source.
Respond with the note text only — no preamble, no explanation, no headers."""

    user_message = f"""Write a {note_type.replace('_', ' ')} note for the following archival record:

{node_context}

Content extracted from attached files:
{attachment_context}

Write the note now:"""

    try:
        provider = get_provider_for_institution(institution_id)
        draft = provider.complete(
            messages=[AIMessage(role='user', content=user_message)],
            system=system,
            max_tokens=600,
            temperature=0.3,
        ).strip()
    except Exception as e:
        return error(f'LLM error: {str(e)}', 502)

    return success({
        'draft':      draft,
        'note_type':  note_type,
        'sources':    citations,
        'char_count': len(attachment_context),
    })