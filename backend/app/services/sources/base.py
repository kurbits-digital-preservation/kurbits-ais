from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from typing import Any, ClassVar, Optional, Union

LText = Union[str, dict]
DEFAULT_LANG = 'en'


class SourceError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.message = message
        self.status = status


# ─── Value helpers ────────────────────────────────────────────────────

def localize(text: Optional[LText], lang: str) -> str:
    if text is None:
        return ''
    if isinstance(text, dict):
        return text.get(lang) or text.get(DEFAULT_LANG) or next(iter(text.values()), '')
    return str(text)


def is_empty(value: Any) -> bool:
    return value is None or value == '' or value == [] or value == {}


def resolve_path(obj: Any, path: Optional[str]) -> Any:
    if not path:
        return obj
    for key in str(path).strip().split('.'):
        if isinstance(obj, dict):
            obj = obj.get(key)
        elif isinstance(obj, list) and key.isdigit():
            idx = int(key)
            obj = obj[idx] if idx < len(obj) else None
        else:
            return None
        if obj is None:
            return None
    return obj


def to_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, list):
        parts = [to_text(v) for v in value]
        return '\n'.join(p for p in parts if p) or None
    if isinstance(value, dict):
        for key in ('label', 'name', 'title', 'value'):
            if value.get(key) not in (None, ''):
                return to_text(value[key])
        return json.dumps(value, ensure_ascii=False)
    return str(value).strip() or None


# ─── Declarations ─────────────────────────────────────────────────────

@dataclass(frozen=True)
class ConfigField:
    key: str
    label: LText
    type: str = 'text'               # text | url | textarea | json
    required: bool = False
    secret: bool = False
    default: Any = None
    help: Optional[LText] = None
    placeholder: Optional[str] = None

    def describe(self, lang: str) -> dict:
        return {
            'key': self.key,
            'label': localize(self.label, lang) or self.key,
            'type': self.type,
            'required': self.required,
            'secret': self.secret,
            'default': None if self.secret else self.default,
            'help': localize(self.help, lang) or None,
            'placeholder': self.placeholder,
        }


@dataclass(frozen=True)
class SourceKey:
    key: str
    label: LText
    group: Optional[LText] = None

    def describe(self, lang: str) -> dict:
        return {
            'key': self.key,
            'label': localize(self.label, lang) or self.key,
            'group': localize(self.group, lang) or None,
        }


@dataclass
class SearchHit:
    external_id: str
    label: str
    description: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class FetchedRecord:
    external_id: str
    label: str
    values: dict[str, Any] = field(default_factory=dict)
    source_url: Optional[str] = None


# ─── Plugin base ──────────────────────────────────────────────────────

class SourcePlugin:
    key: ClassVar[str] = ''
    version: ClassVar[str] = '1.0'
    label: ClassVar[LText] = ''
    description: ClassVar[LText] = ''
    search_hint: ClassVar[LText] = ''
    supports: ClassVar[frozenset] = frozenset({'node'})
    agent_types: ClassVar[frozenset] = frozenset()
    config_schema: ClassVar[tuple] = ()
    suggested_mappings: ClassVar[tuple] = ()
    suggested_agent_mappings: ClassVar[dict] = {}
    timeout: ClassVar[int] = 10

    def __init__(self, config: Optional[dict] = None):
        raw = config if isinstance(config, dict) else {}
        self.config = {
            f.key: raw.get(f.key) if not is_empty(raw.get(f.key)) else f.default
            for f in self.config_schema
        }

    @classmethod
    def describe(cls, lang: str) -> dict:
        return {
            'key': cls.key,
            'version': cls.version,
            'label': localize(cls.label, lang) or cls.key,
            'description': localize(cls.description, lang),
            'search_hint': localize(cls.search_hint, lang),
            'supports': sorted(cls.supports),
            'agent_types': sorted(cls.agent_types),
            'config_schema': [f.describe(lang) for f in cls.config_schema],
        }

    @classmethod
    def handles_agent_type(cls, agent_type: str) -> bool:
        return 'agent' in cls.supports and (not cls.agent_types or agent_type in cls.agent_types)

    # ─── To implement in each plugin ──────────────────────────────────

    def source_keys(self) -> list[SourceKey]:
        raise NotImplementedError

    def search(self, query: str) -> list[SearchHit]:
        raise NotImplementedError

    def fetch(self, external_id: str) -> FetchedRecord:
        raise NotImplementedError

    # ─── HTTP helpers ─────────────────────────────────────────────────

    def request_headers(self) -> dict:
        return {}

    def url(self, path: str) -> str:
        base = str(self.config.get('base_url') or '').rstrip('/')
        if not base:
            raise SourceError('Source has no base URL configured', 400)
        return f'{base}/{path.lstrip("/")}'

    @staticmethod
    def quote(value: Any) -> str:
        return urllib.parse.quote(str(value), safe='')

    def get_json(self, url: str, allow_missing: bool = False) -> Any:
        headers = {'User-Agent': 'Kurbits/1.0', 'Accept': 'application/json'}
        headers.update({str(k): str(v) for k, v in self.request_headers().items()})
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = resp.read().decode('utf-8').strip()
        except urllib.error.HTTPError as e:
            if allow_missing and e.code == 404:
                return None
            if e.code in (401, 403):
                raise SourceError('External API rejected the credentials', 502)
            raise SourceError(f'External API returned {e.code}', 502)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise SourceError(f'External API unreachable: {e}', 502)

        if not body:
            if allow_missing:
                return None
            raise SourceError('External API returned an empty response', 502)
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            raise SourceError('External API returned invalid JSON', 502)