import { useState } from 'react'
import { Search, CheckCircle, XCircle, ChevronRight, Loader } from 'lucide-react'
import styles from './AuthorityLookup.module.css'

// ─── Types ────────────────────────────────────────────────────────────

export interface AuthorityResult {
  name: string
  authorized_form?: string
  agent_type?: 'person' | 'organization' | 'family' | 'software'
  date_from?: string
  date_to?: string
  description?: string
  identifier: string
  website?: string
  source: 'wikidata' | 'viaf' | 'orcid'
  source_url: string
}

// ─── Detect identifier type ───────────────────────────────────────────

type IdentifierType = 'wikidata' | 'viaf' | 'orcid' | null

function detectType(raw: string): { type: IdentifierType; normalised: string } {
  const s = raw.trim()

  // Wikidata QID: Q followed by digits
  if (/^Q\d+$/i.test(s)) {
    return { type: 'wikidata', normalised: s.toUpperCase() }
  }

  // ORCID: 0000-XXXX-XXXX-XXXX (with or without URL prefix)
  const orcidMatch = s.match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/)
  if (orcidMatch) {
    return { type: 'orcid', normalised: orcidMatch[1] }
  }

  // VIAF: numeric only (typically 8–22 digits)
  if (/^\d{6,22}$/.test(s)) {
    return { type: 'viaf', normalised: s }
  }

  // VIAF URL
  const viafMatch = s.match(/viaf\.org\/viaf\/(\d+)/)
  if (viafMatch) {
    return { type: 'viaf', normalised: viafMatch[1] }
  }

  return { type: null, normalised: s }
}

// ─── Wikidata lookup ──────────────────────────────────────────────────

async function lookupWikidata(qid: string): Promise<AuthorityResult> {
  const url =
    `https://www.wikidata.org/w/api.php?action=wbgetentities` +
    `&ids=${qid}&languages=en&props=labels|descriptions|claims&format=json&origin=*`

  const res = await fetch(url)
  if (!res.ok) throw new Error('Wikidata request failed')
  const data = await res.json()

  const entity = data.entities?.[qid]
  if (!entity || entity.missing !== undefined) throw new Error('Not found on Wikidata')

  const label = entity.labels?.en?.value ?? ''
  const description = entity.descriptions?.en?.value ?? ''
  const claims = entity.claims ?? {}

  // P31 = instance of — determine type
  const instanceOf = claims.P31?.[0]?.mainsnak?.datavalue?.value?.id
  let agent_type: AuthorityResult['agent_type'] = 'person'
  const ORG_TYPES = ['Q43229', 'Q4830453', 'Q3918', 'Q7210356', 'Q15911314',
                     'Q783794', 'Q7188', 'Q2659904', 'Q748019']
  if (instanceOf && ORG_TYPES.includes(instanceOf)) agent_type = 'organization'

  // P569 = date of birth, P570 = date of death
  // P571 = inception, P576 = dissolved
  const birthClaim = claims.P569?.[0]?.mainsnak?.datavalue?.value
  const deathClaim = claims.P570?.[0]?.mainsnak?.datavalue?.value
  const inceptionClaim = claims.P571?.[0]?.mainsnak?.datavalue?.value
  const dissolvedClaim = claims.P576?.[0]?.mainsnak?.datavalue?.value

  const toYear = (v: any) => v?.time?.replace(/^\+/, '').slice(0, 4) ?? ''

  const fromClaim = agent_type === 'person' ? birthClaim : inceptionClaim
  const toClaim = agent_type === 'person' ? deathClaim : dissolvedClaim

  // P856 = official website
  const website = claims.P856?.[0]?.mainsnak?.datavalue?.value ?? ''

  return {
    name: label,
    authorized_form: label,
    agent_type,
    date_from: toYear(fromClaim),
    date_to: toYear(toClaim),
    description,
    identifier: `wikidata:${qid}`,
    website,
    source: 'wikidata',
    source_url: `https://www.wikidata.org/wiki/${qid}`,
  }
}

// ─── VIAF lookup ──────────────────────────────────────────────────────

async function lookupVIAF(viafId: string): Promise<AuthorityResult> {
  const url = `https://viaf.org/viaf/${viafId}/viaf.json`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Not found on VIAF')
  const data = await res.json()

  // Preferred name — try mainHeadings first
  let name = ''
  const headings = data.mainHeadings?.data
  if (Array.isArray(headings) && headings.length > 0) {
    name = headings[0].text ?? ''
  } else if (typeof headings === 'object' && headings?.text) {
    name = headings.text
  }

  if (!name && data.nameType === 'Personal') {
    const pn = data.mainHeadings?.data?.[0]
    name = pn?.text ?? ''
  }

  // Type
  let agent_type: AuthorityResult['agent_type'] = 'person'
  if (data.nameType === 'Corporate') agent_type = 'organization'
  else if (data.nameType === 'Geographic') agent_type = 'organization'

  // Dates
  const dates = data.birthDate ?? ''
  const deathDate = data.deathDate ?? ''

  return {
    name: name || `VIAF ${viafId}`,
    authorized_form: name || undefined,
    agent_type,
    date_from: dates || undefined,
    date_to: deathDate || undefined,
    identifier: `viaf:${viafId}`,
    source: 'viaf',
    source_url: `https://viaf.org/viaf/${viafId}`,
  }
}

