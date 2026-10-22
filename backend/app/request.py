from flask import Request

STRING_ID_KEYS = {
    'wikidata_id', 'viaf_id', 'orcid_id', 'isni_id', 'oai_id', 'source_id',
    'external_id', 'pronom_id', 'task_bpmn_id', 'job_id', 'session_id', 'request_id',
}


def _is_id_key(key) -> bool:
    if not isinstance(key, str) or key in STRING_ID_KEYS:
        return False
    return key == 'id' or key.endswith('_id') or key.endswith('_ids')


def _coerce(value, key=None):
    if isinstance(value, dict):
        return {k: _coerce(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [_coerce(v, key) for v in value]
    if isinstance(value, str) and _is_id_key(key):
        stripped = value.strip()
        if stripped == '':
            return None
        if stripped.lstrip('-').isdigit():
            return int(stripped)
    return value


class CoercingRequest(Request):
    _coerced_json = None

    def get_json(self, force=False, silent=False, cache=True):
        if cache and self._coerced_json is not None:
            return self._coerced_json
        data = super().get_json(force=force, silent=silent, cache=cache)
        if data is None:
            return None
        coerced = _coerce(data)
        if cache:
            self._coerced_json = coerced
        return coerced
