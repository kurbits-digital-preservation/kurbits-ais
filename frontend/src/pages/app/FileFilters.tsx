import { useTranslation } from 'react-i18next'
import styles from './FileFilters.module.css'

// Common formats offered as quick picks; the archivist can also leave blank.
// Format names (JPEG, PDF, MP3, etc.) are universal acronyms, not translated.
const MIME_PRESETS = [
  { value: '', labelKey: 'search.fileFilters.anyFormat' },
  { value: 'image/jpeg', label: 'JPEG' },
  { value: 'image/tiff', label: 'TIFF' },
  { value: 'image/png', label: 'PNG' },
  { value: 'application/pdf', label: 'PDF' },
  { value: 'audio/mpeg', label: 'MP3' },
  { value: 'video/mp4', label: 'MP4' },
]

export default function FileFilters({ params, setParam, clearParam }: {
  params: URLSearchParams
  setParam: (k: string, v: string) => void
  clearParam: (k: string) => void
}) {
  const { t } = useTranslation()
  const active =
    ['file_mime', 'file_pronom', 'file_min_size', 'file_has_checksum', 'file_min_width']
    .some(k => params.has(k))

  return (
    <div className={styles.fileFilters}>
      <div className={styles.title}>
        {t('search.fileFilters.title')}
        {active && (
          <button className={styles.clear} onClick={() =>
            ['file_mime','file_pronom','file_min_size','file_max_size','file_has_checksum','file_min_width','file_min_height']
              .forEach(clearParam)}>
            {t('search.facets.clear')}
          </button>
        )}
      </div>

      <label className={styles.field}>
        <span>{t('search.fileFilters.format')}</span>
        <select
          value={params.get('file_mime') ?? ''}
          onChange={e => e.target.value ? setParam('file_mime', e.target.value) : clearParam('file_mime')}
        >
          {MIME_PRESETS.map(m => <option key={m.value} value={m.value}>{m.labelKey ? t(m.labelKey) : m.label}</option>)}
        </select>
      </label>

      <label className={styles.field}>
        <span>{t('search.fileFilters.pronomId')}</span>
        <input
          value={params.get('file_pronom') ?? ''}
          onChange={e => e.target.value ? setParam('file_pronom', e.target.value) : clearParam('file_pronom')}
          placeholder="e.g. fmt/41"
        />
      </label>

      <label className={styles.field}>
        <span>{t('search.fileFilters.minSizeMb')}</span>
        <input
          type="number" min={0}
          value={params.get('file_min_size') ? String(Number(params.get('file_min_size')) / 1048576) : ''}
          onChange={e => e.target.value
            ? setParam('file_min_size', String(Math.round(Number(e.target.value) * 1048576)))
            : clearParam('file_min_size')}
          placeholder="0"
        />
      </label>

      <label className={styles.field}>
        <span>{t('search.fileFilters.minWidthPx')}</span>
        <input
          type="number" min={0}
          value={params.get('file_min_width') ?? ''}
          onChange={e => e.target.value ? setParam('file_min_width', e.target.value) : clearParam('file_min_width')}
          placeholder="e.g. 3000"
        />
      </label>

      <label className={styles.checkboxField}>
        <input
          type="checkbox"
          checked={params.get('file_has_checksum') === 'true'}
          onChange={e => e.target.checked ? setParam('file_has_checksum', 'true') : clearParam('file_has_checksum')}
        />
        <span>{t('search.fileFilters.hasChecksumOnly')}</span>
      </label>
    </div>
  )
}
