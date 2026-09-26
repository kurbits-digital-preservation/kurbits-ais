import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Pencil, Trash2, X, Save, ChevronRight,
  GripVertical, Check, ArrowUpDown, Settings,
  Database, MapPin, Tag, AlertCircle, BookOpen, Download, Layers
} from 'lucide-react'
import { hierarchyApi, templatesApi } from '@/api'
import { Spinner, EmptyState } from '@/components/ui'
import styles from './HierarchyPage.module.css'
import api from '@/api/client'
import { useTranslation } from 'react-i18next'

// ─── Constants ────────────────────────────────────────────────────────

const ENTITY_TYPE_META = {
  resource:       { icon: Database, colour: 'var(--color-accent)' },
  location:       { icon: MapPin,   colour: 'var(--color-success)' },
  classification: { icon: Tag,      colour: '#6B5B8B' },
}

import { FIELD_TYPES, type FieldType, type MetadataField } from './MetadataTemplatesPage'

// ─── Inline editable text ─────────────────────────────────────────────

function InlineEdit({
  value,
  onSave,
  placeholder,
  className,
}: {
  value: string
  onSave: (v: string) => void
  placeholder?: string
  className?: string
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const commit = () => {
    if (draft.trim() && draft !== value) onSave(draft.trim())
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        className={`${styles.inlineInput} ${className ?? ''}`}
        value={draft}
        autoFocus
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
      />
    )
  }
  return (
    <span
      className={`${styles.inlineText} ${className ?? ''}`}
      onClick={() => { setDraft(value); setEditing(true) }}
      title={t('admin.vocab.clickToEdit')}
    >
      {value || <span className={styles.placeholder}>{placeholder}</span>}
      <Pencil size={11} className={styles.inlineEditIcon} />
    </span>
  )
}

// ─── Template loader / saver ──────────────────────────────────────────

