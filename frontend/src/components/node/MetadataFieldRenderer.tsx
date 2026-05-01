/**
 * Shared components for rendering metadata fields — used in both the
 * NodeForm (edit) and DetailsTab (read-only display).
 */
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
      return (
        <span className={styles.boolValue}>
          {value ? '✓ Yes' : '✗ No'}
        </span>
      )

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
          {vals.map(v => (
            <span key={v} className={styles.tag}>{v}</span>
          ))}
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
      return (
        <span style={{ whiteSpace: 'pre-wrap' }}>{String(value)}</span>
      )

    default:
      return <span>{String(value)}</span>
  }
}

// ─── Edit input ───────────────────────────────────────────────────────

interface MetadataFieldInputProps {
  field: MetadataField
  value: unknown
  onChange: (key: string, value: unknown) => void
}

export function MetadataFieldInput({ field, value, onChange }: MetadataFieldInputProps) {
  const strVal = value === undefined || value === null ? '' : String(value)

  const spanClass = field.type === 'textarea' ? 'full' : 'auto'

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
                    const next = checked
                      ? selected.filter(v => v !== opt)
                      : [...selected, opt]
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