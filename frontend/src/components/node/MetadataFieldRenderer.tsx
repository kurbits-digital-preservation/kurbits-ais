/**
 * Shared components for rendering metadata fields — used in both the
 * NodeForm (edit) and DetailsTab (read-only display).
 *
 * Integration (vocabulary) fields store their value as a JSON object:
 *   { label: "World War, 1939-1945", uri: "http://id.loc.gov/..." }
 * Plain-text fallback is handled gracefully for backwards compatibility.
 */
import { useState, useEffect, useRef } from 'react'
import { Search, Loader, X, ExternalLink } from 'lucide-react'
import api from '@/api/client'
import styles from './MetadataFieldRenderer.module.css'

export interface MetadataField {
  name: string
  label: string
  type: string
  required?: boolean
  placeholder?: string
  help_text?: string
  options?: string[]
  default_value?: string
  integration_id?: number
}

// ─── Vocab value shape ────────────────────────────────────────────────

export interface VocabValue {
  label: string
  uri?: string
}

/** Parse a stored value into a VocabValue, handling both JSON objects and plain strings. */
function parseVocabValue(value: unknown): VocabValue | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'object' && value !== null && 'label' in value) {
    return value as VocabValue
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && 'label' in parsed) {
        return parsed as VocabValue
      }
    } catch {
      // fall through — treat as plain label string
    }
    return { label: value }
  }
  return null
}

// ─── Read-only display ────────────────────────────────────────────────

interface MetadataFieldValueProps {
  field: MetadataField
  value: unknown
}

export function MetadataFieldValue({ field, value }: MetadataFieldValueProps) {
  if (value === undefined || value === null || value === '') return null

  switch (field.type) {
    case 'boolean':
      return <span className={styles.boolValue}>{value ? '✓ Yes' : '✗ No'}</span>

    case 'url':
      return (
        <a href={String(value)} target="_blank" rel="noreferrer" className={styles.urlValue}>
          {String(value)}
        </a>
      )

    case 'email':
      return (
        <a href={`mailto:${value}`} className={styles.urlValue}>
          {String(value)}
        </a>
      )

    case 'multiselect': {
      const vals: string[] = Array.isArray(value)
        ? value
        : String(value).split(',').map(v => v.trim()).filter(Boolean)
      return (
        <div className={styles.multiValues}>
          {vals.map(v => <span key={v} className={styles.tag}>{v}</span>)}
        </div>
      )
    }

    case 'date':
      try {
        return <span>{new Date(String(value)).toLocaleDateString('sv-SE')}</span>
      } catch {
        return <span>{String(value)}</span>
      }

    case 'textarea':
      return <span style={{ whiteSpace: 'pre-wrap' }}>{String(value)}</span>

    case 'integration': {
      const vocab = parseVocabValue(value)
      if (!vocab) return null
      return (
        <span className={styles.vocabValue}>
          <span className={styles.vocabLabel}>{vocab.label}</span>
          {vocab.uri && (
            <a
              href={vocab.uri}
              target="_blank"
              rel="noreferrer"
              className={styles.vocabUri}
              title={vocab.uri}
            >
              <ExternalLink size={11} />
              {vocab.uri}
            </a>
          )}
        </span>
      )
    }

    default:
      return <span>{String(value)}</span>
  }
}

// ─── Integration vocabulary search input ─────────────────────────────

interface IntegrationSearchInputProps {
  field: MetadataField
  value: unknown        // stored as VocabValue object or null
  onChange: (val: VocabValue | null) => void
}

