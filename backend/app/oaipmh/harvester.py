"""
OAI-PMH harvester for Kurbits.

Supports:
  - GetRecord: fetch a single record by OAI identifier
  - ListRecords: fetch a set filtered by set spec or date range
    (synchronous, capped at MAX_RECORDS for safety)

Metadata formats: oai_dc (Dublin Core), ead (EAD 2002)
"""
from __future__ import annotations
import urllib.request
import urllib.parse
from urllib.parse import quote, urlencode
from typing import Optional
from lxml import etree


OAI_NS   = 'http://www.openarchives.org/OAI/2.0/'
DC_NS    = 'http://purl.org/dc/elements/1.1/'
EAD_NS   = 'urn:isbn:1-931666-22-9'

MAX_RECORDS = 500


class OAIError(Exception):
    pass


class HarvestRecord:
    """A single harvested record, normalised from either oai_dc or ead."""

    def __init__(self):
        self.identifier: str = ''
        self.datestamp: str = ''
        self.deleted: bool = False


        self.title: str = ''
        self.description: Optional[str] = None
        self.scope_and_content: Optional[str] = None
        self.arrangement: Optional[str] = None
        self.date_from: Optional[str] = None
        self.date_to: Optional[str] = None
        self.extent: Optional[str] = None
        self.language: Optional[str] = None
        self.access_conditions: Optional[str] = None
        self.level: Optional[str] = None
        self.local_ref: str = ''
        self.creators: list[str] = []
        self.subjects: list[str] = []
        self.notes: list[dict] = []
        self.children: list['HarvestRecord'] = []


class HarvestResult:
    def __init__(self):
        self.records: list[HarvestRecord] = []
        self.warnings: list[str] = []
        self.source_url: str = ''
        self.metadata_prefix: str = ''
        self.total_fetched: int = 0

    def to_dict(self) -> dict:
        return {
            'source_url': self.source_url,
            'metadata_prefix': self.metadata_prefix,
            'total_fetched': self.total_fetched,
            'warnings': self.warnings,
            'records': [_record_summary(r) for r in self.records],
        }


def _record_summary(r: HarvestRecord) -> dict:
    return {
        'identifier': r.identifier,
        'title': r.title,
        'level': r.level,
        'local_ref': r.local_ref,
        'date_from': r.date_from,
        'date_to': r.date_to,
        'deleted': r.deleted,
    }




def _fetch_xml(url: str) -> etree._Element:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Kurbits-OAI-Harvester/1.0'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return etree.fromstring(resp.read())
    except Exception as e:
        raise OAIError(f'Failed to fetch {url}: {e}')


def _oai(tag: str) -> str:
    return f'{{{OAI_NS}}}{tag}'


def _find(el: etree._Element, tag: str) -> Optional[etree._Element]:
    return el.find(f'{{{OAI_NS}}}{tag}')


def _findall(el: etree._Element, tag: str) -> list[etree._Element]:
    return el.findall(f'{{{OAI_NS}}}{tag}')


def _check_oai_error(root: etree._Element) -> None:
    err = root.find(f'{{{OAI_NS}}}error')
    if err is not None:
        code = err.get('code', 'unknown')
        msg = err.text or code
        raise OAIError(f'OAI-PMH error [{code}]: {msg}')


