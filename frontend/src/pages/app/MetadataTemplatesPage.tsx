import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, X, Save, GripVertical, ChevronDown, ChevronRight,
  Type, AlignLeft, Hash, Calendar, List, CheckSquare, Link2, Mail,
  Layers, Copy, Pencil, AlertCircle, Upload, Check, Plug
} from 'lucide-react'
import { templatesApi } from '@/api'
import api from '@/api/client'
import { Spinner } from '@/components/ui'
import type { ExternalIntegration } from '@/types'
import { useTranslation } from 'react-i18next'
import styles from './MetadataTemplatesPage.module.css'

// ─── Field type registry ──────────────────────────────────────────────
// Display labels are resolved via fieldTypes.<key> so this registry stays
// a stable, language-independent contract for other files that import it
// (e.g. HierarchyPage.tsx).

export const FIELD_TYPES = {
  text:        { icon: Type,        hasOptions: false, hasPlaceholder: true },
  textarea:    { icon: AlignLeft,   hasOptions: false, hasPlaceholder: true },
  number:      { icon: Hash,        hasOptions: false, hasPlaceholder: true },
  date:        { icon: Calendar,    hasOptions: false, hasPlaceholder: false },
  select:      { icon: List,        hasOptions: true,  hasPlaceholder: true },
  multiselect: { icon: Layers,      hasOptions: true,  hasPlaceholder: true },
  boolean:     { icon: CheckSquare, hasOptions: false, hasPlaceholder: false },
  url:         { icon: Link2,       hasOptions: false, hasPlaceholder: true },
  email:       { icon: Mail,        hasOptions: false, hasPlaceholder: true },
  integration: { icon: Plug,        hasOptions: false, hasPlaceholder: true },
} as const

export type FieldType = keyof typeof FIELD_TYPES

export interface MetadataField {
  name: string
  label: string
  type: FieldType
  required: boolean
  placeholder?: string
  help_text?: string
  options?: string[]
  default_value?: string
  integration_id?: number   // only used when type === 'integration'
}

const ENTITY_TYPE_VALUES = ['resource', 'location', 'classification']
const ENTITY_TYPE_NAV_KEY: Record<string, string> = {
  resource: 'nav.resources', location: 'nav.locations', classification: 'nav.classifications',
}

function emptyField(): MetadataField {
  return { name: '', label: '', type: 'text', required: false }
}

// ─── Field type icon ──────────────────────────────────────────────────

function FieldTypeIcon({ type, size = 14 }: { type: FieldType; size?: number }) {
  const Icon = FIELD_TYPES[type]?.icon ?? Type
  return <Icon size={size} />
}

// ─── Integration picker (used inside FieldEditor) ─────────────────────

