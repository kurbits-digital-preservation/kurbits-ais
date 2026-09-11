import styles from './FileFilters.module.css'

// Common formats offered as quick picks; the archivist can also leave blank.
const MIME_PRESETS = [
  { value: '', label: 'Any format' },
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
  const active =
    ['file_mime', 'file_pronom', 'file_min_size', 'file_has_checksum', 'file_min_width']
    .some(k => params.has(k))

  return (
    <div className={styles.fileFilters}>
      <div className={styles.title}>
        File filters
        {active && (
          <button className={styles.clear} onClick={() =>
            ['file_mime','file_pronom','file_min_size','file_max_size','file_has_checksum','file_min_width','file_min_height']
              .forEach(clearParam)}>
            clear
          </button>
        )}
      </div>

      <label className={styles.field}>
        <span>Format</span>
        <select
          value={params.get('file_mime') ?? ''}
          onChange={e => e.target.value ? setParam('file_mime', e.target.value) : clearParam('file_mime')}
        >
          {MIME_PRESETS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </label>

      <label className={styles.field}>
        <span>PRONOM id</span>
        <input
          value={params.get('file_pronom') ?? ''}
          onChange={e => e.target.value ? setParam('file_pronom', e.target.value) : clearParam('file_pronom')}
          placeholder="e.g. fmt/41"
        />
      </label>

      <label className={styles.field}>
        <span>Min size (MB)</span>
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
        <span>Min width (px)</span>
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
        <span>Has checksum only</span>
      </label>
    </div>
  )
}
