import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer, ChevronDown, Loader2 } from 'lucide-react'
import { nodesApi, labelTemplatesApi } from '@/api'
import { useTranslation } from 'react-i18next'

const FORMAT_KEYS = [
  'standard_90x45',
  'avery_l7163',
  'avery_l7160',
  'box_portrait_70x100',
  'spine_portrait_40x150',
  'single',
  'single_portrait',
]

interface Props {
  nodeIds: number[]
  label?: string
}

export default function PrintLabelsButton({ nodeIds, label }: Props) {
  const { t } = useTranslation()
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
      setError(t('printLabels.failedToGenerate'))
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
          title={t('printLabels.printLabelsTitle', { count: nodeIds.length })}
        >
          {loading
            ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
            : <Printer size={13} />}
          {label ?? t('printLabels.printLabel')}
          {nodeIds.length > 1 && ` (${nodeIds.length})`}
        </button>
        <button
          className="btn btn-secondary btn-sm"
          style={{ borderRadius: '0 var(--radius-md) var(--radius-md) 0', padding: '0 6px' }}
          disabled={disabled}
          onClick={() => setOpen(v => !v)}
          title={t('printLabels.labelOptions')}
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
              <label>{t('printLabels.designTemplate')}</label>
              <select value={templateId ?? ''} onChange={e => setTemplateId(e.target.value ? parseInt(e.target.value) : null)}>
                <option value="">{t('printLabels.builtInLayout')}</option>
                {templates.map((tmpl: any) => (
                  <option key={tmpl.id} value={tmpl.id}>{tmpl.name}{tmpl.is_default ? ` (${t('printLabels.default')})` : ''}</option>
                ))}
              </select>
            </div>
          )}

          {!templateId && (
            <div className="form-group" style={{ margin: 0 }}>
              <label>{t('printLabels.labelFormat')}</label>
              <select value={format} onChange={e => setFormat(e.target.value)}>
                {FORMAT_KEYS.map(key => (
                  <option key={key} value={key}>{t(`printLabels.formats.${key}`)}</option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group" style={{ margin: 0 }}>
            <label>{t('printLabels.copiesPerLabel')}</label>
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
            {t('printLabels.includeDescendants')}
          </label>

          {error && (
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-danger)', margin: 0 }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <button className="btn btn-primary btn-sm" disabled={disabled} onClick={handlePrint}>
              <Printer size={13} /> {t('printLabels.generatePdf')}
            </button>
          </div>

          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)', margin: 0 }}>
            {t('printLabels.nodesSelected', { count: nodeIds.length })}
            {includeDescendants ? t('printLabels.plusDescendants') : ''}.{' '}
            {t('printLabels.pdfOpensNote')}
          </p>
        </div>
      )}
    </div>
  )
}