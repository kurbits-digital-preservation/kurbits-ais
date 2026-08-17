from __future__ import annotations
from typing import Optional
from app.models.ai_config import InstitutionAIConfig
from app.ai.providers.base import AIProvider


def get_provider(config: InstitutionAIConfig) -> AIProvider:
    """Build the correct provider instance from a saved config."""
    provider = config.provider
    model = config.model
    api_key = config.api_key
    base_url = config.base_url
    options = config.options or {}

    if provider == 'anthropic':
        from app.ai.providers.anthropic_ import AnthropicProvider
        return AnthropicProvider(api_key=api_key, model=model, base_url=base_url or None)

    if provider == 'ollama':
        from app.ai.providers.ollama_ import OllamaProvider
        return OllamaProvider(model=model, base_url=base_url or None)


    raise ValueError(f'Unknown AI provider: {provider!r}')


def get_provider_for_institution(institution_id: int) -> Optional[AIProvider]:
    """
    Convenience: load config from DB and return a provider.
    Returns None if no config exists or AI is disabled.
    """
    config = InstitutionAIConfig.query.filter_by(
        institution_id=institution_id,
        is_enabled=True,
    ).first()
    if not config:
        return None
    return get_provider(config)

def get_provider_for_task(task_key: str, institution_id: int):
    """
    Get a provider for a specific task.
    Uses task-level model override if set, falls back to institution default.
    """
    from app.models.ai_config import InstitutionAIConfig
    from app.ai.tasks import get_model_for_task

    config = InstitutionAIConfig.query.filter_by(
        institution_id=institution_id,
        is_enabled=True,
    ).first()
    if not config:
        return None

    task_model = get_model_for_task(task_key, institution_id)
    if task_model:
        # Clone config with overridden model
        from app.models.ai_config import InstitutionAIConfig as C
        import copy
        overridden = copy.copy(config)
        overridden.model = task_model
        return get_provider(overridden)

    return get_provider(config)