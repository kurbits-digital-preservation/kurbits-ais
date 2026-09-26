import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  FileText, Truck, Archive, Plus, Pencil, Trash2, X, Save,
  Check, ChevronRight, Paperclip, Link2, Upload, AlertCircle,
  CheckSquare, Square, ExternalLink, Download, Search, LayoutDashboard
} from 'lucide-react'
import { acquisitionsApi, agentsApi, checklistTemplatesApi } from '@/api'
import { Spinner, Tabs } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import styles from './AcquisitionsPage.module.css'

// ─── Constants ────────────────────────────────────────────────────────

const SA_STATUSES = ['draft', 'active', 'suspended', 'terminated']
const ATTENTION_PREVIEW = 5
const DELIVERY_STATUSES = [
  { value: 'expected',            label: 'Expected' },
  { value: 'received',            label: 'Received' },
  { value: 'in_review',           label: 'In review' },
  { value: 'accepted',            label: 'Accepted' },
  { value: 'partially_accepted',  label: 'Partially accepted' },
  { value: 'rejected',            label: 'Rejected' },
]
const DELIVERY_METHODS = [
  'physical', 'digital_transfer', 'email', 'sftp', 'cloud', 'other'
]

const STATUS_COLORS: Record<string, string> = {
  draft:              'var(--color-ink-faint)',
  active:             'var(--color-success)',
  suspended:          'var(--color-warning)',
  terminated:         'var(--color-error)',
  expected:           'var(--color-ink-faint)',
  received:           'var(--color-accent)',
  in_review:          'var(--color-warning)',
  accepted:           'var(--color-success)',
  partially_accepted: 'var(--color-warning)',
  rejected:           'var(--color-error)',
  open:               'var(--color-accent)',
  closed:             'var(--color-success)',
}

const STATUS_KEY_MAP: Record<string, string> = {
  draft: 'draft', active: 'active', suspended: 'suspended', terminated: 'terminated',
  expected: 'expected', received: 'received', in_review: 'inReview', accepted: 'accepted',
  partially_accepted: 'partiallyAccepted', rejected: 'rejected', open: 'open', closed: 'closed',
}

function StatusBadge({ status, label }: { status: string; label?: string }) {
  const { t } = useTranslation()
  const fallback = STATUS_KEY_MAP[status]
    ? (status === 'draft' ? t('resources.status.draft') : status === 'open' ? t('flags.open') : t(`acquisitions.statusLabels.${STATUS_KEY_MAP[status]}`))
    : status.replace(/_/g, ' ')
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontSize: '11px', fontWeight: 600, padding: '2px 8px',
      borderRadius: 4, letterSpacing: '0.03em',
      background: `color-mix(in srgb, ${STATUS_COLORS[status] ?? '#9ca3af'} 12%, transparent)`,
      color: STATUS_COLORS[status] ?? '#9ca3af',
      border: `1px solid color-mix(in srgb, ${STATUS_COLORS[status] ?? '#9ca3af'} 30%, transparent)`,
      whiteSpace: 'nowrap',
    }}>
      {label ?? fallback}
    </span>
  )
}

// ─── Agent search typeahead ───────────────────────────────────────────