def _build_url(base: str, **params) -> str:
    """Build OAI-PMH URL. Encodes spaces as %20 (not +) to preserve OAI identifiers."""
    clean = base.rstrip('?&')

    parts = []
    for k, v in params.items():
        if v is not None:

            key = k.rstrip('_')
            parts.append(f'{key}={quote(str(v), safe="/:@!$&'()*+,;=")}')
    return clean + '?' + '&'.join(parts)




def _text(el: Optional[etree._Element]) -> Optional[str]:
    if el is None:
        return None
    parts = []
    if el.text:
        parts.append(el.text.strip())
    for child in el:
        if child.text:
            parts.append(child.text.strip())
        if child.tail:
            parts.append(child.tail.strip())
    text = ' '.join(p for p in parts if p)
    return text or None


def _p_text(el: Optional[etree._Element]) -> Optional[str]:
    if el is None:
        return None
    ps = list(el)
    if ps:
        return '\n\n'.join(t for t in [_text(p) for p in ps] if t)
    return _text(el)


def _parse_dc_metadata(metadata_el: etree._Element, rec: HarvestRecord) -> None:
    dc = metadata_el[0] if len(metadata_el) else metadata_el

    def dc_texts(tag: str) -> list[str]:
        els = dc.findall(f'{{{DC_NS}}}{tag}')
        return [el.text.strip() for el in els if el.text and el.text.strip()]

    titles = dc_texts('title')
    rec.title = titles[0] if titles else '(untitled)'

    descs = dc_texts('description')
    rec.description = '\n\n'.join(descs) if descs else None

    creators = dc_texts('creator')
    rec.creators = creators

    subjects = dc_texts('subject')
    rec.subjects = subjects

    dates = dc_texts('date')
    if dates:
        raw = dates[0]
        if '/' in raw:
            parts = raw.split('/', 1)
            rec.date_from = parts[0][:4]
            rec.date_to = parts[1][:4]
        else:
            rec.date_from = raw[:4]

    languages = dc_texts('language')
    rec.language = languages[0] if languages else None

    formats = dc_texts('format')
    rec.extent = formats[0] if formats else None

    types = dc_texts('type')
    rec.level = types[0] if types else None

    identifiers = dc_texts('identifier')
    if identifiers:
        rec.local_ref = identifiers[-1].split('/')[-1]

    rights = dc_texts('rights')
    rec.access_conditions = rights[0] if rights else None


def _localname(tag: str) -> str:
    """Strip namespace from a tag."""
    return tag.split('}')[-1] if '}' in tag else tag


def _find_local(el: etree._Element, localname: str) -> etree._Element | None:
    """Find first child with given local name, ignoring namespace."""
    for child in el:
        if _localname(child.tag) == localname:
            return child
    return None


def _findall_local(el: etree._Element, localname: str) -> list:
    """Find all children with given local name, ignoring namespace."""
    return [child for child in el if _localname(child.tag) == localname]


def _find_deep_local(el: etree._Element, *localnames: str) -> etree._Element | None:
    """Find nested element by sequence of local names."""
    current = el
    for name in localnames:
        current = _find_local(current, name)
        if current is None:
            return None
    return current


def _parse_ead_metadata(metadata_el: etree._Element, rec: HarvestRecord,
                         result: HarvestResult) -> None:

    ead_el = None
    for el in [metadata_el] + list(metadata_el):
        if _localname(el.tag) == 'ead':
            ead_el = el
            break
    if ead_el is None and len(metadata_el):
        ead_el = metadata_el[0]
    if ead_el is None:
        result.warnings.append('EAD record has no parseable content')
        return

    archdesc = _find_local(ead_el, 'archdesc')
    if archdesc is None:
        result.warnings.append('EAD record has no archdesc')
        return

    rec.level = archdesc.get('level')

    did = _find_local(archdesc, 'did')
    if did is not None:
        title_el = _find_local(did, 'unittitle')
        rec.title = _text(title_el) or ''


        for uid in _findall_local(did, 'unitid'):
            text = (uid.text or '').strip()
            if text and not rec.local_ref:
                rec.local_ref = text


        date_el = _find_local(did, 'unitdate')
        if date_el is not None:
            normal = date_el.get('normal', '')
            if '/' in normal:
                parts = normal.split('/', 1)
                rec.date_from = parts[0][:4]
                rec.date_to = parts[1][:4]
            elif normal:
                rec.date_from = normal[:4]


        physdesc = _find_local(did, 'physdesc')
        if physdesc is not None:
            ext = _find_local(physdesc, 'extent')
            rec.extent = _text(ext) or _text(physdesc)


        langmaterial = _find_local(did, 'langmaterial')
        if langmaterial is not None:
            lang_el = _find_local(langmaterial, 'language')
            if lang_el is not None:
                rec.language = lang_el.text or lang_el.get('langcode') or ''
            else:
                rec.language = _text(langmaterial)


        for orig in _findall_local(did, 'origination'):
            name = _text(orig)
            if name:
                rec.creators.append(name)


    scope = _find_local(archdesc, 'scopecontent')
    rec.scope_and_content = _p_text(scope)

    arrangement = _find_local(archdesc, 'arrangement')
    rec.arrangement = _p_text(arrangement)

    access = _find_local(archdesc, 'accessrestrict')
    rec.access_conditions = _p_text(access)

    bioghist = _find_local(archdesc, 'bioghist')
    rec.description = _p_text(bioghist)

    for odd in _findall_local(archdesc, 'odd'):
        content = _p_text(odd)
        if content:
            rec.notes.append({'type': odd.get('type', 'general'), 'content': content})


    dsc = _find_local(archdesc, 'dsc')
    if dsc is not None:
        for child_el in dsc:
            local = _localname(child_el.tag)
            if local == 'c' or (local.startswith('c') and local[1:].isdigit()):
                rec.children.append(_parse_c_element(child_el, result))





def _parse_c_element(c_el: etree._Element, result: HarvestResult) -> 'HarvestRecord':
    """Parse a <c> component element into a HarvestRecord with children."""
    rec = HarvestRecord()
    rec.level = c_el.get('level') or c_el.get('otherlevel')

    did = _find_local(c_el, 'did')
    if did is not None:
        title_el = _find_local(did, 'unittitle')
        rec.title = _text(title_el) or ''

        for uid in _findall_local(did, 'unitid'):
            text = (uid.text or '').strip()
            if text and not rec.local_ref:
                rec.local_ref = text

        date_el = _find_local(did, 'unitdate')
        if date_el is not None:
            normal = date_el.get('normal', '')
            if '/' in normal:
                parts = normal.split('/', 1)
                rec.date_from = parts[0][:4]
                rec.date_to = parts[1][:4]
            elif normal:
                rec.date_from = normal[:4]

        physdesc = _find_local(did, 'physdesc')
        if physdesc is not None:
            ext = _find_local(physdesc, 'extent')
            rec.extent = _text(ext) or _text(physdesc)

        langmaterial = _find_local(did, 'langmaterial')
        if langmaterial is not None:
            lang_el = _find_local(langmaterial, 'language')
            rec.language = (lang_el.text if lang_el is not None else None) or _text(langmaterial)

        for orig in _findall_local(did, 'origination'):
            name = _text(orig)
            if name:
                rec.creators.append(name)

    scope = _find_local(c_el, 'scopecontent')
    rec.scope_and_content = _p_text(scope)

    arrangement = _find_local(c_el, 'arrangement')
    rec.arrangement = _p_text(arrangement)

    access = _find_local(c_el, 'accessrestrict')
    rec.access_conditions = _p_text(access)

    bioghist = _find_local(c_el, 'bioghist')
    rec.description = _p_text(bioghist)

    for odd in _findall_local(c_el, 'odd'):
        content = _p_text(odd)
        if content:
            rec.notes.append({'type': odd.get('type', 'general'), 'content': content})


    dsc = _find_local(c_el, 'dsc')
    children_container = dsc if dsc is not None else c_el
    for child_el in children_container:
        local = _localname(child_el.tag)
        if local == 'c' or (local.startswith('c') and local[1:].isdigit()):
            rec.children.append(_parse_c_element(child_el, result))

    return rec

def _parse_record(record_el: etree._Element, metadata_prefix: str,
                  result: HarvestResult) -> Optional[HarvestRecord]:
    header = _find(record_el, 'header')
    if header is None:
        return None

    rec = HarvestRecord()
    ident_el = _find(header, 'identifier')
    rec.identifier = ident_el.text.strip() if ident_el is not None and ident_el.text else ''
    date_el = _find(header, 'datestamp')
    rec.datestamp = date_el.text.strip() if date_el is not None and date_el.text else ''
    rec.deleted = header.get('status') == 'deleted'

    if rec.deleted:
        return rec

    metadata_el = _find(record_el, 'metadata')
    if metadata_el is None:
        result.warnings.append(f'Record {rec.identifier} has no metadata')
        return rec

    if 'ead' in metadata_prefix.lower():
        _parse_ead_metadata(metadata_el, rec, result)
    else:
        _parse_dc_metadata(metadata_el, rec)

    return rec




def get_record(base_url: str, identifier: str,
               metadata_prefix: str = 'oai_dc') -> HarvestResult:
    """Fetch a single record by OAI identifier."""
    result = HarvestResult()
    result.source_url = base_url
    result.metadata_prefix = metadata_prefix

    url = _build_url(base_url,
                     verb='GetRecord',
                     identifier=identifier,
                     metadataPrefix=metadata_prefix)
    root = _fetch_xml(url)
    _check_oai_error(root)

    get_record_el = _find(root, 'GetRecord')
    if get_record_el is None:
        raise OAIError('Response has no GetRecord element')

    record_el = _find(get_record_el, 'record')
    if record_el is None:
        raise OAIError('No record in response')

    rec = _parse_record(record_el, metadata_prefix, result)
    if rec:
        result.records.append(rec)
        result.total_fetched = 1

    return result


def list_records(base_url: str,
                 metadata_prefix: str = 'oai_dc',
                 set_spec: Optional[str] = None,
                 from_date: Optional[str] = None,
                 until_date: Optional[str] = None) -> HarvestResult:
    """
    Fetch records using ListRecords verb.
    Follows resumption tokens but caps at MAX_RECORDS.
    """
    result = HarvestResult()
    result.source_url = base_url
    result.metadata_prefix = metadata_prefix

    url = _build_url(base_url,
                     verb='ListRecords',
                     metadataPrefix=metadata_prefix,
                     set=set_spec,
                     from_=from_date,
                     until=until_date)

    while url and result.total_fetched < MAX_RECORDS:
        root = _fetch_xml(url)
        _check_oai_error(root)

        list_el = _find(root, 'ListRecords')
        if list_el is None:
            break

        for record_el in _findall(list_el, 'record'):
            if result.total_fetched >= MAX_RECORDS:
                result.warnings.append(
                    f'Reached maximum of {MAX_RECORDS} records. '
                    f'Use date filtering or set spec to narrow the harvest.'
                )
                return result
            rec = _parse_record(record_el, metadata_prefix, result)
            if rec:
                result.records.append(rec)
                result.total_fetched += 1


        token_el = list_el.find(f'{{{OAI_NS}}}resumptionToken')
        if token_el is not None and token_el.text and token_el.text.strip():
            url = _build_url(base_url,
                             verb='ListRecords',
                             resumptionToken=token_el.text.strip())
        else:
            url = None

    return result


def identify(base_url: str) -> dict:
    """
    Call the Identify verb — verify the endpoint and return repository info.
    Useful for validating a URL before attempting a harvest.
    """
    url = _build_url(base_url, verb='Identify')
    root = _fetch_xml(url)
    _check_oai_error(root)

    identify_el = _find(root, 'Identify')
    if identify_el is None:
        raise OAIError('Not a valid OAI-PMH endpoint')

    def field(tag: str) -> str:
        el = _find(identify_el, tag)
        return el.text.strip() if el is not None and el.text else ''

    return {
        'repository_name': field('repositoryName'),
        'base_url': field('baseURL'),
        'protocol_version': field('protocolVersion'),
        'earliest_datestamp': field('earliestDatestamp'),
        'admin_email': field('adminEmail'),
    }


def list_metadata_formats(base_url: str) -> list[dict]:
    """Return available metadata formats from the repository."""
    url = _build_url(base_url, verb='ListMetadataFormats')
    root = _fetch_xml(url)
    _check_oai_error(root)

    formats = []
    list_el = _find(root, 'ListMetadataFormats')
    if list_el:
        for fmt in _findall(list_el, 'metadataFormat'):
            prefix_el = _find(fmt, 'metadataPrefix')
            schema_el = _find(fmt, 'schema')
            formats.append({
                'prefix': prefix_el.text if prefix_el is not None else '',
                'schema': schema_el.text if schema_el is not None else '',
            })
    return formats