function TemplateLoader({ entityType, onLoad }: { entityType: string; onLoad: (fields: MetadataField[]) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data: templates } = useQuery({
    queryKey: ['metadata-templates', entityType],
    queryFn: () => templatesApi.list(entityType).then(r => r.data.data),
    enabled: open,
  })
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(v => !v)} title={t('admin.hierarchy.loadTemplate')}>
        <BookOpen size={13} /> {t('admin.hierarchy.loadTemplate')}
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 100 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', right: 0, top: '100%', marginTop: 4,
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)',
            minWidth: 200, zIndex: 200, overflow: 'hidden',
          }}>
            {!templates?.length ? (
              <p style={{ padding: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--color-ink-faint)' }}>
                {t('admin.hierarchy.noTemplatesSaved')}
              </p>
            ) : templates.map((tmpl: any) => (
              <button key={tmpl.id} style={{
                display: 'block', width: '100%', padding: '10px var(--space-4)',
                background: 'none', border: 'none', borderBottom: '1px solid var(--color-border)',
                cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-sans)',
              }}
              onClick={() => { onLoad(tmpl.fields); setOpen(false) }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{tmpl.name}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)' }}>
                  {t('admin.hierarchy.fieldsCount', { count: tmpl.fields.length })}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function TemplateSaver({ fields, entityType }: { fields: MetadataField[]; entityType: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const saveMutation = useMutation({
    mutationFn: () => templatesApi.create({ name: name.trim(), entity_type: entityType, fields }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metadata-templates', entityType] })
      setName(''); setSaving(false)
    },
  })
  if (!fields.length) return null
  return saving ? (
    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
      <input value={name} onChange={e => setName(e.target.value)}
        placeholder={t('admin.hierarchy.templateNamePlaceholder')} style={{ fontSize: 'var(--text-sm)', padding: '4px 8px', width: 160 }}
        onKeyDown={e => { if (e.key === 'Enter' && name.trim()) saveMutation.mutate(); if (e.key === 'Escape') setSaving(false) }}
        autoFocus />
      <button className="btn btn-primary btn-sm" disabled={!name.trim() || saveMutation.isPending}
        onClick={() => saveMutation.mutate()}>{t('common.save')}</button>
      <button className="btn btn-ghost btn-sm" onClick={() => setSaving(false)}>{t('common.cancel')}</button>
    </div>
  ) : (
    <button className="btn btn-ghost btn-sm" onClick={() => setSaving(true)} title={t('admin.hierarchy.saveAsTemplate')}>
      <Download size={13} /> {t('admin.hierarchy.saveAsTemplate')}
    </button>
  )
}

// ─── Inline integration picker ────────────────────────────────────────

function InlineIntegrationPicker({
  value,
  onChange,
}: {
  value: number | undefined
  onChange: (id: number | undefined) => void
}) {
  const { t } = useTranslation()
  const { data: integrations = [] } = useQuery({
    queryKey:  ['integrations', 'metadata'],
    queryFn:   () => api
      .get<{ status: string; data: any[] }>('/integrations', { params: { entity_type: 'metadata' } })
      .then(r => r.data.data ?? []),
    staleTime: 60_000,
  })

  if (integrations.length === 0) {
    return (
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)', fontStyle: 'italic' }}>
        {t('admin.hierarchy.noVocabIntegrations')}
      </span>
    )
  }

  return (
    <select
      style={{ fontSize: 'var(--text-xs)' }}
      value={value ?? ''}
      onChange={e => onChange(e.target.value ? Number(e.target.value) : undefined)}
    >
      <option value="">{t('admin.hierarchy.selectVocabularyEllipsis')}</option>
      {integrations.map((intg: any) => (
        <option key={intg.id} value={intg.id}>{intg.name}</option>
      ))}
    </select>
  )
}

// ─── Metadata schema editor ───────────────────────────────────────────

function MetadataSchemaEditor({
  fields,
  onChange,
  entityType = 'resource',
}: {
  fields: MetadataField[]
  onChange: (fields: MetadataField[]) => void
  entityType?: string
}) {
  const { t } = useTranslation()
  const addField = () => {
    onChange([...fields, { name: '', label: '', type: 'text', required: false }])
  }

  const updateField = (i: number, patch: Partial<MetadataField>) => {
    const updated = fields.map((f, idx) => idx === i ? { ...f, ...patch } : f)
    onChange(updated)
  }

  const removeField = (i: number) => {
    onChange(fields.filter((_, idx) => idx !== i))
  }

  const autoName = (label: string) =>
    label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

  return (
    <div className={styles.schemaEditor}>
      <div className={styles.schemaHeader}>
        <span className={styles.schemaTitle}>{t('admin.hierarchy.customMetadataFields')}</span>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <TemplateLoader entityType={entityType} onLoad={onChange} />
          <TemplateSaver fields={fields} entityType={entityType} />
          <button className="btn btn-secondary btn-sm" onClick={addField}>
            <Plus size={13} /> {t('admin.hierarchy.addField')}
          </button>
        </div>
      </div>

      {fields.length === 0 ? (
        <p className={styles.schemaEmpty}>
          {t('admin.hierarchy.noCustomFields')}
        </p>
      ) : (
        <div className={styles.fieldList}>
          <div className={styles.fieldListHeader}>
            <span>{t('admin.hierarchy.fieldListHeader.label')}</span>
            <span>{t('admin.vocab.checklist.key')} (auto)</span>
            <span>{t('admin.hierarchy.fieldListHeader.type')}</span>
            <span>{t('admin.hierarchy.fieldListHeader.required')}</span>
            <span />
          </div>
          {fields.map((field, i) => (
            <div key={i} className={styles.fieldRowWrapper}>
              <div className={styles.fieldRow}>
                <input
                  className={styles.fieldInput}
                  value={field.label}
                  placeholder={t('admin.hierarchy.displayLabelPlaceholder')}
                  onChange={e => {
                    const label = e.target.value
                    updateField(i, {
                      label,
                      name: field.name || autoName(label),
                    })
                  }}
                />
                <input
                  className={`${styles.fieldInput} ${styles.fieldKey}`}
                  value={field.name}
                  placeholder={t('admin.hierarchy.fieldKeyPlaceholder')}
                  onChange={e => updateField(i, { name: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                />
                <select
                  className={styles.fieldSelect}
                  value={field.type}
                  onChange={e => updateField(i, {
                    type: e.target.value as FieldType,
                    integration_id: e.target.value === 'integration' ? field.integration_id : undefined,
                  })}
                >
                  {Object.keys(FIELD_TYPES).map(val => (
                    <option key={val} value={val}>{t(`fieldTypes.${val}`)}</option>
                  ))}
                </select>
                <div className={styles.fieldRequired}>
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={e => updateField(i, { required: e.target.checked })}
                  />
                </div>
                <button className="btn btn-ghost btn-sm btn-icon" onClick={() => removeField(i)}>
                  <X size={12} />
                </button>
              </div>

              {field.type === 'integration' && (
                <div className={styles.fieldIntegrationRow}>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-muted)', whiteSpace: 'nowrap' }}>
                    {t('admin.hierarchy.vocabularySource')}
                  </span>
                  <InlineIntegrationPicker
                    value={field.integration_id}
                    onChange={id => updateField(i, { integration_id: id })}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Level row ────────────────────────────────────────────────────────

function LevelRow({
  level,
  allLevels,
  typeId,
  entityType,
  onUpdated,
}: {
  level: any
  allLevels: any[]
  typeId: number
  entityType: string
  onUpdated: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [schemaFields, setSchemaFields] = useState<MetadataField[]>(
    level.metadata_schema?.fields ?? []
  )
  const [schemaDirty, setSchemaDirty] = useState(false)
  const [parentDirty, setParentDirty] = useState(false)
  const [selectedParents, setSelectedParents] = useState<number[]>(level.allowed_parent_ids)

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      hierarchyApi.updateLevel(typeId, level.id, data),
    onSuccess: () => { onUpdated(); queryClient.invalidateQueries({ queryKey: ['hierarchy-levels', typeId] }) },
  })

  const deleteMutation = useMutation({
    mutationFn: () => hierarchyApi.deleteLevel(typeId, level.id),
    onSuccess: () => { onUpdated(); queryClient.invalidateQueries({ queryKey: ['hierarchy-levels', typeId] }) },
  })

  const saveParentsMutation = useMutation({
    mutationFn: () => hierarchyApi.setLevelParents(typeId, level.id, selectedParents),
    onSuccess: () => {
      setParentDirty(false)
      onUpdated()
      queryClient.invalidateQueries({ queryKey: ['hierarchy-levels', typeId] })
    },
  })

  const saveSchemaMutation = useMutation({
    mutationFn: () => hierarchyApi.updateLevel(typeId, level.id, {
      metadata_schema: { fields: schemaFields },
    }),
    onSuccess: () => {
      setSchemaDirty(false)
      queryClient.invalidateQueries({ queryKey: ['hierarchy-levels', typeId] })
    },
  })

  const toggleParent = (parentId: number) => {
    setSelectedParents(prev =>
      prev.includes(parentId) ? prev.filter(id => id !== parentId) : [...prev, parentId]
    )
    setParentDirty(true)
  }

  const otherLevels = allLevels.filter(l => l.id !== level.id)

  return (
    <div className={`${styles.levelRow} ${expanded ? styles.levelRowExpanded : ''}`}>
      <div className={styles.levelRowHeader} onClick={() => setExpanded(v => !v)}>
        <GripVertical size={14} className={styles.dragHandle} />

        <div className={styles.levelRowMain}>
          <InlineEdit
            value={level.name}
            onSave={name => updateMutation.mutate({ name })}
            placeholder={t('admin.hierarchy.levelNamePlaceholder')}
            className={styles.levelName}
          />
          <span className={styles.levelOrder}>#{level.sort_order}</span>
          {level.allowed_parent_ids.length === 0 && (
            <span className={styles.rootBadge}>{t('admin.hierarchy.rootBadge')}</span>
          )}
          {entityType === 'resource' && level.can_have_location && (
            <span className={styles.locationBadge}><MapPin size={10} /> {t('admin.hierarchy.storesItemsBadge')}</span>
          )}
          {entityType === 'resource' && level.is_object_level && (
            <span className={styles.objectBadge}><Layers size={10} /> {t('admin.hierarchy.objectBadge')}</span>
          )}
          {level.metadata_schema?.fields?.length > 0 && (
            <span className={styles.schemaBadge}>
              <Settings size={10} /> {t('admin.hierarchy.fieldsCount', { count: level.metadata_schema.fields.length })}
            </span>
          )}
        </div>

        <div className={styles.levelRowActions} onClick={e => e.stopPropagation()}>
          <ChevronRight
            size={14}
            className={`${styles.expandChevron} ${expanded ? styles.expandChevronOpen : ''}`}
          />
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => {
              if (confirm(t('admin.hierarchy.deleteLevelConfirm', { name: level.name }))) deleteMutation.mutate()
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className={styles.levelDetail}>

          {/* Sort order + checkboxes */}
          <div className={styles.levelMeta}>
            <div className="form-group" style={{ width: 120 }}>
              <label>{t('admin.hierarchy.sortOrder')}</label>
              <input
                type="number"
                defaultValue={level.sort_order}
                min={0}
                onBlur={e => {
                  const val = parseInt(e.target.value)
                  if (!isNaN(val) && val !== level.sort_order) {
                    updateMutation.mutate({ sort_order: val })
                  }
                }}
              />
            </div>

            {entityType === 'resource' && (
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  defaultChecked={level.can_have_location}
                  onChange={e => updateMutation.mutate({ can_have_location: e.target.checked })}
                />
                {t('admin.hierarchy.canHaveLocation')}
              </label>
            )}

            {entityType === 'resource' && (
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  defaultChecked={level.is_object_level}
                  onChange={e => updateMutation.mutate({ is_object_level: e.target.checked })}
                />
                {t('admin.hierarchy.isObjectLevel')}
                <span style={{ fontWeight: 400, color: 'var(--color-ink-faint)', fontSize: 'var(--text-xs)' }}>
                  {t('admin.hierarchy.isObjectLevelHint')}
                </span>
              </label>
            )}
          </div>

          {/* Parent relationships */}
          <div className={styles.parentsSection}>
            <div className={styles.parentsSectionHeader}>
              <span className={styles.sectionLabel}>{t('admin.hierarchy.allowedParentLevels')}</span>
              <span className={styles.sectionHint}>
                {selectedParents.length === 0
                  ? t('admin.hierarchy.noParentsRoot')
                  : t('admin.hierarchy.parentsSelected', { count: selectedParents.length })}
              </span>
            </div>

            {otherLevels.length === 0 ? (
              <p className={styles.noOtherLevels}>{t('admin.hierarchy.noOtherLevels')}</p>
            ) : (
              <div className={styles.parentChips}>
                {otherLevels.map(other => (
                  <button
                    key={other.id}
                    className={`${styles.parentChip} ${selectedParents.includes(other.id) ? styles.parentChipSelected : ''}`}
                    onClick={() => toggleParent(other.id)}
                  >
                    {selectedParents.includes(other.id) && <Check size={11} />}
                    {other.name}
                  </button>
                ))}
              </div>
            )}

            {parentDirty && (
              <div className={styles.saveBar}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setSelectedParents(level.allowed_parent_ids); setParentDirty(false) }}
                >
                  {t('admin.hierarchy.reset')}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => saveParentsMutation.mutate()}
                  disabled={saveParentsMutation.isPending}
                >
                  {saveParentsMutation.isPending ? <Spinner size={13} /> : <Save size={13} />}
                  {t('admin.hierarchy.saveRelationships')}
                </button>
              </div>
            )}
          </div>

          {/* Metadata schema */}
          <MetadataSchemaEditor
            fields={schemaFields}
            onChange={fields => { setSchemaFields(fields); setSchemaDirty(true) }}
            entityType={entityType}
          />

          {schemaDirty && (
            <div className={styles.saveBar}>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                setSchemaFields(level.metadata_schema?.fields ?? [])
                setSchemaDirty(false)
              }}>
                {t('admin.hierarchy.reset')}
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => saveSchemaMutation.mutate()}
                disabled={saveSchemaMutation.isPending}
              >
                {saveSchemaMutation.isPending ? <Spinner size={13} /> : <Save size={13} />}
                {t('admin.hierarchy.saveSchema')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Type panel ───────────────────────────────────────────────────────

function HierarchyTypePanel({
  typeId,
  onClose,
}: {
  typeId: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [addingLevel, setAddingLevel] = useState(false)
  const [newLevelName, setNewLevelName] = useState('')

  const { data: type } = useQuery({
    queryKey: ['hierarchy-type', typeId],
    queryFn: () => hierarchyApi.listTypes().then(r =>
      r.data.data.find((ht: any) => ht.id === typeId)
    ),
  })

  const { data: levels, isLoading } = useQuery({
    queryKey: ['hierarchy-levels', typeId],
    queryFn: () => hierarchyApi.listLevels(typeId).then(r => r.data.data),
  })

  const updateTypeMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => hierarchyApi.updateType(typeId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hierarchy-types'] }),
  })

  const createLevelMutation = useMutation({
    mutationFn: (name: string) => hierarchyApi.createLevel(typeId, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hierarchy-levels', typeId] })
      setNewLevelName('')
      setAddingLevel(false)
    },
  })

  if (!type) return null

  const meta = ENTITY_TYPE_META[type.entity_type as keyof typeof ENTITY_TYPE_META]
  const TypeIcon = meta?.icon ?? Database
  const sorted = [...(levels ?? [])].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div className={styles.typePanel}>
      <div className={styles.typePanelHeader}>
        <div className={styles.typePanelTitle}>
          <div className={styles.typeIconWrap} style={{ color: meta?.colour }}>
            <TypeIcon size={18} />
          </div>
          <div>
            <InlineEdit
              value={type.name}
              onSave={name => updateTypeMutation.mutate({ name })}
              className={styles.typeName}
            />
            <span className={styles.typeEntityType}>{t(`admin.hierarchy.entityTypes.${type.entity_type}`)}</span>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
          <X size={15} />
        </button>
      </div>

      <div className={styles.typePanelBody}>
        <div className={styles.levelsHeader}>
          <h3 className={styles.levelsTitle}>
            {t('admin.hierarchy.levelsTitle')} <span className={styles.levelsCount}>{sorted.length}</span>
          </h3>
          <button className="btn btn-secondary btn-sm" onClick={() => setAddingLevel(true)}>
            <Plus size={13} /> {t('admin.hierarchy.addLevel')}
          </button>
        </div>

        {addingLevel && (
          <div className={styles.addLevelForm}>
            <input
              autoFocus
              placeholder={t('admin.hierarchy.levelNamePlaceholderFull')}
              value={newLevelName}
              onChange={e => setNewLevelName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newLevelName.trim()) createLevelMutation.mutate(newLevelName.trim())
                if (e.key === 'Escape') { setNewLevelName(''); setAddingLevel(false) }
              }}
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={!newLevelName.trim() || createLevelMutation.isPending}
              onClick={() => createLevelMutation.mutate(newLevelName.trim())}
            >
              {createLevelMutation.isPending ? <Spinner size={13} /> : t('common.add')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setNewLevelName(''); setAddingLevel(false) }}>
              {t('common.cancel')}
            </button>
          </div>
        )}

        {isLoading ? (
          <div className={styles.loadingState}><Spinner /></div>
        ) : sorted.length === 0 ? (
          <div className={styles.noLevels}>
            <AlertCircle size={20} />
            <p>{t('admin.hierarchy.noLevelsDefined')}</p>
          </div>
        ) : (
          <div className={styles.levelList}>
            {sorted.map(level => (
              <LevelRow
                key={level.id}
                level={level}
                allLevels={sorted}
                typeId={typeId}
                entityType={type.entity_type}
                onUpdated={() => queryClient.invalidateQueries({ queryKey: ['hierarchy-levels', typeId] })}
              />
            ))}
          </div>
        )}

        <div className={styles.relationshipGuide}>
          <p className={styles.guideTitle}>{t('admin.hierarchy.relationshipGuideTitle')}</p>
          <p className={styles.guideText}>
            {t('admin.hierarchy.relationshipGuideText')}
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────

export default function HierarchyPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null)
  const [addingType, setAddingType] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeEntityType, setNewTypeEntityType] = useState<string>('resource')

  const { data, isLoading } = useQuery({
    queryKey: ['hierarchy-types'],
    queryFn: () => hierarchyApi.listTypes().then(r => r.data.data),
  })

  const createTypeMutation = useMutation({
    mutationFn: () => hierarchyApi.createType({
      name: newTypeName.trim(),
      entity_type: newTypeEntityType,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['hierarchy-types'] })
      setSelectedTypeId(res.data.data.id)
      setNewTypeName('')
      setAddingType(false)
    },
  })

  const deleteTypeMutation = useMutation({
    mutationFn: (id: number) => hierarchyApi.deleteType(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hierarchy-types'] })
      setSelectedTypeId(null)
    },
  })

  const types = data ?? []

  const grouped = {
    resource:       types.filter((ht: any) => ht.entity_type === 'resource'),
    location:       types.filter((ht: any) => ht.entity_type === 'location'),
    classification: types.filter((ht: any) => ht.entity_type === 'classification'),
  }

  return (
    <div className={styles.page}>
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <h2 className={styles.sidebarTitle}>{t('admin.hierarchy.hierarchyTypes')}</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setAddingType(v => !v)}>
            <Plus size={14} /> {t('resources.tree.newButton')}
          </button>
        </div>

        {addingType && (
          <div className={styles.addTypeForm}>
            <div className="form-group">
              <label>{t('admin.vocab.name')}</label>
              <input
                autoFocus
                value={newTypeName}
                onChange={e => setNewTypeName(e.target.value)}
                placeholder={t('admin.hierarchy.typeNamePlaceholder')}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newTypeName.trim()) createTypeMutation.mutate()
                  if (e.key === 'Escape') setAddingType(false)
                }}
              />
            </div>
            <div className="form-group">
              <label>{t('admin.vocab.appliesTo')}</label>
              <select value={newTypeEntityType} onChange={e => setNewTypeEntityType(e.target.value)}>
                <option value="resource">{t('admin.hierarchy.entityOptionResource')}</option>
                <option value="location">{t('admin.hierarchy.entityOptionLocation')}</option>
                <option value="classification">{t('admin.hierarchy.entityOptionClassification')}</option>
              </select>
            </div>
            <div className={styles.addTypeActions}>
              <button className="btn btn-ghost btn-sm" onClick={() => setAddingType(false)}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary btn-sm"
                disabled={!newTypeName.trim() || createTypeMutation.isPending}
                onClick={() => createTypeMutation.mutate()}
              >
                {createTypeMutation.isPending ? <Spinner size={13} /> : t('admin.vocab.create')}
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className={styles.loadingList}><Spinner /></div>
        ) : types.length === 0 ? (
          <EmptyState
            icon={<ArrowUpDown size={28} />}
            title={t('admin.hierarchy.noHierarchyTypes')}
            subtitle={t('admin.hierarchy.noHierarchyTypesSubtitle')}
          />
        ) : (
          <div className={styles.typeList}>
            {(Object.entries(grouped) as [string, any[]][])
              .filter(([, items]) => items.length > 0)
              .map(([entityType, items]) => {
                const meta = ENTITY_TYPE_META[entityType as keyof typeof ENTITY_TYPE_META]
                const GroupIcon = meta.icon
                return (
                  <div key={entityType} className={styles.typeGroup}>
                    <div className={styles.typeGroupLabel}>
                      <GroupIcon size={12} style={{ color: meta.colour }} />
                      {t(`admin.hierarchy.entityTypes.${entityType}`)}
                    </div>
                    {items.map((tp: any) => (
                      <div
                        key={tp.id}
                        className={`${styles.typeItem} ${selectedTypeId === tp.id ? styles.typeItemSelected : ''}`}
                        onClick={() => setSelectedTypeId(tp.id)}
                      >
                        <div className={styles.typeItemMain}>
                          <span className={styles.typeItemName}>{tp.name}</span>
                          <span className={styles.typeItemCount}>{t('admin.hierarchy.levelsCount', { count: tp.level_count })}</span>
                        </div>
                        <button
                          className={`btn btn-ghost btn-sm btn-icon ${styles.typeDeleteBtn}`}
                          onClick={e => {
                            e.stopPropagation()
                            if (confirm(t('admin.hierarchy.deleteTypeConfirm', { name: tp.name }))) {
                              deleteTypeMutation.mutate(tp.id)
                            }
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )
              })}
          </div>
        )}
      </div>

      <div className={styles.content}>
        {selectedTypeId ? (
          <HierarchyTypePanel
            key={selectedTypeId}
            typeId={selectedTypeId}
            onClose={() => setSelectedTypeId(null)}
          />
        ) : (
          <EmptyState
            icon={<ArrowUpDown size={36} />}
            title={t('admin.hierarchy.selectTypeToManage')}
            subtitle={t('admin.hierarchy.selectTypeSubtitle')}
          />
        )}
      </div>
    </div>
  )
}