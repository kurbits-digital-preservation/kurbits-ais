from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class AIMessage:
    role: str   # 'user' | 'assistant'
    content: str


class AIProvider(ABC):
    """Abstract LLM provider. All providers must implement complete()."""

    @abstractmethod
    def complete(
        self,
        messages: list[AIMessage],
        system: Optional[str] = None,
        max_tokens: int = 2048,
        temperature: float = 0.3,
    ) -> str:
        """Send messages and return the assistant's reply as a plain string."""
        ...

    @abstractmethod
    def ping(self) -> bool:
        """Send a trivial request to verify connectivity. Returns True on success."""
        ...