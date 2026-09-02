import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Type, Tag, Barcode, QrCode, Image as ImageIcon, Trash2, Save, Plus,
  Bold, AlignLeft, AlignCenter, AlignRight, Copy, Star,
} from 'lucide-react'
import { labelTemplatesApi, searchApi } from '@/api'
import { Spinner } from '@/components/ui'
import styles from './LabelDesigner.module.css'

// Physical label dimensions (mm) — must match labels.FORMATS on the backend.
const FORMAT_DIMS: Record<string, { w: number; h: number; label: string }> = {
  standard_90x45:       { w: 90,  h: 44.5, label: 'Standard arkivetikett 90×45 mm' },
  avery_l7163:          { w: 99.1, h: 38.1, label: 'Avery L7163 99×38 mm' },
  avery_l7160:          { w: 63.5, h: 38.1, label: 'Avery L7160 64×38 mm' },
  box_portrait_70x100:  { w: 70,  h: 100, label: 'Archive box 70×100 mm' },
  spine_portrait_40x150:{ w: 40,  h: 150, label: 'Spine 40×150 mm' },
  single:               { w: 190, h: 277, label: 'Single A4' },
  single_portrait:      { w: 190, h: 277, label: 'Single A4 (portrait sheet)' },
}

const FIELD_LABELS: Record<string, string> = {
  ref_code: 'Reference code', title: 'Title', level: 'Level', date: 'Date range',
  local_ref: 'Local ref', location: 'Location', institution: 'Institution',
  parent_ref_code: 'Parent ref code', parent_title: 'Parent title', parent_date: 'Parent date range',
}

// Generic placeholders shown by default — no misleading fake data.
const PLACEHOLDER: Record<string, string> = {
  ref_code: '{Reference code}', title: '{Title}', level: '{Level}',
  date: '{Date range}', local_ref: '{Local ref}', location: '{Location}',
  institution: '{Institution}',
  parent_ref_code: '{Parent ref code}', parent_title: '{Parent title}', parent_date: '{Parent date range}',
}

interface El {
  id: string
  type: 'field' | 'text' | 'barcode' | 'qr' | 'image'
  field?: string
  text?: string
  image_data?: string
  x: number; y: number; w: number; h: number
  font_size?: number
  bold?: boolean
  align?: 'left' | 'center' | 'right'
  color?: string
  rotation?: number
}

let idCounter = 1
const newId = () => `el_${idCounter++}_${Math.random().toString(36).slice(2, 6)}`

function renderElContent(el: El, sample: Record<string, string> | null): string {
  if (el.type === 'field') {
    const f = el.field || ''
    if (sample) return sample[f] || PLACEHOLDER[f] || ''
    return PLACEHOLDER[f] || FIELD_LABELS[f] || ''
  }
  if (el.type === 'text') return el.text || 'Text'
  return ''
}

