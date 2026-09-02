import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer, ChevronDown, Loader2 } from 'lucide-react'
import { nodesApi, labelTemplatesApi } from '@/api'

const FORMATS = [
  { value: 'standard_90x45',       label: 'Standard arkivetikett (12/ark, 90×45 mm)' },
  { value: 'avery_l7163',          label: 'Avery L7163 (14/ark, 99×38 mm)' },
  { value: 'avery_l7160',          label: 'Avery L7160 (21/ark, 64×38 mm)' },
  { value: 'box_portrait_70x100',  label: 'Arkivbox (6/ark, 70×100 mm)' },
  { value: 'spine_portrait_40x150',label: 'Ryggetikett (4/ark, 40×150 mm)' },
  { value: 'single',               label: 'Enskild etikett (A4 helsida)' },
  { value: 'single_portrait',      label: 'Enskild stående (A4)' },
]

interface Props {
  nodeIds: number[]
  label?: string
}

export default function PrintLabelsButton({ nodeIds, label }: Props) {
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState('standard_90x45')
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [copies, setCopies] = useState(1)
  const [includeDescendants, setIncludeDescendants] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const { data: templates } = useQuery({
    queryKey: ['label-templates'],
    queryFn: () => labelTemplatesApi.list().then(r => r.data.data),
  })

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handlePrint = async () => {
    if (!nodeIds.length) return
    setLoading(true)
    setError('')
    try {
      const res = await nodesApi.printLabels(nodeIds, format, copies, includeDescendants, templateId)
      const blob = new Blob([res.data as BlobPart], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `labels_${nodeIds.length === 1 ? nodeIds[0] : 'batch'}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      setOpen(false)
    } catch (e: any) {
      setError('Failed to generate labels')
    } finally {
      setLoading(false)
    }
  }

  const disabled = !nodeIds.length || loading

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={ref}>
      <div style={{ display: 'flex' }}>
        <button
          className="btn btn-secondary btn-sm"
          style={{ borderRadius: 'var(--radius-md) 0 0 var(--radius-md)', borderRight: 'none' }}
          disabled={disabled}
          onClick={handlePrint}
          title={`Print label${nodeIds.length !== 1 ? 's' : ''} for ${nodeIds.length} item${nodeIds.length !== 1 ? 's' : ''}`}
        >
          {loading
            ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
            : <Printer size={13} />}
          {label ?? 'Print label'}
          {nodeIds.length > 1 && ` (${nodeIds.length})`}
        </button>
        <button
          className="btn btn-secondary btn-sm"
          style={{ borderRadius: '0 var(--radius-md) var(--radius-md) 0', padding: '0 6px' }}
          disabled={disabled}
          onClick={() => setOpen(v => !v)}
          title="Label options"
        >
          <ChevronDown size={12} />
        </button>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, zIndex: 300,
          marginTop: 4, width: 300,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-xl)',
          padding: 'var(--space-4)',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
        }}>
          {templates && templates.length > 0 && (
            <div className="form-group" style={{ margin: 0 }}>
              <label>Design template</label>
              <select value={templateId ?? ''} onChange={e => setTemplateId(e.target.value ? parseInt(e.target.value) : null)}>
                <option value="">Built-in layout</option>
                {templates.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (default)' : ''}</option>
                ))}
              </select>
            </div>
          )}

          {!templateId && (
            <div className="form-group" style={{ margin: 0 }}>
              <label>Label format</label>
              <select value={format} onChange={e => setFormat(e.target.value)}>
                {FORMATS.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group" style={{ margin: 0 }}>
            <label>Copies per label</label>
            <input
              type="number" min={1} max={10} value={copies}
              onChange={e => setCopies(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
              style={{ width: 80 }}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={includeDescendants}
              onChange={e => setIncludeDescendants(e.target.checked)}
            />
            Include all descendants
          </label>

          {error && (
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-danger)', margin: 0 }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" disabled={disabled} onClick={handlePrint}>
              <Printer size={13} /> Generate PDF
            </button>
          </div>

          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)', margin: 0 }}>
            {nodeIds.length} node{nodeIds.length !== 1 ? 's' : ''} selected
            {includeDescendants ? ' + descendants' : ''}.
            PDF opens for printing or download.
          </p>
        </div>
      )}
    </div>
  )
}