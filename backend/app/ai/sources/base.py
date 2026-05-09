from __future__ import annotations
from dataclasses import dataclass, field
from abc import ABC, abstractmethod


@dataclass
class SourceResult:
    source: str           # e.g. 'wikidata', 'wikipedia'
    label: str            # human-readable source name
    url: str              # canonical URL for citation
    text: str             # plain-text content to inject into prompt
    structured: dict      # raw structured data for further processing
    language: str         # language of the content returned


class SourceFetchError(Exception):
    def __init__(self, source: str, reason: str):
        self.source = source
        self.reason = reason
        super().__init__(f'{source}: {reason}')


class BaseSource(ABC):
    def __init__(self, language: str = 'en'):
        self.language = language

    @abstractmethod
    def fetch(self, query: str) -> SourceResult:
        """Fetch context for query. Raises SourceFetchError on failure."""
        ...