export default function LabelDesigner() {
  const queryClient = useQueryClient()
  const canvasRef = useRef<HTMLDivElement>(null)
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [name, setName] = useState('New label')
  const [formatKey, setFormatKey] = useState('standard_90x45')
  const [isDefault, setIsDefault] = useState(false)
  const [elements, setElements] = useState<El[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showGrid, setShowGrid] = useState(true)
  const [previewQuery, setPreviewQuery] = useState('')
  const [previewSample, setPreviewSample] = useState<Record<string, string> | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null)

  const dims = FORMAT_DIMS[formatKey]
  const aspect = dims.w / dims.h
  const selected = elements.find(e => e.id === selectedId) || null

  // ── Load saved templates ──
  const { data: templates } = useQuery({
    queryKey: ['label-templates'],
    queryFn: () => labelTemplatesApi.list().then(r => r.data.data),
  })

  const { data: previewData } = useQuery({
    queryKey: ['label-preview-search', previewQuery],
    queryFn: () => searchApi.quick(previewQuery).then(r => r.data.data),
    enabled: previewOpen && previewQuery.length >= 2,
  })
  const previewResults: any[] = previewData?.nodes ?? []

  const pickPreviewNode = (node: any) => {
    setPreviewSample({
      ref_code: node.ref_code || '',
      title: node.title || '',
      level: (node.level_of_description || node.level || '').toUpperCase(),
      date: [node.date_start, node.date_end].filter(Boolean).join(' – ') || (node.date_start || ''),
      local_ref: node.local_ref || '',
      location: node.location_path || node.full_path || '',
      institution: node.institution_name || '',
      parent_ref_code: node.parent_ref_code || '',
      parent_title: node.parent_title || '',
      parent_date: node.parent_date || '',
    })
    setPreviewOpen(false)
    setPreviewQuery('')
  }

  const loadTemplate = (t: any) => {
    setTemplateId(t.id)
    setName(t.name)
    setFormatKey(t.format_key)
    setIsDefault(t.is_default)
    setElements((t.elements || []).map((e: any) => ({ ...e, id: e.id || newId() })))
    setSelectedId(null)
  }

  const newTemplate = () => {
    setTemplateId(null); setName('New label'); setElements([]); setSelectedId(null); setIsDefault(false)
  }

  // ── Element mutations ──
  const addElement = (type: El['type'], field?: string) => {
    const el: El = {
      id: newId(), type, field,
      x: 0.1, y: 0.1, w: type === 'qr' ? 0.25 : 0.6, h: type === 'barcode' ? 0.2 : (type === 'qr' ? 0.4 : 0.12),
      font_size: type === 'field' && field === 'ref_code' ? 18 : 10,
      bold: field === 'ref_code', align: 'left', color: '#1a1a2e',
      text: type === 'text' ? 'Text' : undefined,
    }
    setElements(prev => [...prev, el])
    setSelectedId(el.id)
  }

  const updateEl = (id: string, patch: Partial<El>) =>
    setElements(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))

  const deleteEl = (id: string) => {
    setElements(prev => prev.filter(e => e.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const duplicateEl = (id: string) => {
    const src = elements.find(e => e.id === id)
    if (!src) return
    const copy = { ...src, id: newId(), x: Math.min(src.x + 0.05, 0.9), y: Math.min(src.y + 0.05, 0.9) }
    setElements(prev => [...prev, copy])
    setSelectedId(copy.id)
  }

  // ── Drag / resize ──
  const onPointerDown = (e: React.PointerEvent, id: string, mode: 'move' | 'resize') => {
    e.stopPropagation()
    const el = elements.find(x => x.id === id)!
    setSelectedId(id)
    setDrag({ id, mode, sx: e.clientX, sy: e.clientY, ox: el.x, oy: el.y, ow: el.w, oh: el.h })
  }

  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const rect = canvasRef.current!.getBoundingClientRect()
      const dx = (e.clientX - drag.sx) / rect.width
      const dy = (e.clientY - drag.sy) / rect.height
      if (drag.mode === 'move') {
        updateEl(drag.id, {
          x: Math.max(0, Math.min(1 - drag.ow, drag.ox + dx)),
          y: Math.max(0, Math.min(1 - drag.oh, drag.oy + dy)),
        })
      } else {
        updateEl(drag.id, {
          w: Math.max(0.05, Math.min(1 - drag.ox, drag.ow + dx)),
          h: Math.max(0.03, Math.min(1 - drag.oy, drag.oh + dy)),
        })
      }
    }
    const up = () => setDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [drag])

  // ── Image upload ──
  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const el: El = { id: newId(), type: 'image', image_data: String(reader.result), x: 0.1, y: 0.1, w: 0.3, h: 0.2 }
      setElements(prev => [...prev, el]); setSelectedId(el.id)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // ── Save ──
  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = { name, format_key: formatKey, is_default: isDefault, elements: elements.map(({ id, ...rest }) => ({ id, ...rest })) }
      return templateId
        ? labelTemplatesApi.update(templateId, payload)
        : labelTemplatesApi.create(payload)
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['label-templates'] })
      if (!templateId && res.data?.data?.id) setTemplateId(res.data.data.id)
    },
    onError: (err: any) => alert(err?.response?.data?.message ?? 'Save failed'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => labelTemplatesApi.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['label-templates'] }); newTemplate() },
  })

  const fmtFontToPx = useCallback((el: El) => {
    // Font size is in points relative to the physical mm; scale to the on-screen
    // canvas so preview text size tracks the printed size.
    if (!canvasRef.current) return el.font_size || 10
    const pxPerMm = canvasRef.current.getBoundingClientRect().height / dims.h
    return (el.font_size || 10) * 0.352778 * pxPerMm
  }, [dims.h])

  return (
    <div className={styles.designer}>
      {/* ── Sidebar: templates + palette ── */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarSection}>
          <div className={styles.sectionTitle}>Templates</div>
          <button className="btn btn-ghost btn-sm" onClick={newTemplate} style={{ width: '100%', justifyContent: 'flex-start' }}>
            <Plus size={13} /> New template
          </button>
          <div className={styles.templateList}>
            {(templates ?? []).map((t: any) => (
              <button key={t.id}
                className={`${styles.templateItem} ${templateId === t.id ? styles.templateActive : ''}`}
                onClick={() => loadTemplate(t)}>
                {t.is_default && <Star size={10} className={styles.defaultStar} />}
                <span>{t.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.sidebarSection}>
          <div className={styles.sectionTitle}>Add field</div>
          <div className={styles.paletteGrid}>
            {Object.entries(FIELD_LABELS).map(([f, lbl]) => (
              <button key={f} className={styles.paletteBtn} onClick={() => addElement('field', f)}>
                <Tag size={12} /> {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.sidebarSection}>
          <div className={styles.sectionTitle}>Add element</div>
          <div className={styles.paletteGrid}>
            <button className={styles.paletteBtn} onClick={() => addElement('text')}><Type size={12} /> Text</button>
            <button className={styles.paletteBtn} onClick={() => addElement('barcode', 'ref_code')}><Barcode size={12} /> Barcode</button>
            <button className={styles.paletteBtn} onClick={() => addElement('qr', 'ref_code')}><QrCode size={12} /> QR code</button>
            <label className={styles.paletteBtn}>
              <ImageIcon size={12} /> Image
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImage} />
            </label>
          </div>
        </div>
      </aside>

      {/* ── Canvas ── */}
      <div className={styles.canvasArea}>
        <div className={styles.canvasToolbar}>
          <input className={styles.nameInput} value={name} onChange={e => setName(e.target.value)} placeholder="Template name" />
          <select value={formatKey} onChange={e => setFormatKey(e.target.value)} className={styles.formatSelect}>
            {Object.entries(FORMAT_DIMS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
          </select>
          <label className={styles.defaultToggle}>
            <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} /> Default
          </label>
          <label className={styles.defaultToggle}>
            <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} /> Grid (mm)
          </label>
          <div className={styles.previewControl}>
            {previewSample ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setPreviewSample(null)}>
                Clear preview data
              </button>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => setPreviewOpen(v => !v)}>
                Preview with record…
              </button>
            )}
            {previewOpen && !previewSample && (
              <div className={styles.previewPopover}>
                <input autoFocus value={previewQuery} onChange={e => setPreviewQuery(e.target.value)}
                  placeholder="Search a record…" />
                <div className={styles.previewResults}>
                  {(previewResults ?? []).slice(0, 8).map((n: any) => (
                    <button key={n.id} className={styles.previewResult} onClick={() => pickPreviewNode(n)}>
                      <span className="ref-code">{n.ref_code}</span>
                      <span className={styles.previewResultTitle}>{n.title}</span>
                    </button>
                  ))}
                  {previewQuery.length >= 2 && previewResults && previewResults.length === 0 && (
                    <span className={styles.previewHint}>No matches</span>
                  )}
                </div>
              </div>
            )}
          </div>
          <div style={{ flex: 1 }} />
          {templateId && (
            <button className="btn btn-ghost btn-sm" onClick={() => { if (confirm('Delete this template?')) deleteMutation.mutate(templateId) }}>
              <Trash2 size={13} /> Delete
            </button>
          )}
          <button className="btn btn-primary btn-sm" disabled={saveMutation.isPending || !name.trim()} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? <Spinner size={13} /> : <Save size={13} />} Save
          </button>
        </div>

        <div className={styles.canvasScroll}>
          <div
            ref={canvasRef}
            className={styles.canvas}
            style={{ aspectRatio: String(aspect), width: aspect >= 1 ? 'min(680px, 90%)' : 'auto', height: aspect < 1 ? 'min(520px, 70vh)' : 'auto' }}
            onPointerDown={() => setSelectedId(null)}
          >
            {showGrid && <MmGrid widthMm={dims.w} heightMm={dims.h} />}
            {elements.map(el => (
              <div
                key={el.id}
                className={`${styles.el} ${selectedId === el.id ? styles.elSelected : ''}`}
                style={{
                  left: `${el.x * 100}%`, top: `${el.y * 100}%`,
                  width: `${el.w * 100}%`, height: `${el.h * 100}%`,
                  transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                  transformOrigin: 'center center',
                }}
                onPointerDown={e => onPointerDown(e, el.id, 'move')}
              >
                {el.type === 'image' ? (
                  <img src={el.image_data} alt="" className={styles.elImg} />
                ) : el.type === 'qr' ? (
                  <div className={styles.elPlaceholder}><QrCode size={Math.min(48, 200 * el.w)} /></div>
                ) : el.type === 'barcode' ? (
                  <div className={styles.elBarcode}>|‖|‖|||‖|‖||‖|</div>
                ) : (
                  <span style={{
                    fontSize: fmtFontToPx(el),
                    fontWeight: el.bold ? 700 : 400,
                    color: el.color,
                    textAlign: el.align,
                    width: '100%',
                    lineHeight: 1.2,
                  }}>{renderElContent(el, previewSample)}</span>
                )}
                {selectedId === el.id && (
                  <span className={styles.resizeHandle} onPointerDown={e => onPointerDown(e, el.id, 'resize')} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Property panel ── */}
      {selected && (
        <aside className={styles.props}>
          <div className={styles.sectionTitle}>
            {selected.type === 'field' ? FIELD_LABELS[selected.field || ''] : selected.type}
            <button className="btn btn-ghost btn-sm btn-icon" style={{ marginLeft: 'auto' }} onClick={() => duplicateEl(selected.id)} title="Duplicate"><Copy size={12} /></button>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => deleteEl(selected.id)} title="Delete"><Trash2 size={12} /></button>
          </div>

          {selected.type === 'text' && (
            <div className="form-group">
              <label>Text</label>
              <input value={selected.text || ''} onChange={e => updateEl(selected.id, { text: e.target.value })} />
            </div>
          )}

          {(selected.type === 'field' || selected.type === 'text') && (
            <>
              <div className="form-group">
                <label>Font size (pt)</label>
                <input type="number" value={selected.font_size || 10} min={4} max={72}
                  onChange={e => updateEl(selected.id, { font_size: parseInt(e.target.value) || 10 })} />
              </div>
              <div className={styles.btnRow}>
                <button className={`${styles.toggleBtn} ${selected.bold ? styles.toggleOn : ''}`} onClick={() => updateEl(selected.id, { bold: !selected.bold })}><Bold size={13} /></button>
                <button className={`${styles.toggleBtn} ${selected.align === 'left' ? styles.toggleOn : ''}`} onClick={() => updateEl(selected.id, { align: 'left' })}><AlignLeft size={13} /></button>
                <button className={`${styles.toggleBtn} ${selected.align === 'center' ? styles.toggleOn : ''}`} onClick={() => updateEl(selected.id, { align: 'center' })}><AlignCenter size={13} /></button>
                <button className={`${styles.toggleBtn} ${selected.align === 'right' ? styles.toggleOn : ''}`} onClick={() => updateEl(selected.id, { align: 'right' })}><AlignRight size={13} /></button>
              </div>
              <div className="form-group">
                <label>Colour</label>
                <input type="color" value={selected.color || '#1a1a2e'} onChange={e => updateEl(selected.id, { color: e.target.value })} />
              </div>
            </>
          )}

          {(selected.type === 'barcode' || selected.type === 'qr') && (
            <div className="form-group">
              <label>Encodes field</label>
              <select value={selected.field || 'ref_code'} onChange={e => updateEl(selected.id, { field: e.target.value })}>
                {['ref_code', 'local_ref'].map(f => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
              </select>
            </div>
          )}

          <div className={styles.posGrid}>
            {(['x', 'y', 'w', 'h'] as const).map(k => (
              <div className="form-group" key={k}>
                <label>{k.toUpperCase()} %</label>
                <input type="number" value={Math.round((selected[k] as number) * 100)} min={0} max={100}
                  onChange={e => updateEl(selected.id, { [k]: (parseInt(e.target.value) || 0) / 100 })} />
              </div>
            ))}
          </div>

          <div className="form-group">
            <label>Rotation</label>
            <div className={styles.btnRow}>
              {[0, 90, 180, 270].map(deg => (
                <button key={deg}
                  className={`${styles.toggleBtn} ${(selected.rotation || 0) === deg ? styles.toggleOn : ''}`}
                  style={{ flex: 1 }}
                  onClick={() => updateEl(selected.id, { rotation: deg })}>
                  {deg}°
                </button>
              ))}
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}

// ─── Millimetre grid overlay ──────────────────────────────────────────

function MmGrid({ widthMm, heightMm }: { widthMm: number; heightMm: number }) {
  const vlines = []
  const hlines = []
  for (let x = 0; x <= widthMm; x += 5) {
    const major = x % 10 === 0
    vlines.push(
      <line key={'v' + x} x1={`${(x / widthMm) * 100}%`} y1="0"
        x2={`${(x / widthMm) * 100}%`} y2="100%"
        stroke={major ? 'rgba(37,99,235,0.28)' : 'rgba(37,99,235,0.12)'}
        strokeWidth={major ? 0.6 : 0.4} />
    )
  }
  for (let y = 0; y <= heightMm; y += 5) {
    const major = y % 10 === 0
    hlines.push(
      <line key={'h' + y} x1="0" y1={`${(y / heightMm) * 100}%`}
        x2="100%" y2={`${(y / heightMm) * 100}%`}
        stroke={major ? 'rgba(37,99,235,0.28)' : 'rgba(37,99,235,0.12)'}
        strokeWidth={major ? 0.6 : 0.4} />
    )
  }
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      {vlines}{hlines}
    </svg>
  )
}
