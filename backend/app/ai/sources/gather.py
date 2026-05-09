from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field

from app.ai.sources.base import BaseSource, SourceResult, SourceFetchError


@dataclass
class GatherResult:
    results: list[SourceResult] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)   # {'source': ..., 'reason': ...}

    @property
    def context_text(self) -> str:
        """Formatted text block ready to inject into a prompt."""
        if not self.results:
            return ''
        parts = ['## External sources\n']
        for r in self.results:
            parts.append(f'### {r.label}\nSource: {r.url}\n\n{r.text}\n')
        return '\n'.join(parts)

    @property
    def citations(self) -> list[dict]:
        return [{'source': r.label, 'url': r.url} for r in self.results]


def gather_sources(
    sources: list[BaseSource],
    query: str,
    timeout: float = 15.0,
) -> GatherResult:
    """
    Run all sources in parallel. Failed sources are noted but don't
    prevent others from returning results.
    """
    result = GatherResult()

    if not sources:
        return result

    with ThreadPoolExecutor(max_workers=len(sources)) as executor:
        futures = {executor.submit(src.fetch, query): src for src in sources}

        for future in as_completed(futures, timeout=timeout):
            src = futures[future]
            try:
                result.results.append(future.result())
            except SourceFetchError as e:
                result.errors.append({'source': e.source, 'reason': e.reason})
            except Exception as e:
                result.errors.append({
                    'source': type(src).__name__,
                    'reason': f'Unexpected error: {str(e)}',
                })

    return result