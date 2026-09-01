import { useEffect, useRef, useState, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Pencil, Workflow, Download, Upload, X, Link2, ExternalLink, FileText, List, FileDown } from 'lucide-react'
import BpmnModeler from 'bpmn-js/lib/Modeler'
import BpmnViewer from 'bpmn-js/lib/NavigatedViewer'
import { classificationsApi } from '@/api'
import { Spinner } from '@/components/ui'
import { kurbitsModdleDescriptor, CLASSIFICATION_LINK_TYPE } from './kurbitsModdle'
import ClassificationPickerModal from './ClassificationPickerModal'
import type { PickedClassification } from './ClassificationPickerModal'
import styles from './ClassificationBpmnTab.module.css'

import 'bpmn-js/dist/assets/diagram-js.css'
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css'

const EMPTY_DIAGRAM = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  id="Definitions_1"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="Start"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="180" y="160" width="36" height="36"/>
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`

const KEEP_PALETTE_ENTRIES = [
  'hand-tool', 'lasso-tool', 'space-tool', 'global-connect-tool',
  'create.start-event', 'create.end-event',
  'create.exclusive-gateway', 'create.parallel-gateway',
  'create.task', 'create.subprocess-expanded',
  'create.data-object', 'create.data-store',
  'create.participant-expanded',
]

class CuratedPaletteProvider {
  static $inject = ['palette']
  constructor(palette: any) { palette.registerProvider(this) }
  getPaletteEntries() {
    return (entries: any) => {
      const filtered: any = {}
      for (const key of Object.keys(entries)) {
        if (KEEP_PALETTE_ENTRIES.includes(key)) filtered[key] = entries[key]
      }
      return filtered
    }
  }
}
const curatedPaletteModule = {
  __init__: ['curatedPaletteProvider'],
  curatedPaletteProvider: ['type', CuratedPaletteProvider],
}

function isDataElement(element: any): boolean {
  const bo = element?.businessObject
  if (!bo) return false
  return bo.$type === 'bpmn:DataObjectReference' || bo.$type === 'bpmn:DataStoreReference'
}

interface RecordMeta {
  id?: number
  code?: string
  name?: string
  retentionPeriod?: string
  retentionRule?: string
  disposalAction?: string
  securityClass?: string
  mediumFormat?: string
  legalBasis?: string
  recordDescription?: string
}

function readMeta(element: any): RecordMeta | null {
  const bo = element?.businessObject
  const ext = bo?.extensionElements
  if (!ext || !ext.values) return null
  const link = ext.values.find((v: any) => v.$type === CLASSIFICATION_LINK_TYPE)
  if (!link) return null
  return {
    id: link.classificationId, code: link.classificationCode, name: link.classificationName,
    retentionPeriod: link.retentionPeriod, retentionRule: link.retentionRule,
    disposalAction: link.disposalAction, securityClass: link.securityClass,
    mediumFormat: link.mediumFormat, legalBasis: link.legalBasis,
    recordDescription: link.recordDescription,
  }
}

// ─── Editor ───────────────────────────────────────────────────────────

function BpmnEditor({ classificationId, initialXml, vocab, onSaved, onCancel }: {
  classificationId: number
  initialXml: string
  vocab: any
  onSaved: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const containerRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const modelerRef = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [pickerFor, setPickerFor] = useState<any>(null)
  const [selected, setSelected] = useState<any>(null)
  const [name, setName] = useState('')
  const [meta, setMeta] = useState<RecordMeta | null>(null)

  const refreshSelected = useCallback((el: any) => {
    setSelected(el)
    setName(el ? (el.businessObject.name || '') : '')
    setMeta(el ? readMeta(el) : null)
  }, [])

  // Patch the record-meta extension on a data element.
  const patchMeta = useCallback((element: any, patch: Partial<RecordMeta> | null, clearLink = false) => {
    const modeler = modelerRef.current
    const modeling: any = modeler.get('modeling')
    const moddle: any = modeler.get('moddle')
    const bo = element.businessObject
    let ext = bo.extensionElements
    let values = ext && ext.values ? [...ext.values] : []
    const existing = values.find((v: any) => v.$type === CLASSIFICATION_LINK_TYPE)
    values = values.filter((v: any) => v.$type !== CLASSIFICATION_LINK_TYPE)

    if (!clearLink) {
      const cur = existing || {}
      const merged: any = {
        classificationId: patch?.id ?? cur.classificationId,
        classificationCode: patch?.code ?? cur.classificationCode,
        classificationName: patch?.name ?? cur.classificationName,
        retentionPeriod: patch?.retentionPeriod !== undefined ? patch.retentionPeriod : cur.retentionPeriod,
        retentionRule: patch?.retentionRule !== undefined ? patch.retentionRule : cur.retentionRule,
        disposalAction: patch?.disposalAction !== undefined ? patch.disposalAction : cur.disposalAction,
        securityClass: patch?.securityClass !== undefined ? patch.securityClass : cur.securityClass,
        mediumFormat: patch?.mediumFormat !== undefined ? patch.mediumFormat : cur.mediumFormat,
        legalBasis: patch?.legalBasis !== undefined ? patch.legalBasis : cur.legalBasis,
        recordDescription: patch?.recordDescription !== undefined ? patch.recordDescription : cur.recordDescription,
      }
      // keep the element even if only metadata (no classification) is present
      if (merged.classificationId || merged.retentionPeriod || merged.disposalAction ||
          merged.securityClass || merged.mediumFormat || merged.legalBasis || merged.recordDescription) {
        values.push(moddle.create(CLASSIFICATION_LINK_TYPE, merged))
      }
    }

    if (!ext) {
      ext = moddle.create('bpmn:ExtensionElements', { values }); ext.$parent = bo
    } else { ext.values = values }
    modeling.updateProperties(element, { extensionElements: ext })
    setMeta(readMeta(element))
  }, [])

  const renameElement = (val: string) => {
    setName(val)
    if (selected) {
      const modeling: any = modelerRef.current.get('modeling')
      modeling.updateProperties(selected, { name: val })
    }
  }

  useEffect(() => {
    if (!containerRef.current) return
    const modeler = new BpmnModeler({
      container: containerRef.current,
      additionalModules: [curatedPaletteModule],
      moddleExtensions: { kurbits: kurbitsModdleDescriptor },
    })
    modelerRef.current = modeler

    const contextPad: any = modeler.get('contextPad')
    const origGetEntries = contextPad.getEntries.bind(contextPad)
    contextPad.getEntries = (element: any) => {
      const entries = origGetEntries(element)
      if (isDataElement(element)) {
        entries['kurbits-link'] = {
          group: 'edit', className: 'bpmn-icon-screw-wrench',
          title: 'Link to records classification',
          action: { click: () => setPickerFor(element) },
        }
      }
      return entries
    }

    const eventBus: any = modeler.get('eventBus')
    eventBus.on('selection.changed', (e: any) => {
      const el = e.newSelection && e.newSelection[0]
      refreshSelected(el && isDataElement(el) ? el : null)
    })
    eventBus.on('element.changed', (e: any) => {
      if (selected && e.element && e.element.id === selected.id) {
        setName(e.element.businessObject.name || '')
      }
    })

    importDiagram(modeler, initialXml || EMPTY_DIAGRAM)
    return () => modeler.destroy()
  }, [initialXml])

  const importDiagram = (modeler: any, xml: string) => {
    modeler.importXML(xml)
      .then(() => {
        const canvas: any = modeler.get('canvas')
        canvas.zoom('fit-viewport', 'auto')
        const registry: any = modeler.get('elementRegistry')
        const modeling: any = modeler.get('modeling')
        registry.forEach((el: any) => {
          if (isDataElement(el) && readMeta(el)) {
            try { modeling.setColor(el, { stroke: '#2563eb' }) } catch { /* noop */ }
          }
        })
        setReady(true)
      })
      .catch((err: any) => {
        setSaveError('Could not load diagram: ' + (err && err.message ? err.message : 'unknown'))
        setReady(true)
      })
  }

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const xml = String(reader.result || '')
      setReady(false)
      importDiagram(modelerRef.current, xml)
    }
    reader.readAsText(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handlePicked = (picked: PickedClassification) => {
    if (pickerFor) {
      patchMeta(pickerFor, { id: picked.id, code: picked.full_code, name: picked.name })
      const modeling: any = modelerRef.current.get('modeling')
      try { modeling.setColor(pickerFor, { stroke: '#2563eb' }) } catch { /* noop */ }
    }
    setPickerFor(null)
  }

  const clearLink = () => {
    if (selected) {
      patchMeta(selected, { id: undefined, code: undefined, name: undefined })
    }
  }

  const setField = (field: keyof RecordMeta, value: string) => {
    if (selected) patchMeta(selected, { [field]: value } as Partial<RecordMeta>)
  }

  const collectLinks = (modeler: any) => {
    const registry: any = modeler.get('elementRegistry')
    const records: any[] = []
    const seen = new Set<string>()
    registry.forEach((el: any) => {
      // Skip label elements (bpmn-js registers a separate element for each
      // shape's text label, which shares the same businessObject).
      if (el.type === 'label' || el.labelTarget) return
      if (!isDataElement(el)) return

      // Dedupe on the REFERENCED data object/store id. A DataObjectReference's
      // own businessObject id differs from the DataObject it points at, and the
      // registry can surface both — so resolve to the referenced element's id
      // (falling back to the element's own id) to get one stable key per record.
      const bo = el.businessObject
      const refId = (bo?.dataObjectRef && bo.dataObjectRef.id)
                 || (bo?.dataStoreRef && bo.dataStoreRef.id)
                 || bo?.id
                 || el.id
      if (seen.has(refId)) return
      seen.add(refId)

      // Read data associations to find which activities produce/use this record.
      // Output association (activity -> data): produced by. bpmn-js exposes these
      // on the element as incoming/outgoing connection arrays.
      const producedBy = new Set<string>()
      const usedBy = new Set<string>()
      const activityName = (node: any) => {
        if (!node) return null
        const t = node.businessObject?.$type || ''
        // Only tasks/activities count as producers/consumers
        if (!/Task$/.test(t) && t !== 'bpmn:CallActivity' && t !== 'bpmn:SubProcess') return null
        return node.businessObject?.name || null
      }
      // Incoming arrow (activity -> data object) = the activity produced it.
      ;(el.incoming || []).forEach((conn: any) => {
        const n = activityName(conn.source)
        if (n) producedBy.add(n)
      })
      // Outgoing arrow (data object -> activity) = the activity uses it.
      ;(el.outgoing || []).forEach((conn: any) => {
        const n = activityName(conn.target)
        if (n) usedBy.add(n)
      })

      const m = readMeta(el) || {}
      records.push({
        task_bpmn_id: refId,
        task_label: el.businessObject.name || null,
        linked_classification_id: m.id || null,
        retention_period: m.retentionPeriod || null,
        retention_rule: m.retentionRule || null,
        disposal_action: m.disposalAction || null,
        security_class: m.securityClass || null,
        medium_format: m.mediumFormat || null,
        legal_basis: m.legalBasis || null,
        description: m.recordDescription || null,
        produced_by: Array.from(producedBy).join(', ') || null,
        used_by: Array.from(usedBy).join(', ') || null,
      })
    })
    return records
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const modeler = modelerRef.current
      const { xml } = await modeler.saveXML({ format: true })
      return classificationsApi.updateBpmn(classificationId, xml, collectLinks(modeler))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classification', classificationId] })
      queryClient.invalidateQueries({ queryKey: ['classification-bpmn', classificationId] })
      queryClient.invalidateQueries({ queryKey: ['classification-records', classificationId] })
      onSaved()
    },
    onError: (err: any) => setSaveError(err?.response?.data?.message || 'Save failed'),
  })

  const vocabOptions = (field: string) => (vocab?.[field] || []).map((t: any) => t.value)

  return (
    <div className={styles.editorWrap}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}><Workflow size={14} /> Process diagram</span>
        <div className={styles.toolbarActions}>
          <input ref={fileRef} type="file" accept=".bpmn,.xml,application/xml"
            style={{ display: 'none' }} onChange={handleUpload} />
          <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
            <Upload size={13} /> Import .bpmn
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}><X size={13} /> Cancel</button>
          <button className="btn btn-primary btn-sm"
            disabled={!ready || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? <Spinner size={13} /> : <Save size={13} />} Save
          </button>
        </div>
      </div>

      {saveError && <div className={styles.errorBanner}>{saveError}</div>}

      <div className={styles.stage}>
        <div ref={containerRef} className={styles.canvas} />

        {selected && (
          <div className={styles.recordPanel}>
            <div className={styles.recordPanelHead}>
              <span><FileText size={13} /> Record</span>
              <button className="btn btn-ghost btn-sm btn-icon"
                onClick={() => { const s: any = modelerRef.current.get('selection'); s.select(null) }}
                title="Close">
                <X size={13} />
              </button>
            </div>

            <div className={styles.recordPanelBody}>
              <div className="form-group">
                <label>Name</label>
                <input value={name} onChange={e => renameElement(e.target.value)}
                  placeholder="e.g. Application form" />
              </div>

              <div className={styles.linkField}>
                <label>Records classification</label>
                {meta?.id ? (
                  <div className={styles.linkRow}>
                    <Link2 size={12} />
                    <span>{meta.code} {meta.name}</span>
                    <button className="btn btn-ghost btn-sm" onClick={clearLink}>Remove</button>
                  </div>
                ) : (
                  <button className="btn btn-secondary btn-sm" onClick={() => setPickerFor(selected)}>
                    <Link2 size={13} /> Link to classification
                  </button>
                )}
              </div>

              <div className="form-group">
                <label>Retention period</label>
                <input value={meta?.retentionPeriod || ''} onChange={e => setField('retentionPeriod', e.target.value)}
                  placeholder="e.g. 10 years, Permanent" />
              </div>
              <div className="form-group">
                <label>Disposal action</label>
                <select value={meta?.disposalAction || ''} onChange={e => setField('disposalAction', e.target.value)}>
                  <option value="">—</option>
                  {vocabOptions('disposal').map((v: string) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Security classification</label>
                <select value={meta?.securityClass || ''} onChange={e => setField('securityClass', e.target.value)}>
                  <option value="">—</option>
                  {vocabOptions('security').map((v: string) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Medium / format</label>
                <select value={meta?.mediumFormat || ''} onChange={e => setField('mediumFormat', e.target.value)}>
                  <option value="">—</option>
                  {vocabOptions('medium').map((v: string) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Legal basis / authority</label>
                <input value={meta?.legalBasis || ''} onChange={e => setField('legalBasis', e.target.value)}
                  placeholder="Statute, regulation, or disposal authority" />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea value={meta?.recordDescription || ''} rows={3}
                  onChange={e => setField('recordDescription', e.target.value)} />
              </div>
            </div>
          </div>
        )}
      </div>

      {pickerFor && (
        <ClassificationPickerModal
          title="Link to records classification"
          onPick={handlePicked}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  )
}

// ─── Viewer ───────────────────────────────────────────────────────────

function BpmnView({ xml }: { xml: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!containerRef.current) return
    const viewer = new BpmnViewer({
      container: containerRef.current,
      moddleExtensions: { kurbits: kurbitsModdleDescriptor },
    })
    viewer.importXML(xml)
      .then(() => { const c: any = viewer.get('canvas'); c.zoom('fit-viewport', 'auto') })
      .catch((e: any) => setErr('Could not render diagram: ' + (e && e.message ? e.message : '')))
    return () => viewer.destroy()
  }, [xml])
  if (err) return <div className={styles.errorBanner}>{err}</div>
  return <div ref={containerRef} className={styles.canvas} />
}

// ─── Records list ─────────────────────────────────────────────────────

function toCsv(rows: any[]): string {
  const headers = [
    'Record', 'Produced by', 'Used by', 'Class code', 'Class name',
    'Retention period', 'Retention rule',
    'Disposal action', 'Security classification', 'Medium / format',
    'Legal basis', 'Description',
  ]
  const esc = (v: any) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push([
      r.record_name, r.produced_by, r.used_by, r.linked_code, r.linked_name,
      r.retention_period, r.retention_rule,
      r.disposal_action, r.security_class, r.medium_format, r.legal_basis, r.description,
    ].map(esc).join(','))
  }
  return lines.join('\n')
}

function RecordsList({ classificationId, code }: { classificationId: number; code?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['classification-records', classificationId],
    queryFn: () => classificationsApi.getRecords(classificationId).then(r => r.data.data),
  })
  if (isLoading) return null
  if (!data || data.length === 0) return null

  const exportCsv = () => {
    const csv = toCsv(data)
    // BOM so Excel opens UTF-8 (å/ä/ö) correctly
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = (code || 'process') + '-records.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={styles.recordsList}>
      <div className={styles.recordsListHeader}>
        <div className={styles.recordsListTitle}><List size={13} /> Records in this process</div>
        <button className="btn btn-ghost btn-sm" onClick={exportCsv}>
          <FileDown size={13} /> Export CSV
        </button>
      </div>
      <div className={styles.recordsTable}>
        <div className={styles.recordsHead}>
          <span>Record</span><span>Class</span><span>Retention</span>
          <span>Disposal</span><span>Security</span><span>Medium</span>
        </div>
        {data.map((r: any) => (
          <div key={r.id} className={styles.recordsRow}>
            <span className={styles.recCell} title={r.record_name}>{r.record_name || '—'}</span>
            <span className={styles.recCell}>{r.linked_code ? `${r.linked_code}` : '—'}</span>
            <span className={styles.recCell}>{r.retention_period || '—'}</span>
            <span className={styles.recCell}>{r.disposal_action || '—'}</span>
            <span className={styles.recCell}>{r.security_class || '—'}</span>
            <span className={styles.recCell}>{r.medium_format || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Tab root ─────────────────────────────────────────────────────────

export default function ClassificationBpmnTab({ classification }: { classification: any }) {
  const [editing, setEditing] = useState(false)
  const [importedXml, setImportedXml] = useState<string | null>(null)
  const emptyFileRef = useRef<HTMLInputElement>(null)
  const canEdit = classification.status !== 'published'

  const handleEmptyImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setImportedXml(String(reader.result || ''))
      setEditing(true)
    }
    reader.readAsText(file)
    if (emptyFileRef.current) emptyFileRef.current.value = ''
  }

  const { data, isLoading } = useQuery({
    queryKey: ['classification-bpmn', classification.id],
    queryFn: () => classificationsApi.getBpmn(classification.id).then(r => r.data.data),
  })
  const { data: vocab } = useQuery({
    queryKey: ['records-vocabulary'],
    queryFn: () => classificationsApi.getRecordsVocabulary().then(r => r.data.data),
  })

  const xml = data && data.bpmn_xml

  const handleDownload = () => {
    if (!xml) return
    const blob = new Blob([xml], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = (classification.code || 'process') + '.bpmn'
    a.click(); URL.revokeObjectURL(url)
  }

  if (isLoading) return <div className={styles.tab}><Spinner /></div>

  if (editing) {
    return (
      <div className={styles.tab}>
        <BpmnEditor
          classificationId={classification.id}
          initialXml={importedXml || xml || ''}
          vocab={vocab}
          onSaved={() => { setEditing(false); setImportedXml(null) }}
          onCancel={() => { setEditing(false); setImportedXml(null) }}
        />
      </div>
    )
  }

  if (xml) {
    return (
      <div className={styles.tab}>
        <div className={styles.viewHeader}>
          <span className={styles.toolbarTitle}><Workflow size={14} /> Process diagram</span>
          <div className={styles.toolbarActions}>
            <button className="btn btn-ghost btn-sm" onClick={handleDownload}>
              <Download size={13} /> Export .bpmn
            </button>
            {canEdit && (
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>
        </div>
        <BpmnView xml={xml} />
        <RecordsList classificationId={classification.id} code={classification.code} />
      </div>
    )
  }

  return (
    <div className={styles.empty}>
      <Workflow size={32} style={{ opacity: 0.25, marginBottom: 'var(--space-3)' }} />
      <p>No process diagram yet.</p>
      {canEdit ? (
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
            Create diagram
          </button>
          <input ref={emptyFileRef} type="file" accept=".bpmn,.xml,application/xml"
            style={{ display: 'none' }} onChange={handleEmptyImport} />
          <button className="btn btn-ghost btn-sm" onClick={() => emptyFileRef.current?.click()}>
            <Upload size={13} /> Import .bpmn
          </button>
        </div>
      ) : (
        <p className={styles.emptyHint}>Create a new version to add a diagram.</p>
      )}
    </div>
  )
}

// ─── "Produced by" panel (reverse lookup) ─────────────────────────────

export function ProducedByPanel({ classificationId, onOpenDiagram }: {
  classificationId: number
  onOpenDiagram?: (id: number) => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['classification-produced-by', classificationId],
    queryFn: () => classificationsApi.getProducedBy(classificationId).then(r => r.data.data),
  })
  if (isLoading) return null
  if (!data || data.length === 0) return null
  return (
    <div className={styles.producedBy}>
      <div className={styles.producedByTitle}><Workflow size={13} /> Produced by processes</div>
      {data.map((item: any, i: number) => (
        <button
          key={item.diagram_classification_id + '-' + item.task_bpmn_id + '-' + i}
          className={styles.producedByItem}
          onClick={() => onOpenDiagram && onOpenDiagram(item.diagram_classification_id)}
          disabled={!onOpenDiagram}
        >
          <span className={styles.producedByTask}>{item.task_label || 'Record'}</span>
          <span className={styles.producedByIn}>in</span>
          <span className={styles.producedByProcess}>{item.diagram_code} {item.diagram_name}</span>
          {item.retention_period && <span className={styles.retentionTag}>{item.retention_period}</span>}
          {onOpenDiagram && <ExternalLink size={11} />}
        </button>
      ))}
    </div>
  )
}