function IntegrationPicker({
  value,
  onChange,
}: {
  value: number | undefined
  onChange: (id: number | undefined) => void
}) {
  const { t } = useTranslation()
  const { data: integrations = [], isLoading } = useQuery<ExternalIntegration[]>({
    queryKey: ['integrations-all'],
    queryFn: () => api.get<{ status: string; data: ExternalIntegration[] }>('/integrations')
      .then(r => r.data.data ?? []),
    staleTime: 60_000,
  })

  if (isLoading) return <Spinner size={14} />

  return (
    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
      <label>{t('admin.metadataTemplates.vocabIntegration')}</label>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value ? Number(e.target.value) : undefined)}
        required
      >
        <option value="">{t('admin.metadataTemplates.selectIntegrationEllipsis')}</option>
        {integrations.map(intg => (
          <option key={intg.id} value={intg.id}>
            {intg.name} — {intg.base_url}
          </option>
        ))}
      </select>
      <span className="form-hint">
        {t('admin.metadataTemplates.integrationHint', { field: 'name' })}
      </span>
    </div>
  )
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
  const { t } = useTranslation()
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
      <div className={styles.fieldHeader} onClick={() => setExpanded(v => !v)}>
        <div className={styles.fieldHeaderLeft}>
          <button className={styles.dragHandle}
            onClick={e => e.stopPropagation()} title={t('admin.metadataTemplates.reorderTitle')}>
            <GripVertical size={14} />
          </button>
          <div className={styles.fieldTypeTag}>
            <FieldTypeIcon type={field.type} size={12} />
          </div>
          <span className={styles.fieldLabel}>
            {field.label || <em style={{ opacity: 0.5 }}>{t('admin.metadataTemplates.untitledField')}</em>}
          </span>
          {field.name && (
            <code className={styles.fieldName}>{field.name}</code>
          )}
          {field.required && <span className={styles.requiredBadge}>{t('admin.metadataTemplates.requiredBadge')}</span>}
          {field.type === 'integration' && field.integration_id && (
            <span className={styles.integrationBadge}>
              <Plug size={10} /> {t('admin.metadataTemplates.vocabBadge')}
            </span>
          )}
        </div>
        <div className={styles.fieldHeaderRight} onClick={e => e.stopPropagation()}>
          <button className="btn btn-ghost btn-sm btn-icon" disabled={index === 0}
            onClick={onMoveUp} title={t('admin.metadataTemplates.moveUp')}>↑</button>
          <button className="btn btn-ghost btn-sm btn-icon" disabled={index === total - 1}
            onClick={onMoveDown} title={t('admin.metadataTemplates.moveDown')}>↓</button>
          <button className="btn btn-ghost btn-sm btn-icon"
            onClick={onDelete} title={t('admin.metadataTemplates.deleteField')}>
            <Trash2 size={13} />
          </button>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>

      {expanded && (
        <div className={styles.fieldBody}>
          <div className={styles.fieldGrid}>
            <div className="form-group">
              <label>{t('admin.vocab.checklist.label')}</label>
              <input value={field.label} onChange={e => handleLabelChange(e.target.value)}
                placeholder={t('admin.metadataTemplates.labelPlaceholder')} autoFocus={!field.name} />
            </div>

            <div className="form-group">
              <label>{t('admin.metadataTemplates.fieldKey')}</label>
              <input
                value={field.name}
                onChange={e => onChange({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                placeholder={t('admin.metadataTemplates.fieldKeyPlaceholder')}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}
              />
              <span className="form-hint">{t('admin.metadataTemplates.fieldKeyHint')}</span>
            </div>

            <div className="form-group">
              <label>{t('admin.metadataTemplates.fieldType')}</label>
              <select
                value={field.type}
                onChange={e => onChange({
                  type: e.target.value as FieldType,
                  options: [],
                  integration_id: undefined,
                })}
              >
                {Object.keys(FIELD_TYPES).map(val => (
                  <option key={val} value={val}>{t(`fieldTypes.${val}`)}</option>
                ))}
              </select>
            </div>

            {def.hasPlaceholder && (
              <div className="form-group">
                <label>{t('admin.metadataTemplates.placeholder')}</label>
                <input value={field.placeholder ?? ''} onChange={e => onChange({ placeholder: e.target.value })}
                  placeholder={t('admin.metadataTemplates.placeholderHint')} />
              </div>
            )}

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>{t('admin.metadataTemplates.helpText')}</label>
              <input value={field.help_text ?? ''} onChange={e => onChange({ help_text: e.target.value })}
                placeholder={t('admin.metadataTemplates.helpTextPlaceholder')} />
            </div>

            {field.type !== 'boolean' && field.type !== 'integration' && (
              <div className="form-group">
                <label>{t('admin.metadataTemplates.defaultValue')}</label>
                <input value={field.default_value ?? ''}
                  onChange={e => onChange({ default_value: e.target.value })}
                  placeholder={t('admin.metadataTemplates.defaultValuePlaceholder')} />
              </div>
            )}

            <div className="form-group">
              <label className={styles.checkboxLabel}>
                <input type="checkbox" checked={field.required}
                  onChange={e => onChange({ required: e.target.checked })} />
                {t('admin.metadataTemplates.requiredField')}
              </label>
            </div>

            {/* Integration picker — only shown for vocabulary fields */}
            {field.type === 'integration' && (
              <IntegrationPicker
                value={field.integration_id}
                onChange={id => onChange({ integration_id: id })}
              />
            )}
          </div>

          {/* Options editor for select/multiselect */}
          {def.hasOptions && (
            <div className={styles.optionsSection}>
              <div className={styles.optionsSectionHeader}>
                <span className={styles.optionsSectionTitle}>{t('admin.metadataTemplates.options')}</span>
                <button className="btn btn-secondary btn-sm"
                  onClick={() => onChange({ options: [...(field.options ?? []), ''] })}>
                  <Plus size={12} /> {t('admin.metadataTemplates.addOption')}
                </button>
              </div>
              {(!field.options || field.options.length === 0) && (
                <p className={styles.optionsEmpty}>{t('admin.metadataTemplates.noOptionsYet')}</p>
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
                    placeholder={t('admin.metadataTemplates.optionPlaceholder', { num: oi + 1 })}
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

// ─── Template editor ──────────────────────────────────────────────────

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
  const { t } = useTranslation()
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

  const canSave = name.trim() && fields.every(f => {
    if (!f.name || !f.label) return false
    if (f.type === 'integration' && !f.integration_id) return false
    return true
  })

  return (
    <div className={styles.editor}>
      <div className={styles.editorHeader}>
        <h2 className={styles.editorTitle}>
          {initial ? t('admin.metadataTemplates.editTemplate') : t('admin.vocab.checklist.newTemplate')}
        </h2>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onCancel}>
          <X size={14} />
        </button>
      </div>

      <div className={styles.editorBody}>
        <div className={styles.templateMeta}>
          <div className={styles.metaGrid}>
            <div className="form-group">
              <label>{t('admin.metadataTemplates.templateName')}</label>
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder={t('admin.metadataTemplates.templateNamePlaceholder')} autoFocus />
            </div>
            <div className="form-group">
              <label>{t('admin.metadataTemplates.appliesToRequired')}</label>
              <select value={entityType} onChange={e => setEntityType(e.target.value)}>
                {ENTITY_TYPE_VALUES.map(et => (
                  <option key={et} value={et}>{t(ENTITY_TYPE_NAV_KEY[et])}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>{t('resources.form.fields.description')}</label>
              <input value={description} onChange={e => setDescription(e.target.value)}
                placeholder={t('admin.metadataTemplates.descriptionPlaceholder')} />
            </div>
          </div>
        </div>

        <div className={styles.fieldsSection}>
          <div className={styles.fieldsSectionHeader}>
            <div>
              <h3 className={styles.fieldsSectionTitle}>{t('admin.metadataTemplates.fields')}</h3>
              <p className={styles.fieldsSectionDesc}>
                {fields.length === 0
                  ? t('admin.metadataTemplates.noFieldsYet')
                  : t('admin.metadataTemplates.fieldsDefined', { count: fields.length })}
              </p>
            </div>
            <div className={styles.addFieldButtons}>
              {Object.entries(FIELD_TYPES).map(([type, { icon: Icon }]) => (
                <button
                  key={type}
                  className={styles.addFieldBtn}
                  onClick={() => setFields(prev => [...prev, { ...emptyField(), type: type as FieldType }])}
                  title={t('admin.metadataTemplates.addFieldTitle', { type: t(`fieldTypes.${type}`) })}
                >
                  <Icon size={13} />
                  {t(`fieldTypes.${type}`)}
                </button>
              ))}
            </div>
          </div>

          {fields.length === 0 && (
            <div className={styles.emptyFields}>
              <Layers size={28} style={{ opacity: 0.2, marginBottom: 'var(--space-2)' }} />
              <p>{t('admin.metadataTemplates.clickFieldTypeHint')}</p>
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
            <AlertCircle size={13} /> {t('admin.metadataTemplates.validationHint')}
            {fields.some(f => f.type === 'integration' && !f.integration_id) && t('admin.metadataTemplates.andVocabIntegration')}
          </span>
        )}
        <div className={styles.editorFooterActions}>
          <button className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={!canSave || isSaving}
            onClick={() => onSave({ name: name.trim(), description: description.trim() || null, entity_type: entityType, fields })}>
            {isSaving ? <Spinner size={14} /> : <Save size={14} />}
            {initial ? t('resources.form.saveChanges') : t('admin.vocab.checklist.createTemplate')}
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
  const { t } = useTranslation()
  const entityLabel = ENTITY_TYPE_NAV_KEY[template.entity_type] ? t(ENTITY_TYPE_NAV_KEY[template.entity_type]) : template.entity_type

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
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onDuplicate} title={t('admin.labelDesigner.duplicate')}>
            <Copy size={13} />
          </button>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onEdit} title={t('common.edit')}>
            <Pencil size={13} />
          </button>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onDelete} title={t('common.delete')}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className={styles.cardMeta}>
        <span className={styles.entityTypeBadge}>{entityLabel}</span>
        <span className={styles.fieldCount}>
          {t('admin.hierarchy.fieldsCount', { count: template.fields?.length ?? 0 })}
        </span>
      </div>

      {template.fields?.length > 0 && (
        <div className={styles.cardFields}>
          {template.fields.map((f: MetadataField) => (
            <div key={f.name} className={styles.cardFieldPill}>
              <FieldTypeIcon type={f.type} size={11} />
              <span>{f.label}</span>
              {f.required && <span className={styles.reqDot} title={t('admin.metadataTemplates.requiredTitle')}>*</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Import modal ─────────────────────────────────────────────────────

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation()
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
    onError: (e: any) => setImportError(e.response?.data?.message ?? t('agents.import.failed')),
  })

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 600 }}
      onClick={onClose}>
      <div style={{ width: 480, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-5)', borderBottom: '1px solid var(--color-border)' }}>
          <h3 style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Upload size={16} /> {t('admin.metadataTemplates.importTemplates')}
          </h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><X size={14} /></button>
        </div>
        <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {result ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
              <Check size={28} style={{ color: 'var(--color-success)', marginBottom: 'var(--space-3)' }} />
              <div style={{ fontWeight: 600, fontSize: 'var(--text-lg)', marginBottom: 'var(--space-2)' }}>{t('admin.metadataTemplates.importComplete')}</div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-faint)' }}>
                {t('admin.metadataTemplates.createdUpdated', {
                  created: result.imported?.filter((i: any) => i.action === 'created').length ?? 0,
                  updated: result.imported?.filter((i: any) => i.action === 'updated').length ?? 0,
                })}
              </div>
              {result.skipped?.length > 0 && (
                <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-warning)' }}>
                  {t('classifications.import.skippedCount', { count: result.skipped.length })}
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
                <label>{t('admin.metadataTemplates.jsonFileLabel')}</label>
                <input type="file" accept=".json" onChange={e => setFile(e.target.files?.[0] ?? null)} />
                <span className="form-hint">
                  {t('admin.metadataTemplates.jsonFileHint')}
                </span>
              </div>
              <div style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)', fontFamily: 'var(--font-mono)' }}>
                {`[{ "name": "...", "entity_type": "resource", "fields": [...] }]`}
              </div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', padding: 'var(--space-4) var(--space-5)', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-subtle)' }}>
          <button className="btn btn-ghost" onClick={onClose}>{result ? t('common.close') : t('common.cancel')}</button>
          {!result && (
            <button className="btn btn-primary" disabled={!file || mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? t('resources.modals.import.importing') : <><Upload size={14} /> {t('resources.modals.import.importButton')}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────

export default function MetadataTemplatesPage() {
  const { t } = useTranslation()
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
    mutationFn: (tmpl: any) => templatesApi.create({
      ...tmpl,
      name: `${tmpl.name} (copy)`,
      id: undefined,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['metadata-templates-all'] }),
  })

  if (showImport) return (
    <>
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <div><h1 className={styles.pageTitle}>{t('admin.metadataTemplates.pageTitle')}</h1></div>
          <button className="btn btn-ghost" onClick={() => setShowImport(false)}>{t('admin.metadataTemplates.back')}</button>
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

  const filtered = (templates ?? []).filter((tmpl: any) =>
    !filterType || tmpl.entity_type === filterType
  )

  const grouped: Record<string, any[]> = {}
  for (const tmpl of filtered) {
    const key = tmpl.entity_type
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(tmpl)
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{t('admin.metadataTemplates.pageTitle')}</h1>
          <p className={styles.pageDesc}>
            {t('admin.metadataTemplates.pageDesc')}
          </p>
        </div>
        <div className={styles.pageHeaderActions}>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            className={styles.filterSelect}>
            <option value="">{t('admin.vocab.checklist.allTypes')}</option>
            {ENTITY_TYPE_VALUES.map(et => (
              <option key={et} value={et}>{t(ENTITY_TYPE_NAV_KEY[et])}</option>
            ))}
          </select>
          <button className="btn btn-secondary" onClick={() => setShowImport(true)}>
            <Upload size={14} /> {t('resources.modals.import.importButton')}
          </button>
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            <Plus size={14} /> {t('admin.vocab.checklist.newTemplate')}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className={styles.loadingState}><Spinner size={20} /></div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <Layers size={40} style={{ opacity: 0.2, marginBottom: 'var(--space-4)' }} />
          <h3>{t('admin.metadataTemplates.noTemplatesYet')}</h3>
          <p>{t('admin.metadataTemplates.createTemplateHint')}</p>
          <button className="btn btn-primary" style={{ marginTop: 'var(--space-4)' }}
            onClick={() => setEditing({})}>
            <Plus size={14} /> {t('admin.metadataTemplates.createFirstTemplate')}
          </button>
        </div>
      ) : (
        <div className={styles.templateGroups}>
          {ENTITY_TYPE_VALUES.filter(et => grouped[et]?.length).map(et => (
            <div key={et} className={styles.templateGroup}>
              <div className={styles.groupHeader}>
                <span className={styles.groupTitle}>{t(ENTITY_TYPE_NAV_KEY[et])}</span>
                <span className={styles.groupCount}>{grouped[et].length}</span>
              </div>
              <div className={styles.templateGrid}>
                {grouped[et].map((tmpl: any) => (
                  <TemplateCard
                    key={tmpl.id}
                    template={tmpl}
                    onEdit={() => setEditing(tmpl)}
                    onDelete={() => {
                      if (confirm(t('admin.metadataTemplates.deleteTemplateConfirm', { name: tmpl.name }))) deleteMutation.mutate(tmpl.id)
                    }}
                    onDuplicate={() => duplicateMutation.mutate(tmpl)}
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