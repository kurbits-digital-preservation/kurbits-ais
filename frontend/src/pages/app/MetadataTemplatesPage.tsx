import { useState } from 'react'
import { useQuery, useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import {
  Plus, Trash2, X, Save, GripVertical, ChevronDown, ChevronRight,
  Type, AlignLeft, Hash, Calendar, List, CheckSquare, Link2, Mail,
  Layers, Copy, Pencil, AlertCircle, Upload, Check
} from 'lucide-react'
import { templatesApi } from '@/api'
import { Spinner } from '@/components/ui'
import styles from './MetadataTemplatesPage.module.css'

// ─── Field type registry ──────────────────────────────────────────────

export const FIELD_TYPES = {
  text:        { label: 'Text',         icon: Type,        hasOptions: false, hasPlaceholder: true },
  textarea:    { label: 'Long text',    icon: AlignLeft,   hasOptions: false, hasPlaceholder: true },
  number:      { label: 'Number',       icon: Hash,        hasOptions: false, hasPlaceholder: true },
  date:        { label: 'Date',         icon: Calendar,    hasOptions: false, hasPlaceholder: false },
  select:      { label: 'Dropdown',     icon: List,        hasOptions: true,  hasPlaceholder: true },
  multiselect: { label: 'Multi-select', icon: Layers,      hasOptions: true,  hasPlaceholder: true },
  boolean:     { label: 'Checkbox',     icon: CheckSquare, hasOptions: false, hasPlaceholder: false },
  url:         { label: 'URL',          icon: Link2,       hasOptions: false, hasPlaceholder: true },
  email:       { label: 'Email',        icon: Mail,        hasOptions: false, hasPlaceholder: true },
} as const

export type FieldType = keyof typeof FIELD_TYPES

export interface MetadataField {
  name: string           // snake_case key
  label: string          // display label
  type: FieldType
  required: boolean
  placeholder?: string
  help_text?: string
  options?: string[]     // for select / multiselect
  default_value?: string
}

const ENTITY_TYPES = [
  { value: 'resource',       label: 'Resources' },
  { value: 'location',       label: 'Locations' },
  { value: 'classification', label: 'Classifications' },
]

function emptyField(): MetadataField {
  return { name: '', label: '', type: 'text', required: false }
}

// ─── Field type icon ──────────────────────────────────────────────────

function FieldTypeIcon({ type, size = 14 }: { type: FieldType; size?: number }) {
  const Icon = FIELD_TYPES[type]?.icon ?? Type
  return <Icon size={size} />
}

// ─── Field editor ─────────────────────────────────────────────────────

function FieldEditor({
  field, index, total,
  onChange, onDelete, onMoveUp, onMoveDown,
}: {
  field: MetadataField
  index: number
  total: number
  onChange: (patch: Partial<MetadataField>) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const [expanded, setExpanded] = useState(!field.name)
  const def = FIELD_TYPES[field.type]

  const handleLabelChange = (label: string) => {
    const name = label.toLowerCase()
      .replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    onChange({ label, name: field.name || name })
  }

  return (
    <div className={`${styles.fieldCard} ${expanded ? styles.fieldCardExpanded : ''}`}>
      {/* Collapsed header */}
      <div className={styles.fieldHeader} onClick={() => setExpanded(v => !v)}>
        <div className={styles.fieldHeaderLeft}>
          <button className={styles.dragHandle}
            onClick={e => e.stopPropagation()} title="Reorder">
            <GripVertical size={14} />
          </button>
          <div className={styles.fieldTypeTag}>
            <FieldTypeIcon type={field.type} size={12} />
          </div>
          <span className={styles.fieldLabel}>
            {field.label || <em style={{ opacity: 0.5 }}>Untitled field</em>}
          </span>
          {field.name && (
            <code className={styles.fieldName}>{field.name}</code>
          )}
          {field.required && <span className={styles.requiredBadge}>required</span>}
        </div>
        <div className={styles.fieldHeaderRight} onClick={e => e.stopPropagation()}>
          <button className="btn btn-ghost btn-sm btn-icon" disabled={index === 0}
            onClick={onMoveUp} title="Move up">↑</button>
          <button className="btn btn-ghost btn-sm btn-icon" disabled={index === total - 1}
            onClick={onMoveDown} title="Move down">↓</button>
          <button className="btn btn-ghost btn-sm btn-icon"
            onClick={onDelete} title="Delete field">
            <Trash2 size={13} />
          </button>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className={styles.fieldBody}>
          <div className={styles.fieldGrid}>
            <div className="form-group">
              <label>Label *</label>
              <input value={field.label} onChange={e => handleLabelChange(e.target.value)}
                placeholder="e.g. Production year" autoFocus={!field.name} />
            </div>

            <div className="form-group">
              <label>Field key *</label>
              <input
                value={field.name}
                onChange={e => onChange({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                placeholder="snake_case key"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}
              />
              <span className="form-hint">Used as the data key — no spaces, auto-generated from label</span>
            </div>

            <div className="form-group">
              <label>Field type *</label>
              <select value={field.type} onChange={e => onChange({ type: e.target.value as FieldType, options: [] })}>
                {Object.entries(FIELD_TYPES).map(([val, { label }]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>

            {def.hasPlaceholder && (
              <div className="form-group">
                <label>Placeholder</label>
                <input value={field.placeholder ?? ''} onChange={e => onChange({ placeholder: e.target.value })}
                  placeholder="Shown when empty…" />
              </div>
            )}

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Help text</label>
              <input value={field.help_text ?? ''} onChange={e => onChange({ help_text: e.target.value })}
                placeholder="Shown below the field to guide users" />
            </div>

            {(field.type !== 'boolean') && (
              <div className="form-group">
                <label>Default value</label>
                <input value={field.default_value ?? ''}
                  onChange={e => onChange({ default_value: e.target.value })}
                  placeholder="Pre-filled value" />
              </div>
            )}

            <div className="form-group">
              <label className={styles.checkboxLabel}>
                <input type="checkbox" checked={field.required}
                  onChange={e => onChange({ required: e.target.checked })} />
                Required field
              </label>
            </div>
          </div>

          {/* Options editor for select/multiselect */}
          {def.hasOptions && (
            <div className={styles.optionsSection}>
              <div className={styles.optionsSectionHeader}>
                <span className={styles.optionsSectionTitle}>Options</span>
                <button className="btn btn-secondary btn-sm"
                  onClick={() => onChange({ options: [...(field.options ?? []), ''] })}>
                  <Plus size={12} /> Add option
                </button>
              </div>
              {(!field.options || field.options.length === 0) && (
                <p className={styles.optionsEmpty}>No options yet. Add at least one.</p>
              )}
              {field.options?.map((opt, oi) => (
                <div key={oi} className={styles.optionRow}>
                  <input
                    className={styles.optionInput}
                    value={opt}
                    onChange={e => {
                      const opts = [...(field.options ?? [])]
                      opts[oi] = e.target.value
                      onChange({ options: opts })
                    }}
                    placeholder={`Option ${oi + 1}`}
                  />
                  <button className="btn btn-ghost btn-sm btn-icon"
                    onClick={() => {
                      const opts = (field.options ?? []).filter((_, i) => i !== oi)
                      onChange({ options: opts })
                    }}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Template editor (create / edit) ─────────────────────────────────

function TemplateEditor({
  initial,
  onSave,
  onCancel,
  isSaving,
}: {
  initial?: any
  onSave: (data: any) => void
  onCancel: () => void
  isSaving: boolean
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [entityType, setEntityType] = useState(initial?.entity_type ?? 'resource')
  const [fields, setFields] = useState<MetadataField[]>(initial?.fields ?? [])

  const updateField = (i: number, patch: Partial<MetadataField>) => {
    setFields(prev => prev.map((f, idx) => idx === i ? { ...f, ...patch } : f))
  }

  const removeField = (i: number) => setFields(prev => prev.filter((_, idx) => idx !== i))

  const moveField = (i: number, dir: -1 | 1) => {
    const next = [...fields]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    setFields(next)
  }

  const canSave = name.trim() && fields.every(f => f.name && f.label)

  return (
    <div className={styles.editor}>
      <div className={styles.editorHeader}>
        <h2 className={styles.editorTitle}>
          {initial ? 'Edit template' : 'New template'}
        </h2>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onCancel}>
          <X size={14} />
        </button>
      </div>

      <div className={styles.editorBody}>
        {/* Template meta */}
        <div className={styles.templateMeta}>
          <div className={styles.metaGrid}>
            <div className="form-group">
              <label>Template name *</label>
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Standard archive item" autoFocus />
            </div>
            <div className="form-group">
              <label>Applies to *</label>
              <select value={entityType} onChange={e => setEntityType(e.target.value)}>
                {ENTITY_TYPES.map(et => (
                  <option key={et.value} value={et.value}>{et.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Description</label>
              <input value={description} onChange={e => setDescription(e.target.value)}
                placeholder="What this template is for…" />
            </div>
          </div>
        </div>

        {/* Field list */}
        <div className={styles.fieldsSection}>
          <div className={styles.fieldsSectionHeader}>
            <div>
              <h3 className={styles.fieldsSectionTitle}>Fields</h3>
              <p className={styles.fieldsSectionDesc}>
                {fields.length === 0
                  ? 'No fields yet. Add fields below.'
                  : `${fields.length} field${fields.length !== 1 ? 's' : ''} defined`}
              </p>
            </div>
            <div className={styles.addFieldButtons}>
              {Object.entries(FIELD_TYPES).map(([type, { label, icon: Icon }]) => (
                <button
                  key={type}
                  className={styles.addFieldBtn}
                  onClick={() => setFields(prev => [...prev, { ...emptyField(), type: type as FieldType }])}
                  title={`Add ${label} field`}
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {fields.length === 0 && (
            <div className={styles.emptyFields}>
              <Layers size={28} style={{ opacity: 0.2, marginBottom: 'var(--space-2)' }} />
              <p>Click a field type above to add your first field</p>
            </div>
          )}

          {fields.map((field, i) => (
            <FieldEditor
              key={i}
              field={field}
              index={i}
              total={fields.length}
              onChange={patch => updateField(i, patch)}
              onDelete={() => removeField(i)}
              onMoveUp={() => moveField(i, -1)}
              onMoveDown={() => moveField(i, 1)}
            />
          ))}
        </div>
      </div>

      <div className={styles.editorFooter}>
        {!canSave && fields.length > 0 && (
          <span className={styles.validationHint}>
            <AlertCircle size={13} /> All fields need a label and key
          </span>
        )}
        <div className={styles.editorFooterActions}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={!canSave || isSaving}
            onClick={() => onSave({ name: name.trim(), description: description.trim() || null, entity_type: entityType, fields })}>
            {isSaving ? <Spinner size={14} /> : <Save size={14} />}
            {initial ? 'Save changes' : 'Create template'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Template card ────────────────────────────────────────────────────

function TemplateCard({
  template, onEdit, onDelete, onDuplicate,
}: {
  template: any; onEdit: () => void; onDelete: () => void; onDuplicate: () => void
}) {
  const entityLabel = ENTITY_TYPES.find(e => e.value === template.entity_type)?.label ?? template.entity_type

  return (
    <div className={styles.templateCard}>
      <div className={styles.cardHeader}>
        <div>
          <div className={styles.cardName}>{template.name}</div>
          {template.description && (
            <div className={styles.cardDesc}>{template.description}</div>
          )}
        </div>
        <div className={styles.cardActions}>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onDuplicate} title="Duplicate">
            <Copy size={13} />
          </button>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onEdit} title="Edit">
            <Pencil size={13} />
          </button>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onDelete} title="Delete">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className={styles.cardMeta}>
        <span className={styles.entityTypeBadge}>{entityLabel}</span>
        <span className={styles.fieldCount}>
          {template.fields?.length ?? 0} field{(template.fields?.length ?? 0) !== 1 ? 's' : ''}
        </span>
      </div>

      {template.fields?.length > 0 && (
        <div className={styles.cardFields}>
          {template.fields.map((f: MetadataField) => (
            <div key={f.name} className={styles.cardFieldPill}>
              <FieldTypeIcon type={f.type} size={11} />
              <span>{f.label}</span>
              {f.required && <span className={styles.reqDot} title="Required">*</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────


// ─── Import modal ─────────────────────────────────────────────────────

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<any>(null)
  const [importError, setImportError] = useState('')

  const mutation = useMutation({
    mutationFn: () => templatesApi.importFile(file!),
    onSuccess: res => {
      setResult(res.data.data)
      setImportError('')
      queryClient.invalidateQueries({ queryKey: ['metadata-templates-all'] })
      onDone()
    },
    onError: (e: any) => setImportError(e.response?.data?.message ?? 'Import failed'),
  })

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 600 }}
      onClick={onClose}>
      <div style={{ width: 480, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-5)', borderBottom: '1px solid var(--color-border)' }}>
          <h3 style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Upload size={16} /> Import templates
          </h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><X size={14} /></button>
        </div>
        <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {result ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
              <Check size={28} style={{ color: 'var(--color-success)', marginBottom: 'var(--space-3)' }} />
              <div style={{ fontWeight: 600, fontSize: 'var(--text-lg)', marginBottom: 'var(--space-2)' }}>Import complete</div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-faint)' }}>
                {result.imported?.filter((i: any) => i.action === 'created').length ?? 0} created,{' '}
                {result.imported?.filter((i: any) => i.action === 'updated').length ?? 0} updated
              </div>
              {result.skipped?.length > 0 && (
                <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-warning)' }}>
                  {result.skipped.length} skipped
                </div>
              )}
            </div>
          ) : (
            <>
              {importError && (
                <div style={{ display: 'flex', gap: 'var(--space-2)', padding: 'var(--space-3)', background: 'var(--color-error-bg)', borderRadius: 'var(--radius-md)', color: 'var(--color-error)', fontSize: 'var(--text-sm)' }}>
                  <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />{importError}
                </div>
              )}
              <div className="form-group">
                <label>Kurbits template JSON file *</label>
                <input type="file" accept=".json" onChange={e => setFile(e.target.files?.[0] ?? null)} />
                <span className="form-hint">
                  JSON array of templates. Existing templates with the same name are updated.
                </span>
              </div>
              <div style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)', fontFamily: 'var(--font-mono)' }}>
                {`[{ "name": "...", "entity_type": "resource", "fields": [...] }]`}
              </div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', padding: 'var(--space-4) var(--space-5)', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-subtle)' }}>
          <button className="btn btn-ghost" onClick={onClose}>{result ? 'Close' : 'Cancel'}</button>
          {!result && (
            <button className="btn btn-primary" disabled={!file || mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? 'Importing…' : <><Upload size={14} /> Import</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function MetadataTemplatesPage() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<any | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [filterType, setFilterType] = useState('')

  const { data: templates, isLoading } = useQuery({
    queryKey: ['metadata-templates-all'],
    queryFn: () => templatesApi.list().then(r => r.data.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => templatesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metadata-templates-all'] })
      queryClient.invalidateQueries({ queryKey: ['metadata-templates'] })
      setEditing(null)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => templatesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metadata-templates-all'] })
      queryClient.invalidateQueries({ queryKey: ['metadata-templates'] })
      setEditing(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => templatesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metadata-templates-all'] })
      queryClient.invalidateQueries({ queryKey: ['metadata-templates'] })
    },
  })

  const duplicateMutation = useMutation({
    mutationFn: (t: any) => templatesApi.create({
      ...t,
      name: `${t.name} (copy)`,
      id: undefined,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['metadata-templates-all'] }),
  })

  if (showImport) return (
    <>
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <div><h1 className={styles.pageTitle}>Metadata templates</h1></div>
          <button className="btn btn-ghost" onClick={() => setShowImport(false)}>← Back</button>
        </div>
      </div>
      <ImportModal onClose={() => setShowImport(false)} onDone={() => setShowImport(false)} />
    </>
  )

  if (editing !== null) {
    const isNew = !editing.id
    const mutation = isNew ? createMutation : updateMutation
    return (
      <TemplateEditor
        initial={editing.id ? editing : undefined}
        onSave={(data) => isNew
          ? createMutation.mutate(data)
          : updateMutation.mutate({ id: editing.id, data })}
        onCancel={() => setEditing(null)}
        isSaving={mutation.isPending}
      />
    )
  }

  const filtered = (templates ?? []).filter((t: any) =>
    !filterType || t.entity_type === filterType
  )

  const grouped: Record<string, any[]> = {}
  for (const t of filtered) {
    const key = t.entity_type
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(t)
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Metadata templates</h1>
          <p className={styles.pageDesc}>
            Reusable field schemas that can be applied to hierarchy levels. Define once, apply anywhere.
          </p>
        </div>
        <div className={styles.pageHeaderActions}>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            className={styles.filterSelect}>
            <option value="">All types</option>
            {ENTITY_TYPES.map(et => (
              <option key={et.value} value={et.value}>{et.label}</option>
            ))}
          </select>
          <button className="btn btn-secondary" onClick={() => setShowImport(true)}>
            <Upload size={14} /> Import
          </button>
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            <Plus size={14} /> New template
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className={styles.loadingState}><Spinner size={20} /></div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <Layers size={40} style={{ opacity: 0.2, marginBottom: 'var(--space-4)' }} />
          <h3>No templates yet</h3>
          <p>Create a template to define reusable sets of metadata fields for your hierarchy levels.</p>
          <button className="btn btn-primary" style={{ marginTop: 'var(--space-4)' }}
            onClick={() => setEditing({})}>
            <Plus size={14} /> Create first template
          </button>
        </div>
      ) : (
        <div className={styles.templateGroups}>
          {ENTITY_TYPES.filter(et => grouped[et.value]?.length).map(et => (
            <div key={et.value} className={styles.templateGroup}>
              <div className={styles.groupHeader}>
                <span className={styles.groupTitle}>{et.label}</span>
                <span className={styles.groupCount}>{grouped[et.value].length}</span>
              </div>
              <div className={styles.templateGrid}>
                {grouped[et.value].map((t: any) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    onEdit={() => setEditing(t)}
                    onDelete={() => {
                      if (confirm(`Delete template "${t.name}"?`)) deleteMutation.mutate(t.id)
                    }}
                    onDuplicate={() => duplicateMutation.mutate(t)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}