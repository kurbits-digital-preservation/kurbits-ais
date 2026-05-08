from __future__ import annotations
from typing import Optional
import anthropic
from app.ai.providers.base import AIProvider, AIMessage


class AnthropicProvider(AIProvider):
    def __init__(self, api_key: str, model: str, base_url: Optional[str] = None):
        kwargs = {'api_key': api_key}
        if base_url:
            kwargs['base_url'] = base_url
        self._client = anthropic.Anthropic(**kwargs)
        self._model = model

    def complete(self, messages: list[AIMessage], system: Optional[str] = None,
                 max_tokens: int = 2048, temperature: float = 0.3) -> str:
        kwargs = {
            'model': self._model,
            'max_tokens': max_tokens,
            'temperature': temperature,
            'messages': [{'role': m.role, 'content': m.content} for m in messages],
        }
        if system:
            kwargs['system'] = system
        response = self._client.messages.create(**kwargs)
        return response.content[0].text

    def ping(self) -> bool:
        try:
            self.complete([AIMessage(role='user', content='Reply with the word OK only.')], max_tokens=10)
            return True
        except Exception:
            return False