function IntegrationSearchInput({ field, value, onChange }: IntegrationSearchInputProps) {
  const vocab       = parseVocabValue(value)
  const [query, setQuery]     = useState(vocab?.label ?? '')
  const [debouncedQ, setDQ]   = useState('')
  const [hits, setHits]       = useState<Array<{ label: string; uri?: string }>>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen]       = useState(false)
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Keep input text in sync when external value changes (e.g. form reset)
  useEffect(() => {
    setQuery(parseVocabValue(value)?.label ?? '')
  }, [JSON.stringify(value)])

  // Debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDQ(query.trim()), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  // Search
  useEffect(() => {
    if (!debouncedQ || debouncedQ.length < 2 || !field.integration_id) {
      setHits([]); setOpen(false); return
    }
    // Don't re-search if query matches already-committed label
    if (debouncedQ === (parseVocabValue(value)?.label ?? '')) {
      setHits([]); setOpen(false); return
    }
    setLoading(true)
    api.get<{ status: string; data: Record<string, any>[] }>(
      `/integrations/${field.integration_id}/search`,
      { params: { q: debouncedQ } }
    )
      .then(res => {
        const items = res.data.data ?? []
        setHits(items.map(item => ({
          label: item['name']       != null ? String(item['name'])       : '(unnamed)',
          uri:   item['identifier'] != null ? String(item['identifier']) : undefined,
        })))
        setOpen(items.length > 0)
      })
      .catch(() => setHits([]))
      .finally(() => setLoading(false))
  }, [debouncedQ, field.integration_id])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = (hit: { label: string; uri?: string }) => {
    setQuery(hit.label)
    onChange({ label: hit.label, uri: hit.uri })
    setHits([]); setOpen(false)
  }

  const clear = () => {
    setQuery('')
    onChange(null)
    setHits([]); setOpen(false)
  }

  const currentUri = parseVocabValue(value)?.uri

  return (
    <div className={styles.intSearchWrapper} ref={containerRef}>
      <div className={styles.intSearchRow}>
        {loading
          ? <Loader size={13} className={`${styles.intIcon} ${styles.intSpinner}`} />
          : <Search size={13} className={styles.intIcon} />
        }
        <input
          className={styles.intInput}
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            // If user clears the input manually, clear the stored value too
            if (!e.target.value) onChange(null)
          }}
          placeholder={field.placeholder ?? `Search ${field.label}…`}
          required={field.required}
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button type="button" className={styles.intClear} onClick={clear} tabIndex={-1}>
            <X size={12} />
          </button>
        )}
      </div>

      {/* Show linked URI below the input once a value is committed */}
      {currentUri && !open && (
        <a
          href={currentUri}
          target="_blank"
          rel="noreferrer"
          className={styles.intUri}
          title={currentUri}
        >
          <ExternalLink size={10} />
          {currentUri}
        </a>
      )}

      {open && hits.length > 0 && (
        <div className={styles.intDropdown}>
          {hits.map((hit, i) => (
            <button
              key={i}
              type="button"
              className={styles.intOption}
              onMouseDown={e => { e.preventDefault(); select(hit) }}
            >
              <span className={styles.intOptionLabel}>{hit.label}</span>
              {hit.uri && (
                <span className={styles.intOptionUri}>{hit.uri}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Edit input ───────────────────────────────────────────────────────

interface MetadataFieldInputProps {
  field: MetadataField
  value: unknown
  onChange: (key: string, value: unknown) => void
}

export function MetadataFieldInput({ field, value, onChange }: MetadataFieldInputProps) {
  const strVal = value === undefined || value === null ? '' : String(value)

  return (
    <div
      className="form-group"
      style={{ gridColumn: field.type === 'textarea' ? '1 / -1' : 'auto' }}
    >
      <label>
        {field.label}
        {field.required && <span style={{ color: 'var(--color-error)', marginLeft: 3 }}>*</span>}
      </label>

      {field.type === 'textarea' && (
        <textarea
          value={strVal}
          onChange={e => onChange(field.name, e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          required={field.required}
        />
      )}

      {field.type === 'boolean' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 'normal', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={value === true || value === 'true' || value === '1'}
            onChange={e => onChange(field.name, e.target.checked)}
            required={field.required}
          />
          {field.placeholder || field.label}
        </label>
      )}

      {field.type === 'select' && (
        <select
          value={strVal}
          onChange={e => onChange(field.name, e.target.value)}
          required={field.required}
        >
          <option value="">{field.placeholder ?? `Select ${field.label}…`}</option>
          {(field.options ?? []).map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )}

      {field.type === 'multiselect' && (
        <div className={styles.multiselectGrid}>
          {(field.options ?? []).map(opt => {
            const selected: string[] = Array.isArray(value)
              ? value as string[]
              : strVal ? strVal.split(',').map(v => v.trim()).filter(Boolean) : []
            const checked = selected.includes(opt)
            return (
              <label key={opt} className={styles.checkOption}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked ? selected.filter(v => v !== opt) : [...selected, opt]
                    onChange(field.name, next)
                  }}
                />
                {opt}
              </label>
            )
          })}
        </div>
      )}

      {field.type === 'date' && (
        <input
          type="date"
          value={strVal}
          onChange={e => onChange(field.name, e.target.value)}
          required={field.required}
        />
      )}

      {field.type === 'number' && (
        <input
          type="number"
          value={strVal}
          onChange={e => onChange(field.name, e.target.value)}
          placeholder={field.placeholder}
          required={field.required}
        />
      )}

      {field.type === 'url' && (
        <input
          type="url"
          value={strVal}
          onChange={e => onChange(field.name, e.target.value)}
          placeholder={field.placeholder ?? 'https://…'}
          required={field.required}
        />
      )}

      {field.type === 'email' && (
        <input
          type="email"
          value={strVal}
          onChange={e => onChange(field.name, e.target.value)}
          placeholder={field.placeholder ?? 'name@example.com'}
          required={field.required}
        />
      )}

      {field.type === 'integration' && (
        <IntegrationSearchInput
          field={field}
          value={value}
          onChange={vocab => onChange(field.name, vocab)}
        />
      )}

      {(field.type === 'text' || !field.type) && (
        <input
          type="text"
          value={strVal}
          onChange={e => onChange(field.name, e.target.value)}
          placeholder={field.placeholder}
          required={field.required}
        />
      )}

      {field.help_text && (
        <span className="form-hint">{field.help_text}</span>
      )}
    </div>
  )
}