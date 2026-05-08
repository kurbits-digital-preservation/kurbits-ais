from __future__ import annotations
from typing import Optional
import requests
from app.ai.providers.base import AIProvider, AIMessage

DEFAULT_BASE_URL = 'http://localhost:11434'


class OllamaProvider(AIProvider):
    def __init__(self, model: str, base_url: Optional[str] = None):
        self._model = model
        self._base_url = (base_url or DEFAULT_BASE_URL).rstrip('/')

    def complete(self, messages: list[AIMessage], system: Optional[str] = None,
                 max_tokens: int = 2048, temperature: float = 0.3) -> str:
        msgs = []
        if system:
            msgs.append({'role': 'system', 'content': system})
        msgs.extend({'role': m.role, 'content': m.content} for m in messages)

        response = requests.post(
            f'{self._base_url}/api/chat',
            json={
                'model': self._model,
                'messages': msgs,
                'stream': False,
                'options': {
                    'temperature': temperature,
                    'num_predict': max_tokens,
                },
            },
            timeout=120,
        )
        response.raise_for_status()
        return response.json()['message']['content']

    def ping(self) -> bool:
        try:
            requests.get(f'{self._base_url}/api/tags', timeout=5).raise_for_status()
            return True
        except Exception:
            return False