// ─── ORCID lookup ─────────────────────────────────────────────────────

async function lookupORCID(orcidId: string): Promise<AuthorityResult> {
  const url = `https://pub.orcid.org/v3.0/${orcidId}/person`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error('Not found on ORCID')
  const data = await res.json()

  const given = data.name?.['given-names']?.value ?? ''
  const family = data.name?.['family-name']?.value ?? ''
  const name = [given, family].filter(Boolean).join(' ')
  const creditName = data.name?.['credit-name']?.value

  const bio = data.biography?.content ?? ''
  const keywords = data.keywords?.keyword?.map((k: any) => k.content).join(', ') ?? ''

  const website =
    data['researcher-urls']?.['researcher-url']?.[0]?.url?.value ?? ''

  return {
    name: name || orcidId,
    authorized_form: creditName || name || undefined,
    agent_type: 'person',
    description: bio || (keywords ? `Keywords: ${keywords}` : undefined),
    identifier: `orcid:${orcidId}`,
    website,
    source: 'orcid',
    source_url: `https://orcid.org/${orcidId}`,
  }
}

// ─── Main lookup dispatcher ───────────────────────────────────────────

async function lookup(raw: string): Promise<AuthorityResult> {
  const { type, normalised } = detectType(raw)
  if (!type) throw new Error('Unrecognised identifier format')
  if (type === 'wikidata') return lookupWikidata(normalised)
  if (type === 'viaf') return lookupVIAF(normalised)
  if (type === 'orcid') return lookupORCID(normalised)
  throw new Error('Unknown type')
}

// ─── Source badge ─────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  wikidata: 'Wikidata',
  viaf: 'VIAF',
  orcid: 'ORCID',
}

const SOURCE_COLOURS: Record<string, string> = {
  wikidata: '#006699',
  viaf: '#8B4513',
  orcid: '#A6CE39',
}

// ─── Component ────────────────────────────────────────────────────────

interface AuthorityLookupProps {
  onApply: (result: AuthorityResult) => void
}

export default function AuthorityLookup({ onApply }: AuthorityLookupProps) {
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'found' | 'error'>('idle')
  const [result, setResult] = useState<AuthorityResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const { type } = detectType(input)

  const handleLookup = async () => {
    if (!input.trim()) return
    setStatus('loading')
    setResult(null)
    setErrorMsg('')
    try {
      const r = await lookup(input.trim())
      setResult(r)
      setStatus('found')
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Lookup failed')
      setStatus('error')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLookup()
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>Authority lookup</span>
        <span className={styles.hint}>
          Paste a Wikidata QID (Q12345), VIAF ID (123456789) or ORCID (0000-…)
        </span>
      </div>

      <div className={styles.inputRow}>
        <input
          className={styles.input}
          value={input}
          onChange={e => { setInput(e.target.value); setStatus('idle'); setResult(null) }}
          onKeyDown={handleKeyDown}
          placeholder="Q12345 · 123456789 · 0000-0001-2345-6789"
          spellCheck={false}
        />
        {type && (
          <span
            className={styles.sourceTag}
            style={{ background: SOURCE_COLOURS[type] }}
          >
            {SOURCE_LABELS[type]}
          </span>
        )}
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleLookup}
          disabled={!input.trim() || status === 'loading'}
        >
          {status === 'loading'
            ? <Loader size={13} className={styles.spinner} />
            : <Search size={13} />}
          Look up
        </button>
      </div>

      {status === 'error' && (
        <div className={styles.statusError}>
          <XCircle size={14} />
          <span>Not found — {errorMsg}</span>
        </div>
      )}

      {status === 'found' && result && (
        <div className={styles.resultCard}>
          <div className={styles.resultHeader}>
            <CheckCircle size={14} className={styles.foundIcon} />
            <span className={styles.resultSource}>
              Found on {SOURCE_LABELS[result.source]}
            </span>
            <a
              href={result.source_url}
              target="_blank"
              rel="noreferrer"
              className={styles.resultLink}
            >
              View record ↗
            </a>
          </div>

          <div className={styles.resultBody}>
            <div className={styles.resultName}>{result.name}</div>
            {result.authorized_form && result.authorized_form !== result.name && (
              <div className={styles.resultAuthorized}>{result.authorized_form}</div>
            )}
            <div className={styles.resultMeta}>
              {result.agent_type && (
                <span className={styles.resultTag}>{result.agent_type}</span>
              )}
              {(result.date_from || result.date_to) && (
                <span className={styles.resultDates}>
                  {result.date_from ?? '?'}
                  {result.date_to ? ` – ${result.date_to}` : ''}
                </span>
              )}
              <span className={styles.resultId}>{result.identifier}</span>
            </div>
            {result.description && (
              <p className={styles.resultDesc}>{result.description}</p>
            )}
          </div>

          <button
            className={styles.applyBtn}
            onClick={() => onApply(result)}
          >
            <ChevronRight size={14} /> Apply to form
          </button>
        </div>
      )}
    </div>
  )
}