function AgentTypeahead({ value, label, onChange, placeholder }: {
  value: number | null; label: string; onChange: (id: number | null, name: string) => void
  placeholder?: string
}) {
  const { t } = useTranslation()
  const [q, setQ] = useState(label)
  const [open, setOpen] = useState(false)
  const { data: results } = useQuery({
    queryKey: ['agent-search-acq', q],
    queryFn: () => agentsApi.list({ q, per_page: 8 }).then(r => r.data.data ?? []),
    enabled: open && q.length >= 2,
  })
  return (
    <div style={{ position: 'relative' }}>
      <input value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); if (!e.target.value) onChange(null, '') }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder ?? t('agents.list.searchPlaceholder')} />
      {open && (results as any[])?.length > 0 && (
        <div className={styles.typeaheadMenu}>
          {(results as any[]).map((a: any) => (
            <button key={a.id} className={styles.typeaheadItem}
              onMouseDown={() => { onChange(a.id, a.name); setQ(a.name); setOpen(false) }}>
              <span className={styles.typeaheadName}>{a.name}</span>
              <span className={styles.typeaheadMeta}>{a.agent_type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Reference typeahead (SA / delivery pickers) ──────────────────────

function RefTypeahead({ items, value, onChange, placeholder, refKey }: {
  items: any[]
  value: any
  onChange: (id: number | null) => void
  placeholder: string
  refKey: 'reference_number' | 'accession_number'
}) {
  const { t } = useTranslation()
  const selected = items.find((i: any) => String(i.id) === String(value))
  const [q, setQ] = useState(selected ? `${selected[refKey]} — ${selected.title}` : '')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const sel = items.find((i: any) => String(i.id) === String(value))
    setQ(sel ? `${sel[refKey]} — ${sel.title}` : '')
  }, [value, items])

  const ql = q.toLowerCase()
  const filtered = q && !selected
    ? items.filter((i: any) =>
        (i[refKey] ?? '').toLowerCase().includes(ql) ||
        (i.title ?? '').toLowerCase().includes(ql))
    : items

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); if (!e.target.value) onChange(null) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
      />
      {open && filtered.length > 0 && (
        <div className={styles.typeaheadMenu}>
          <button className={styles.typeaheadItem}
            onMouseDown={() => { onChange(null); setQ(''); setOpen(false) }}>
            <span className={styles.typeaheadMeta}>{t('acquisitions.refSearch.none')}</span>
          </button>
          {filtered.slice(0, 12).map((i: any) => (
            <button key={i.id} className={styles.typeaheadItem}
              onMouseDown={() => { onChange(i.id); setQ(`${i[refKey]} — ${i.title}`); setOpen(false) }}>
              <span className={styles.typeaheadName}>{i.title}</span>
              <span className={styles.typeaheadMeta}>{i[refKey]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// SUBMISSION AGREEMENTS
// ══════════════════════════════════════════════════════════════════════

function SAForm({ initial, onSave, onCancel, isSaving }: {
  initial?: any; onSave: (d: Record<string, unknown>) => void
  onCancel: () => void; isSaving: boolean
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    title:                 initial?.title ?? '',
    agent_id:              initial?.agent_id ?? null as number | null,
    agent_name:            initial?.agent_name ?? '',
    status:                initial?.status ?? 'draft',
    agreement_date:        initial?.agreement_date ?? '',
    review_date:           initial?.review_date ?? '',
    delivery_schedule:     initial?.delivery_schedule ?? '',
    scope_and_content:     initial?.scope_and_content ?? '',
    access_conditions:     initial?.access_conditions ?? '',
    appraisal_notes:       initial?.appraisal_notes ?? '',
    disposition_authority: initial?.disposition_authority ?? '',
    notes:                 initial?.notes ?? '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  return (
    <div className={styles.form}>
      <div className={styles.formGrid2}>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{t('resources.form.fields.title')}</label>
          <input value={form.title} onChange={set('title')} placeholder={t('acquisitions.sa.titlePlaceholder')} autoFocus />
        </div>
        <div className="form-group">
          <label>{t('acquisitions.sa.depositor')}</label>
          <AgentTypeahead value={form.agent_id} label={form.agent_name}
            onChange={(id, name) => setForm(p => ({ ...p, agent_id: id, agent_name: name }))} />
        </div>
        <div className="form-group">
          <label>{t('flags.status')}</label>
          <select value={form.status} onChange={set('status')}>
            {SA_STATUSES.map(s => <option key={s} value={s}>{t(`acquisitions.statusLabels.${STATUS_KEY_MAP[s]}`, { defaultValue: s })}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>{t('acquisitions.sa.agreementDate')}</label>
          <input type="date" value={form.agreement_date} onChange={set('agreement_date')} />
        </div>
        <div className="form-group">
          <label>{t('acquisitions.sa.reviewDate')}</label>
          <input type="date" value={form.review_date} onChange={set('review_date')} />
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{t('acquisitions.sa.deliverySchedule')}</label>
          <textarea value={form.delivery_schedule} onChange={set('delivery_schedule')} rows={2}
            placeholder={t('acquisitions.sa.deliverySchedulePlaceholder')} />
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{t('resources.form.fields.scopeAndContent')}</label>
          <textarea value={form.scope_and_content} onChange={set('scope_and_content')} rows={3}
            placeholder={t('acquisitions.sa.scopeAndContentPlaceholder')} />
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{t('resources.form.fields.accessConditions')}</label>
          <textarea value={form.access_conditions} onChange={set('access_conditions')} rows={2} />
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{t('acquisitions.sa.appraisalNotes')}</label>
          <textarea value={form.appraisal_notes} onChange={set('appraisal_notes')} rows={2} />
        </div>
        <div className="form-group">
          <label>{t('acquisitions.sa.dispositionAuthority')}</label>
          <input value={form.disposition_authority} onChange={set('disposition_authority')}
            placeholder={t('acquisitions.sa.dispositionAuthorityPlaceholder')} />
        </div>
        <div className="form-group">
          <label>{t('locations.notes')}</label>
          <textarea value={form.notes} onChange={set('notes')} rows={2} />
        </div>
      </div>
      <div className={styles.formActions}>
        <button className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={!form.title.trim() || isSaving}
          onClick={() => onSave({ ...form, agent_name: undefined })}>
          {isSaving ? <Spinner size={14} /> : <Save size={14} />}
          {initial ? t('resources.form.saveChanges') : t('acquisitions.sa.createAgreement')}
        </button>
      </div>
    </div>
  )
}

function SADetail({ sa, onEdit, onDeleted }: { sa: any; onEdit: () => void; onDeleted: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadDesc, setUploadDesc] = useState('')
  const [showUpload, setShowUpload] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => acquisitionsApi.deleteSA(sa.id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['submission-agreements'] }); onDeleted() },
  })
  const uploadMutation = useMutation({
    mutationFn: () => acquisitionsApi.uploadSAAttachment(sa.id, uploadFile!, uploadDesc),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['submission-agreements'] })
      queryClient.invalidateQueries({ queryKey: ['sa', sa.id] })
      queryClient.refetchQueries({ queryKey: ['sa', sa.id] })
      setShowUpload(false); setUploadFile(null); setUploadDesc('')
    },
  })
  const deleteAttMutation = useMutation({
    mutationFn: (attId: number) => acquisitionsApi.deleteSAAttachment(sa.id, attId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sa', sa.id] })
      queryClient.refetchQueries({ queryKey: ['sa', sa.id] })
    },
  })

  const { data: detail } = useQuery({
    queryKey: ['sa', sa.id],
    queryFn: () => acquisitionsApi.getSA(sa.id).then(r => r.data.data),
  })
  const obj = detail ?? sa

  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <div>
          <div className={styles.detailRef}>{obj.reference_number}</div>
          <h2 className={styles.detailTitle}>{obj.title}</h2>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
            <StatusBadge status={obj.status} />
            {obj.agent_name && <span className={styles.detailMeta}>{obj.agent_name}</span>}
          </div>
        </div>
        <div className={styles.detailActions}>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onEdit}><Pencil size={14} /></button>
          <button className="btn btn-ghost btn-sm btn-icon"
            onClick={() => { if (confirm(t('acquisitions.sa.deleteConfirm'))) deleteMutation.mutate() }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className={styles.detailBody}>
        {obj.agreement_date && <Field label={t('acquisitions.sa.agreementDate')} value={obj.agreement_date} />}
        {obj.review_date && <Field label={t('acquisitions.sa.reviewDate')} value={obj.review_date} />}
        {obj.delivery_schedule && <Field label={t('acquisitions.sa.deliverySchedule')} value={obj.delivery_schedule} multi />}
        {obj.scope_and_content && <Field label={t('resources.form.fields.scopeAndContent')} value={obj.scope_and_content} multi />}
        {obj.access_conditions && <Field label={t('resources.form.fields.accessConditions')} value={obj.access_conditions} multi />}
        {obj.appraisal_notes && <Field label={t('acquisitions.sa.appraisalNotes')} value={obj.appraisal_notes} multi />}
        {obj.disposition_authority && <Field label={t('acquisitions.sa.dispositionAuthority')} value={obj.disposition_authority} />}
        {obj.notes && <Field label={t('locations.notes')} value={obj.notes} multi />}

        {/* Attachments */}
        <div className={styles.attachSection}>
          <div className={styles.attachHeader}>
            <span className={styles.attachTitle}><Paperclip size={13} /> {t('acquisitions.sa.attachments')}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowUpload(v => !v)}>
              <Upload size={13} /> {t('acquisitions.sa.upload')}
            </button>
          </div>
          {showUpload && (
            <div className={styles.uploadForm}>
              <input type="file" onChange={e => setUploadFile(e.target.files?.[0] ?? null)} />
              <input value={uploadDesc} onChange={e => setUploadDesc(e.target.value)}
                placeholder={t('acquisitions.sa.uploadDescPlaceholder')} />
              <button className="btn btn-primary btn-sm"
                disabled={!uploadFile || uploadMutation.isPending}
                onClick={() => uploadMutation.mutate()}>
                {uploadMutation.isPending ? <Spinner size={13} /> : <Upload size={13} />} {t('acquisitions.sa.upload')}
              </button>
            </div>
          )}
          {(obj.attachments ?? []).map((att: any) => (
            <div key={att.id} className={styles.attachRow}>
              <Paperclip size={12} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span className={styles.attachName}>{att.original_filename}</span>
                  {att.file_size && (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)' }}>
                      {att.file_size < 1048576
                        ? `${(att.file_size / 1024).toFixed(1)} KB`
                        : `${(att.file_size / 1048576).toFixed(1)} MB`}
                    </span>
                  )}
                </div>
                {att.description && <div className={styles.attachDesc}>{att.description}</div>}
              </div>
              <a
                href={`/api/v1/submission-agreements/${obj.id}/attachments/${att.id}/download`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost btn-sm btn-icon"
                title={t('acquisitions.sa.downloadOrView')}
              >
                <Download size={12} />
              </a>
              <button className="btn btn-ghost btn-sm btn-icon" title={t('common.delete')}
                onClick={() => deleteAttMutation.mutate(att.id)}>
                <X size={11} />
              </button>
            </div>
          ))}
          {(obj.attachments ?? []).length === 0 && !showUpload && (
            <p className={styles.empty}>{t('acquisitions.sa.noAttachments')}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// DELIVERIES
// ══════════════════════════════════════════════════════════════════════

function DeliveryForm({ initial, onSave, onCancel, isSaving }: {
  initial?: any; onSave: (d: Record<string, unknown>) => void
  onCancel: () => void; isSaving: boolean
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    title:                    initial?.title ?? '',
    submission_agreement_id:  initial?.submission_agreement_id ?? '' as any,
    status:                   initial?.status ?? 'expected',
    delivery_method:          initial?.delivery_method ?? '',
    delivery_date:            initial?.delivery_date ?? '',
    description:              initial?.description ?? '',
    item_count:               initial?.item_count ?? '' as any,
    physical_extent:          initial?.physical_extent ?? '',
    notes:                    initial?.notes ?? '',
    checklist_template_id:    '' as any,
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const { data: sas } = useQuery({
    queryKey: ['submission-agreements'],
    queryFn: () => acquisitionsApi.listSAs().then(r => r.data.data),
  })

  const { data: checklistTemplates = [] } = useQuery({
    queryKey: ['checklist-templates'],
    queryFn: () => checklistTemplatesApi.list().then(r => r.data.data),
    enabled: !initial, // only needed when creating
  })

  const relevantTemplates = (checklistTemplates as any[]).filter((tmpl: any) =>
    !tmpl.delivery_method || !form.delivery_method || tmpl.delivery_method === form.delivery_method
  )

  return (
    <div className={styles.form}>
      <div className={styles.formGrid2}>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{t('resources.form.fields.title')}</label>
          <input value={form.title} onChange={set('title')} autoFocus
            placeholder={t('acquisitions.delivery.titlePlaceholder')} />
        </div>
        <div className="form-group">
          <label>{t('acquisitions.delivery.submissionAgreement')}</label>
          <RefTypeahead
            items={(sas as any[]) ?? []}
            value={form.submission_agreement_id}
            onChange={id => setForm(p => ({ ...p, submission_agreement_id: id ?? '' as any }))}
            placeholder={t('acquisitions.delivery.searchAgreements')}
            refKey="reference_number"
          />
        </div>
        <div className="form-group">
          <label>{t('flags.status')}</label>
          <select value={form.status} onChange={set('status')}>
            {DELIVERY_STATUSES.map(s => <option key={s.value} value={s.value}>{t(`acquisitions.statusLabels.${STATUS_KEY_MAP[s.value]}`)}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>{t('acquisitions.delivery.deliveryMethod')}</label>
          <select value={form.delivery_method} onChange={set('delivery_method')}>
            <option value="">{t('acquisitions.delivery.unknown')}</option>
            {DELIVERY_METHODS.map(m => <option key={m} value={m}>{t(`acquisitions.methods.${m}`)}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>{t('acquisitions.delivery.deliveryDate')}</label>
          <input type="date" value={form.delivery_date} onChange={set('delivery_date')} />
        </div>
        <div className="form-group">
          <label>{t('acquisitions.delivery.itemCount')}</label>
          <input type="number" value={form.item_count} onChange={set('item_count')} placeholder={t('acquisitions.delivery.itemCountPlaceholder')} />
        </div>
        <div className="form-group">
          <label>{t('acquisitions.delivery.physicalExtent')}</label>
          <input value={form.physical_extent} onChange={set('physical_extent')} placeholder={t('acquisitions.delivery.physicalExtentPlaceholder')} />
        </div>
        {!initial && (
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>{t('acquisitions.delivery.checklistTemplate')}</label>
            <select value={form.checklist_template_id} onChange={set('checklist_template_id')}>
              <option value="">{t('acquisitions.delivery.autoSelectHint')}</option>
              {relevantTemplates.map((tmpl: any) => (
                <option key={tmpl.id} value={tmpl.id}>
                  {tmpl.name}
                  {tmpl.delivery_method ? ` (${t(`acquisitions.methods.${tmpl.delivery_method}`)})` : ` ${t('acquisitions.delivery.allTypes')}`}
                  {tmpl.is_default ? t('acquisitions.delivery.defaultSuffix') : ''}
                </option>
              ))}
            </select>
            <span className="form-hint">
              {t('acquisitions.delivery.autoTemplateHint')}
            </span>
          </div>
        )}
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{t('resources.form.fields.description')}</label>
          <textarea value={form.description} onChange={set('description')} rows={3} />
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{t('locations.notes')}</label>
          <textarea value={form.notes} onChange={set('notes')} rows={2} />
        </div>
      </div>
      <div className={styles.formActions}>
        <button className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={!form.title.trim() || isSaving}
          onClick={() => onSave({
            ...form,
            submission_agreement_id: form.submission_agreement_id || null,
            item_count: form.item_count ? parseInt(form.item_count) : null,
            checklist_template_id: form.checklist_template_id ? parseInt(form.checklist_template_id) : null,
          })}>
          {isSaving ? <Spinner size={14} /> : <Save size={14} />}
          {initial ? t('resources.form.saveChanges') : t('acquisitions.delivery.createDelivery')}
        </button>
      </div>
    </div>
  )
}

function Checklist({ delivery }: { delivery: any }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [items, setItems] = useState<any[]>(delivery.checklist ?? [])
  const [showTemplates, setShowTemplates] = useState(false)

  const { data: templates = [] } = useQuery({
    queryKey: ['checklist-templates'],
    queryFn: () => checklistTemplatesApi.list().then(r => r.data.data),
    enabled: showTemplates,
  })

  const mutation = useMutation({
    mutationFn: (checklist: any[]) => acquisitionsApi.updateChecklist(delivery.id, checklist),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery', delivery.id] })
      // The Overview dashboard and the Deliveries list both read off the
      // ['deliveries'] list query (for checklist completion), so that needs
      // invalidating too or they show stale data until an unrelated refetch.
      queryClient.invalidateQueries({ queryKey: ['deliveries'] })
    },
  })

  const toggle = (idx: number) => {
    const next = items.map((item, i) =>
      i === idx ? { ...item, checked: !item.checked } : item
    )
    setItems(next)
    mutation.mutate(next)
  }

  const updateNote = (idx: number, note: string) => {
    const next = items.map((item, i) => i === idx ? { ...item, note } : item)
    setItems(next)
  }

  const saveNote = () => mutation.mutate(items)

  const applyTemplate = (tmpl: any) => {
    const next = (tmpl.items as any[]).map(i => ({
      key: i.key || i.label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      label: i.label,
      checked: false,
      note: '',
    }))
    setItems(next)
    mutation.mutate(next)
    setShowTemplates(false)
  }

  const done = items.filter(i => i.checked).length

  return (
    <div className={styles.checklist}>
      <div className={styles.checklistHeader}>
        <span className={styles.checklistTitle}>{t('acquisitions.checklist.title')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span className={styles.checklistProgress}>
            {done}/{items.length}
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${items.length ? (done/items.length)*100 : 0}%` }} />
            </div>
          </span>
          <div style={{ position: 'relative' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowTemplates(v => !v)}
              title={t('acquisitions.checklist.applyTemplateTitle')}>
              {t('acquisitions.checklist.applyTemplate')}
            </button>
            {showTemplates && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowTemplates(false)} />
                <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 100,
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-xl)',
                  minWidth: 220, overflow: 'hidden' }}>
                  {(templates as any[]).length === 0 && (
                    <div style={{ padding: 'var(--space-3)', fontSize: 'var(--text-sm)',
                      color: 'var(--color-ink-faint)', fontStyle: 'italic' }}>
                      {t('acquisitions.checklist.noTemplates')}
                    </div>
                  )}
                  {(templates as any[]).map((tmpl: any) => (
                    <button key={tmpl.id}
                      style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%',
                        padding: '8px var(--space-3)', background: 'none', border: 'none',
                        borderBottom: '1px solid var(--color-border)', cursor: 'pointer',
                        textAlign: 'left', fontFamily: 'var(--font-sans)', transition: 'background 0.06s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-subtle)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                      onClick={() => applyTemplate(tmpl)}>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-ink)' }}>
                        {tmpl.name}
                      </span>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)' }}>
                        {t('acquisitions.checklist.itemsCount', { count: tmpl.items.length })}
                        {tmpl.delivery_method ? ` · ${t(`acquisitions.methods.${tmpl.delivery_method}`)}` : ''}
                        {tmpl.is_default ? ` · ${t('printLabels.default')}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {items.map((item, idx) => (
        <div key={item.key} className={styles.checkItem}>
          <button className={styles.checkBtn} onClick={() => toggle(idx)}>
            {item.checked
              ? <CheckSquare size={16} style={{ color: 'var(--color-success)' }} />
              : <Square size={16} style={{ color: 'var(--color-ink-faint)' }} />
            }
          </button>
          <div className={styles.checkBody}>
            <span className={`${styles.checkLabel} ${item.checked ? styles.checkLabelDone : ''}`}>
              {item.label}
            </span>
            <input
              className={styles.checkNote}
              value={item.note ?? ''}
              onChange={e => updateNote(idx, e.target.value)}
              onBlur={saveNote}
              placeholder={t('acquisitions.checklist.addNotePlaceholder')}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function DeliveryDetail({ delivery, onEdit, onDeleted, onNavigate }: {
  delivery: any; onEdit: () => void; onDeleted: () => void
  onNavigate: (section: string, id: number) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data: detail } = useQuery({
    queryKey: ['delivery', delivery.id],
    queryFn: () => acquisitionsApi.getDelivery(delivery.id).then(r => r.data.data),
  })
  const obj = detail ?? delivery

  const deleteMutation = useMutation({
    mutationFn: () => acquisitionsApi.deleteDelivery(obj.id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['deliveries'] }); onDeleted() },
  })

  const statusLabel = STATUS_KEY_MAP[obj.status] ? t(`acquisitions.statusLabels.${STATUS_KEY_MAP[obj.status]}`) : obj.status

  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <div>
          <div className={styles.detailRef}>{obj.reference_number}</div>
          <h2 className={styles.detailTitle}>{obj.title}</h2>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
            <StatusBadge status={obj.status} label={statusLabel} />
            {obj.delivery_method && (
              <span className={styles.detailMeta}>{t(`acquisitions.methods.${obj.delivery_method}`, { defaultValue: obj.delivery_method.replace(/_/g, ' ') })}</span>
            )}
          </div>
        </div>
        <div className={styles.detailActions}>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onEdit}><Pencil size={14} /></button>
          <button className="btn btn-ghost btn-sm btn-icon"
            onClick={() => { if (confirm(t('acquisitions.delivery.deleteConfirm'))) deleteMutation.mutate() }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className={styles.detailBody}>
        {obj.submission_agreement_ref && (
          <div className={styles.field}>
            <dt className={styles.fieldLabel}>{t('acquisitions.delivery.submissionAgreement')}</dt>
            <dd className={styles.fieldValue}>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', color: 'var(--color-accent)', padding: 0, fontSize: 'var(--text-sm)' }}
                onClick={() => onNavigate('agreements', obj.submission_agreement_id)}>
                {obj.submission_agreement_ref} ↗
              </button>
            </dd>
          </div>
        )}
        {obj.delivery_date && <Field label={t('acquisitions.delivery.deliveryDate')} value={obj.delivery_date} />}
        {obj.received_at && <Field label={t('acquisitions.statusLabels.received')} value={t('acquisitions.delivery.receivedBy', { date: obj.received_at.slice(0,10), name: obj.received_by })} />}
        {obj.item_count && <Field label={t('acquisitions.delivery.itemCount')} value={String(obj.item_count)} />}
        {obj.physical_extent && <Field label={t('acquisitions.delivery.physicalExtent')} value={obj.physical_extent} />}
        {obj.size_bytes && <Field label={t('acquisitions.delivery.digitalSize')} value={`${(obj.size_bytes / 1e6).toFixed(1)} MB`} />}
        {obj.description && <Field label={t('resources.form.fields.description')} value={obj.description} multi />}
        {obj.notes && <Field label={t('locations.notes')} value={obj.notes} multi />}

        <Checklist delivery={obj} />
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// ACCESSIONS
// ══════════════════════════════════════════════════════════════════════

function AccessionForm({ initial, onSave, onCancel, isSaving }: {
  initial?: any; onSave: (d: Record<string, unknown>) => void
  onCancel: () => void; isSaving: boolean
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    title:                initial?.title ?? '',
    delivery_id:          initial?.delivery_id ?? '' as any,
    submission_agreement_id: initial?.submission_agreement_id ?? '' as any,
    creator_agent_id:     initial?.creator_agent_id ?? null as number | null,
    creator_agent_name:   initial?.creator_agent_name ?? '',
    status:               initial?.status ?? 'open',
    date_received:        initial?.date_received ?? '',
    date_accessioned:     initial?.date_accessioned ?? '',
    extent:               initial?.extent ?? '',
    description:          initial?.description ?? '',
    appraisal_decision:   initial?.appraisal_decision ?? '',
    disposition_notes:    initial?.disposition_notes ?? '',
    access_restrictions:  initial?.access_restrictions ?? '',
    processing_notes:     initial?.processing_notes ?? '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const { data: deliveries } = useQuery({
    queryKey: ['deliveries'],
    queryFn: () => acquisitionsApi.listDeliveries().then(r => r.data.data),
  })
  const { data: sas } = useQuery({
    queryKey: ['submission-agreements'],
    queryFn: () => acquisitionsApi.listSAs().then(r => r.data.data),
  })

  return (
    <div className={styles.form}>
      <div className={styles.formGrid2}>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{t('resources.form.fields.title')}</label>
          <input value={form.title} onChange={set('title')} autoFocus />
        </div>
        <div className="form-group">
          <label>{t('acquisitions.accession.delivery')}</label>
          <RefTypeahead
            items={(deliveries as any[]) ?? []}
            value={form.delivery_id}
            onChange={id => setForm(p => ({ ...p, delivery_id: id ?? '' as any }))}
            placeholder={t('acquisitions.delivery.searchDeliveries')}
            refKey="reference_number"
          />
        </div>
        <div className="form-group">
          <label>{t('acquisitions.delivery.submissionAgreement')}</label>
          <RefTypeahead
            items={(sas as any[]) ?? []}
            value={form.submission_agreement_id}
            onChange={id => setForm(p => ({ ...p, submission_agreement_id: id ?? '' as any }))}
            placeholder={t('acquisitions.delivery.searchAgreements')}
            refKey="reference_number"
          />
        </div>
        <div className="form-group">
          <label>{t('acquisitions.accession.creatorLabel')}</label>
          <AgentTypeahead value={form.creator_agent_id} label={form.creator_agent_name}
            onChange={(id, name) => setForm(p => ({ ...p, creator_agent_id: id, creator_agent_name: name }))} />
        </div>
        <div className="form-group">
          <label>{t('flags.status')}</label>
          <select value={form.status} onChange={set('status')}>
            <option value="open">{t('flags.open')}</option>
            <option value="closed">{t('acquisitions.statusLabels.closed')}</option>
          </select>
        </div>
        <div className="form-group">
          <label>{t('acquisitions.accession.dateReceived')}</label>
          <input type="date" value={form.date_received} onChange={set('date_received')} />
        </div>
        <div className="form-group">
          <label>{t('acquisitions.accession.dateAccessioned')}</label>
          <input type="date" value={form.date_accessioned} onChange={set('date_accessioned')} />
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{t('acquisitions.accession.extent')}</label>
          <input value={form.extent} onChange={set('extent')} placeholder={t('acquisitions.accession.extentPlaceholder')} />
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{t('resources.form.fields.description')}</label>
          <textarea value={form.description} onChange={set('description')} rows={3} />
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{t('acquisitions.accession.appraisalDecision')}</label>
          <textarea value={form.appraisal_decision} onChange={set('appraisal_decision')} rows={2} />
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{t('acquisitions.accession.accessRestrictions')}</label>
          <textarea value={form.access_restrictions} onChange={set('access_restrictions')} rows={2} />
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{t('acquisitions.accession.processingNotes')}</label>
          <textarea value={form.processing_notes} onChange={set('processing_notes')} rows={2} />
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{t('acquisitions.accession.dispositionNotes')}</label>
          <textarea value={form.disposition_notes} onChange={set('disposition_notes')} rows={2} />
        </div>
      </div>
      <div className={styles.formActions}>
        <button className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={!form.title.trim() || isSaving}
          onClick={() => onSave({
            ...form,
            creator_agent_name: undefined,
            delivery_id: form.delivery_id || null,
            submission_agreement_id: form.submission_agreement_id || null,
          })}>
          {isSaving ? <Spinner size={14} /> : <Save size={14} />}
          {initial ? t('resources.form.saveChanges') : t('acquisitions.accession.createAccession')}
        </button>
      </div>
    </div>
  )
}

function LinkedNodes({ accessionId }: { accessionId: number }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: nodes = [] } = useQuery({
    queryKey: ['accession-nodes', accessionId],
    queryFn: () => acquisitionsApi.getAccessionNodes(accessionId).then(r => r.data.data),
  })
  const unlinkMutation = useMutation({
    mutationFn: (nodeId: number) => acquisitionsApi.unlinkNode(accessionId, nodeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accession-nodes', accessionId] }),
  })
  return (
    <div className={styles.attachSection}>
      <div className={styles.attachHeader}>
        <span className={styles.attachTitle}><Link2 size={13} /> {t('acquisitions.accession.linkedResources')}</span>
      </div>
      {(nodes as any[]).length === 0 && (
        <p className={styles.empty}>
          {t('acquisitions.accession.noneLinkedHint')}
        </p>
      )}
      {(nodes as any[]).map((n: any) => (
        <div key={n.id} className={styles.attachRow}>
          <a
            href={`/app/resources?node=${n.id}`}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 1, minWidth: 0, textDecoration: 'none' }}
            title={t('acquisitions.accession.openInResources', { ref: n.ref_code })}
          >
            <ExternalLink size={12} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
            <code style={{ fontSize: 'var(--text-xs)', color: 'var(--color-accent)', flexShrink: 0 }}>{n.ref_code}</code>
            <span className={styles.attachName}>{n.title}</span>
          </a>
          <button className="btn btn-ghost btn-sm btn-icon"
            onClick={() => unlinkMutation.mutate(n.id)}>
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}

function AccessionDetail({ accession, onEdit, onDeleted, onNavigate }: {
  accession: any; onEdit: () => void; onDeleted: () => void
  onNavigate: (section: string, id: number) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const deleteMutation = useMutation({
    mutationFn: () => acquisitionsApi.deleteAccession(accession.id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['accessions'] }); onDeleted() },
  })
  const obj = accession
  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <div>
          <div className={styles.detailRef}>{obj.accession_number}</div>
          <h2 className={styles.detailTitle}>{obj.title}</h2>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
            <StatusBadge status={obj.status} />
            {obj.creator_agent_name && <span className={styles.detailMeta}>{obj.creator_agent_name}</span>}
          </div>
        </div>
        <div className={styles.detailActions}>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onEdit}><Pencil size={14} /></button>
          <button className="btn btn-ghost btn-sm btn-icon"
            onClick={() => { if (confirm(t('acquisitions.accession.deleteConfirm'))) deleteMutation.mutate() }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className={styles.detailBody}>
        {obj.delivery_ref && (
          <div className={styles.field}>
            <dt className={styles.fieldLabel}>{t('acquisitions.accession.delivery')}</dt>
            <dd className={styles.fieldValue}>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', color: 'var(--color-accent)', padding: 0, fontSize: 'var(--text-sm)' }}
                onClick={() => onNavigate('deliveries', obj.delivery_id)}>
                {obj.delivery_ref} ↗
              </button>
            </dd>
          </div>
        )}
        {obj.date_received && <Field label={t('acquisitions.accession.dateReceived')} value={obj.date_received} />}
        {obj.date_accessioned && <Field label={t('acquisitions.accession.dateAccessioned')} value={obj.date_accessioned} />}
        {obj.extent && <Field label={t('acquisitions.accession.extent')} value={obj.extent} />}
        {obj.description && <Field label={t('resources.form.fields.description')} value={obj.description} multi />}
        {obj.appraisal_decision && <Field label={t('acquisitions.accession.appraisalDecision')} value={obj.appraisal_decision} multi />}
        {obj.access_restrictions && <Field label={t('acquisitions.accession.accessRestrictions')} value={obj.access_restrictions} multi />}
        {obj.processing_notes && <Field label={t('acquisitions.accession.processingNotes')} value={obj.processing_notes} multi />}
        {obj.disposition_notes && <Field label={t('acquisitions.accession.dispositionNotes')} value={obj.disposition_notes} multi />}
        {obj.accessioned_by && <Field label={t('acquisitions.accession.accessionedBy')} value={obj.accessioned_by} />}
        <LinkedNodes accessionId={obj.id} />
      </div>
    </div>
  )
}

// ─── Shared Field ─────────────────────────────────────────────────────

function Field({ label, value, multi }: { label: string; value: string; multi?: boolean }) {
  return (
    <div className={styles.field}>
      <dt className={styles.fieldLabel}>{label}</dt>
      <dd className={styles.fieldValue} style={{ whiteSpace: multi ? 'pre-wrap' : undefined }}>
        {value}
      </dd>
    </div>
  )
}

// ─── Generic list + detail panel ─────────────────────────────────────

function ListPanel<T extends { id: number; reference_number?: string; accession_number?: string; title: string; status: string }>({
  items, isLoading, selectedId, onSelect, onNew, newLabel, heading, statuses, statusLabel,
  presetFilter, onPresetFilterConsumed, accessions,
}: {
  items: T[]; isLoading: boolean; selectedId: number | null
  onSelect: (item: T) => void; onNew: () => void; newLabel: string
  heading: string
  statuses?: { value: string; label: string }[]
  statusLabel?: (s: string) => string
  // Special cross-referenced filters set from the Overview dashboard's
  // "View all" links — distinct from the plain status chips.
  presetFilter?: string | null
  onPresetFilterConsumed?: () => void
  accessions?: any[]
}) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [specialFilter, setSpecialFilter] = useState<string | null>(null)

  // Adopt an incoming preset filter (from Overview) once, then let the page
  // clear it so navigating away and back doesn't re-trigger it.
  useEffect(() => {
    if (presetFilter) {
      setSpecialFilter(presetFilter)
      setStatusFilter('')
      onPresetFilterConsumed?.()
    }
  }, [presetFilter])

  const accessionedIds = new Set((accessions ?? []).map((a: any) => a.delivery_id).filter(Boolean))

  const filtered = items.filter((i: any) => {
    if (statusFilter && i.status !== statusFilter) return false
    if (specialFilter === 'unaccessioned' && accessionedIds.has(i.id)) return false
    if (specialFilter === 'checklist_incomplete') {
      const chk = (i as any).checklist ?? []
      if (chk.length === 0 || !chk.some((c: any) => !c.checked)) return false
    }
    if (q) {
      const ql = q.toLowerCase()
      return (i.reference_number ?? i.accession_number ?? '').toLowerCase().includes(ql) ||
             i.title.toLowerCase().includes(ql)
    }
    return true
  })

  const SPECIAL_LABELS: Record<string, string> = {
    unaccessioned: t('acquisitions.special.unaccessioned'),
    checklist_incomplete: t('acquisitions.special.checklistIncomplete'),
  }

  return (
    <div className={styles.list}>
      <div className={styles.listTopBar}>
        <h2 className={styles.listHeading}>{heading}</h2>
        <button className="btn btn-primary btn-sm" onClick={onNew}>
          <Plus size={13} /> {newLabel}
        </button>
      </div>

      <div className={styles.listSearch}>
        <Search size={13} className={styles.listSearchIcon} />
        <input
          className={styles.listSearchInput}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={t('relations.picker.searchPlaceholder')}
        />
        {q && <button className={styles.listSearchClear} onClick={() => setQ('')}><X size={11} /></button>}
      </div>

      {specialFilter && (
        <div className={styles.specialFilterBar}>
          <span className={styles.specialFilterChip}>
            {SPECIAL_LABELS[specialFilter] ?? specialFilter}
            <button onClick={() => setSpecialFilter(null)}><X size={11} /></button>
          </span>
        </div>
      )}

      {statuses && statuses.length > 0 && (
        <div className={styles.statusFilterBar}>
          <button
            className={`${styles.statusChip} ${statusFilter === '' ? styles.statusChipActive : ''}`}
            onClick={() => setStatusFilter('')}
          >{t('flags.all')}</button>
          {statuses.map(s => (
            <button
              key={s.value}
              className={`${styles.statusChip} ${statusFilter === s.value ? styles.statusChipActive : ''}`}
              onClick={() => setStatusFilter(statusFilter === s.value ? '' : s.value)}
            >{s.label}</button>
          ))}
        </div>
      )}

      <div className={styles.listScroll}>
        {isLoading && <div style={{ padding: 'var(--space-4)' }}><Spinner size={16} /></div>}
        {!isLoading && filtered.length === 0 && (
          <p className={styles.empty}>{q || statusFilter ? t('acquisitions.list.noMatches') : t('acquisitions.list.nothingYet')}</p>
        )}
        {filtered.map(item => (
          <button key={item.id} className={`${styles.listItem} ${item.id === selectedId ? styles.listItemActive : ''}`}
            onClick={() => onSelect(item)}>
            <div className={styles.listItemLeft}>
              <code className={styles.listItemRef}>{item.reference_number ?? item.accession_number}</code>
              <span className={styles.listItemTitle}>{item.title}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <StatusBadge status={item.status} label={statusLabel?.(item.status)} />
              <ChevronRight size={13} style={{ color: 'var(--color-ink-faint)' }} />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────

type Section = 'overview' | 'agreements' | 'deliveries' | 'accessions'

// ─── Overview dashboard ────────────────────────────────────────────────
// Pure derived view over the already-loaded SA/delivery/accession lists —
// no extra API calls. Surfaces pipeline counts, checklist progress, and a
// small "needs attention" list built from real status/link cross-references
// (no invented date fields).

function OverviewSection({ sas, deliveries, accessions, onNavigate }: {
  sas: any[]; deliveries: any[]; accessions: any[]
  onNavigate: (section: Section, id: number, presetFilter?: string) => void
}) {
  const { t } = useTranslation()
  const saCounts: Record<string, number> = {}
  for (const s of sas) saCounts[s.status] = (saCounts[s.status] ?? 0) + 1

  const delCounts: Record<string, number> = {}
  for (const d of deliveries) delCounts[d.status] = (delCounts[d.status] ?? 0) + 1

  const accessionedDeliveryIds = new Set(
    accessions.map((a: any) => a.delivery_id).filter(Boolean)
  )

  // Received (or later-stage) deliveries with no accession yet — a real gap,
  // not a guessed deadline.
  const awaitingAccession = deliveries.filter((d: any) =>
    ['received', 'in_review', 'accepted', 'partially_accepted'].includes(d.status) &&
    !accessionedDeliveryIds.has(d.id)
  )

  // Deliveries with an incomplete checklist (checklist array present, not all done).
  const incompleteChecklists = deliveries.filter((d: any) => {
    const items = d.checklist ?? []
    return items.length > 0 && items.some((i: any) => !i.checked)
  })

  return (
    <div className={styles.overview}>
      {/* ── Status breakdowns ── */}
      <div className={styles.overviewGrid}>
        <div className={styles.overviewPanel}>
          <h3 className={styles.overviewPanelTitle}>{t('acquisitions.overview.agreementsByStatus')}</h3>
          {SA_STATUSES.map(s => (
            <div key={s} className={styles.statusBar}>
              <span className={styles.statusBarLabel}>{t(`acquisitions.statusLabels.${STATUS_KEY_MAP[s]}`, { defaultValue: s })}</span>
              <div className={styles.statusBarTrack}>
                <div className={styles.statusBarFill}
                  style={{ width: sas.length ? `${((saCounts[s] ?? 0) / sas.length) * 100}%` : '0%' }} />
              </div>
              <span className={styles.statusBarCount}>{saCounts[s] ?? 0}</span>
            </div>
          ))}
        </div>

        <div className={styles.overviewPanel}>
          <h3 className={styles.overviewPanelTitle}>{t('acquisitions.overview.deliveriesByStatus')}</h3>
          {DELIVERY_STATUSES.map(s => (
            <div key={s.value} className={styles.statusBar}>
              <span className={styles.statusBarLabel}>{t(`acquisitions.statusLabels.${STATUS_KEY_MAP[s.value]}`)}</span>
              <div className={styles.statusBarTrack}>
                <div className={styles.statusBarFill}
                  style={{ width: deliveries.length ? `${((delCounts[s.value] ?? 0) / deliveries.length) * 100}%` : '0%' }} />
              </div>
              <span className={styles.statusBarCount}>{delCounts[s.value] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Needs attention ── */}
      <div className={styles.overviewPanel}>
        <h3 className={styles.overviewPanelTitle}>{t('acquisitions.overview.needsAttention')}</h3>

        {awaitingAccession.length === 0 && incompleteChecklists.length === 0 && (
          <p className={styles.empty}>{t('acquisitions.overview.nothingNeeds')}</p>
        )}

        {awaitingAccession.length > 0 && (
          <div className={styles.attentionGroup}>
            <div className={styles.attentionGroupHeader}>
              <span className={styles.attentionGroupTitle}>
                {t('acquisitions.overview.receivedNotAccessioned', { count: awaitingAccession.length })}
              </span>
              {awaitingAccession.length > ATTENTION_PREVIEW && (
                <button className={styles.attentionViewAll}
                  onClick={() => onNavigate('deliveries', 0, 'unaccessioned')}>
                  {t('acquisitions.overview.viewAll', { count: awaitingAccession.length })}
                </button>
              )}
            </div>
            {awaitingAccession.slice(0, ATTENTION_PREVIEW).map((d: any) => (
              <button key={d.id} className={styles.attentionRow} onClick={() => onNavigate('deliveries', d.id)}>
                <code className={styles.listItemRef}>{d.reference_number}</code>
                <span className={styles.attentionRowTitle}>{d.title}</span>
                <StatusBadge status={d.status}
                  label={t(`acquisitions.statusLabels.${STATUS_KEY_MAP[d.status]}`, { defaultValue: d.status })} />
              </button>
            ))}
          </div>
        )}

        {incompleteChecklists.length > 0 && (
          <div className={styles.attentionGroup}>
            <div className={styles.attentionGroupHeader}>
              <span className={styles.attentionGroupTitle}>
                {t('acquisitions.overview.incompleteChecklistCount', { count: incompleteChecklists.length })}
              </span>
              {incompleteChecklists.length > ATTENTION_PREVIEW && (
                <button className={styles.attentionViewAll}
                  onClick={() => onNavigate('deliveries', 0, 'checklist_incomplete')}>
                  {t('acquisitions.overview.viewAll', { count: incompleteChecklists.length })}
                </button>
              )}
            </div>
            {incompleteChecklists.slice(0, ATTENTION_PREVIEW).map((d: any) => {
              const items = d.checklist ?? []
              const done = items.filter((i: any) => i.checked).length
              return (
                <button key={d.id} className={styles.attentionRow} onClick={() => onNavigate('deliveries', d.id)}>
                  <code className={styles.listItemRef}>{d.reference_number}</code>
                  <span className={styles.attentionRowTitle}>{d.title}</span>
                  <span className={styles.attentionRowProgress}>{done}/{items.length} {t('acquisitions.overview.doneSuffix')}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default function AcquisitionsPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [section, setSection] = useState<Section>(
    (searchParams.get('section') as Section) ?? 'overview'
  )
  const [selectedId, setSelectedId] = useState<number | null>(
    searchParams.get('id') ? parseInt(searchParams.get('id')!) : null
  )
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list')
  const queryClient = useQueryClient()

  const select = (id: number) => { setSelectedId(id); setMode('list') }
  const deselect = () => { setSelectedId(null); setMode('list') }
  const switchSection = (s: Section) => { setSection(s); setSelectedId(null); setMode('list') }
  const [presetFilter, setPresetFilter] = useState<string | null>(null)
  const navigateFromOverview = (s: Section, id: number, filter?: string) => {
    setSection(s); setMode('list')
    setSelectedId(id > 0 ? id : null)
    setPresetFilter(filter ?? null)
  }

  // SA
  const { data: sas = [], isLoading: loadingSAs } = useQuery({
    queryKey: ['submission-agreements'],
    queryFn: () => acquisitionsApi.listSAs().then(r => r.data.data),
  })
  const createSAMutation = useMutation({
    mutationFn: (d: any) => acquisitionsApi.createSA(d),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['submission-agreements'] })
      setSelectedId(res.data.data.id); setMode('list')
    },
  })
  const updateSAMutation = useMutation({
    mutationFn: (d: any) => acquisitionsApi.updateSA(selectedId!, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['submission-agreements'] })
      queryClient.invalidateQueries({ queryKey: ['sa', selectedId] })
      setMode('list')
    },
  })

  // Deliveries
  const { data: deliveries = [], isLoading: loadingDels } = useQuery({
    queryKey: ['deliveries'],
    queryFn: () => acquisitionsApi.listDeliveries().then(r => r.data.data),
  })
  const createDelMutation = useMutation({
    mutationFn: (d: any) => acquisitionsApi.createDelivery(d),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] })
      setSelectedId(res.data.data.id); setMode('list')
    },
  })
  const updateDelMutation = useMutation({
    mutationFn: (d: any) => acquisitionsApi.updateDelivery(selectedId!, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] })
      queryClient.invalidateQueries({ queryKey: ['delivery', selectedId] })
      setMode('list')
    },
  })

  // Accessions
  const { data: accessions = [], isLoading: loadingAcc } = useQuery({
    queryKey: ['accessions'],
    queryFn: () => acquisitionsApi.listAccessions().then(r => r.data.data),
  })
  const createAccMutation = useMutation({
    mutationFn: (d: any) => acquisitionsApi.createAccession(d),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['accessions'] })
      setSelectedId(res.data.data.id); setMode('list')
    },
  })
  const updateAccMutation = useMutation({
    mutationFn: (d: any) => acquisitionsApi.updateAccession(selectedId!, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accessions'] })
      setMode('list')
    },
  })

  const SECTION_TABS = [
    { key: 'overview',    icon: <LayoutDashboard size={14} />, label: t('locations.detail.overview') },
    { key: 'agreements',  icon: <FileText size={14} />, label: `${t('acquisitions.page.agreements')}${sas.length ? ` (${(sas as any[]).length})` : ''}` },
    { key: 'deliveries',  icon: <Truck size={14} />,    label: `${t('acquisitions.page.deliveries')}${deliveries.length ? ` (${(deliveries as any[]).length})` : ''}` },
    { key: 'accessions',  icon: <Archive size={14} />,  label: `${t('resources.tabs.accessions')}${accessions.length ? ` (${(accessions as any[]).length})` : ''}` },
  ]

  const selectedSA  = (sas as any[]).find((s: any) => s.id === selectedId)
  const selectedDel = (deliveries as any[]).find((d: any) => d.id === selectedId)
  const selectedAcc = (accessions as any[]).find((a: any) => a.id === selectedId)

  return (
    <div className={styles.page}>
      {/* Section tabs */}
      <div className={styles.sectionTabs}>
        {SECTION_TABS.map(st => (
          <button key={st.key}
            className={`${styles.sectionTab} ${section === st.key ? styles.sectionTabActive : ''}`}
            onClick={() => switchSection(st.key as Section)}>
            {st.icon} {st.label}
          </button>
        ))}
      </div>

      <div className={styles.body}>
        {/* List */}
        {section === 'overview' && (
          <OverviewSection
            sas={sas as any[]} deliveries={deliveries as any[]} accessions={accessions as any[]}
            onNavigate={navigateFromOverview}
          />
        )}
        {section === 'agreements' && (
          <ListPanel
            items={sas as any[]} isLoading={loadingSAs} selectedId={selectedId}
            onSelect={i => select(i.id)} onNew={() => { setSelectedId(null); setMode('create') }}
            newLabel={t('resources.tree.newButton')}
            heading={t('acquisitions.page.agreements')}
            statuses={SA_STATUSES.map(s => ({ value: s, label: t(`acquisitions.statusLabels.${STATUS_KEY_MAP[s]}`, { defaultValue: s }) }))}
          />
        )}
        {section === 'deliveries' && (
          <ListPanel
            items={deliveries as any[]} isLoading={loadingDels} selectedId={selectedId}
            onSelect={i => select(i.id)} onNew={() => { setSelectedId(null); setMode('create') }}
            newLabel={t('resources.tree.newButton')}
            heading={t('acquisitions.page.deliveries')}
            statuses={DELIVERY_STATUSES.map(s => ({ value: s.value, label: t(`acquisitions.statusLabels.${STATUS_KEY_MAP[s.value]}`) }))}
            statusLabel={s => t(`acquisitions.statusLabels.${STATUS_KEY_MAP[s]}`, { defaultValue: s })}
            presetFilter={presetFilter}
            onPresetFilterConsumed={() => setPresetFilter(null)}
            accessions={accessions as any[]}
          />
        )}
        {section === 'accessions' && (
          <ListPanel
            items={(accessions as any[]).map((a: any) => ({ ...a, reference_number: a.accession_number }))}
            isLoading={loadingAcc} selectedId={selectedId}
            onSelect={i => select(i.id)} onNew={() => { setSelectedId(null); setMode('create') }}
            newLabel={t('resources.tree.newButton')}
            heading={t('resources.tabs.accessions')}
          />
        )}

        {/* Detail / form */}
        {section !== 'overview' && (
        <div className={styles.detailPane}>
          {mode === 'create' && section === 'agreements' && (
            <SAForm onSave={d => createSAMutation.mutate(d)}
              onCancel={() => setMode('list')} isSaving={createSAMutation.isPending} />
          )}
          {mode === 'edit' && section === 'agreements' && selectedSA && (
            <SAForm initial={selectedSA}
              onSave={d => updateSAMutation.mutate(d)}
              onCancel={() => setMode('list')} isSaving={updateSAMutation.isPending} />
          )}
          {mode === 'list' && section === 'agreements' && selectedSA && (
            <SADetail sa={selectedSA} onEdit={() => setMode('edit')} onDeleted={deselect} />
          )}

          {mode === 'create' && section === 'deliveries' && (
            <DeliveryForm onSave={d => createDelMutation.mutate(d)}
              onCancel={() => setMode('list')} isSaving={createDelMutation.isPending} />
          )}
          {mode === 'edit' && section === 'deliveries' && selectedDel && (
            <DeliveryForm initial={selectedDel}
              onSave={d => updateDelMutation.mutate(d)}
              onCancel={() => setMode('list')} isSaving={updateDelMutation.isPending} />
          )}
          {mode === 'list' && section === 'deliveries' && selectedDel && (
            <DeliveryDetail delivery={selectedDel} onEdit={() => setMode('edit')} onDeleted={deselect}
            onNavigate={(sec, id) => { setSection(sec as Section); setSelectedId(id) }} />
          )}

          {mode === 'create' && section === 'accessions' && (
            <AccessionForm onSave={d => createAccMutation.mutate(d)}
              onCancel={() => setMode('list')} isSaving={createAccMutation.isPending} />
          )}
          {mode === 'edit' && section === 'accessions' && selectedAcc && (
            <AccessionForm initial={selectedAcc}
              onSave={d => updateAccMutation.mutate(d)}
              onCancel={() => setMode('list')} isSaving={updateAccMutation.isPending} />
          )}
          {mode === 'list' && section === 'accessions' && selectedAcc && (
            <AccessionDetail accession={selectedAcc} onEdit={() => setMode('edit')} onDeleted={deselect}
            onNavigate={(sec, id) => { setSection(sec as Section); setSelectedId(id) }} />
          )}

          {mode === 'list' && !selectedId && (
            <div className={styles.noSelection}>
              {section === 'agreements' && <FileText size={40} style={{ opacity: 0.1, marginBottom: 'var(--space-4)' }} />}
              {section === 'deliveries' && <Truck size={40} style={{ opacity: 0.1, marginBottom: 'var(--space-4)' }} />}
              {section === 'accessions' && <Archive size={40} style={{ opacity: 0.1, marginBottom: 'var(--space-4)' }} />}
              <p>{t('acquisitions.page.selectOrCreate')}</p>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  )
}