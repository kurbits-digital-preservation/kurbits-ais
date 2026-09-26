import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Pencil, Check, X, ArrowLeftRight, ChevronRight } from 'lucide-react'
import { Spinner } from '@/components/ui'
import { vocabApi, checklistTemplatesApi, representationsApi } from '@/api'
import { useTranslation } from 'react-i18next'
import styles from './VocabulariesTab.module.css'

// ─── Inline editable field ────────────────────────────────────────────

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
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) onSave(trimmed)
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
      <Pencil size={10} className={styles.inlineIcon} />
    </span>
  )
}

// ─── Editable type row ────────────────────────────────────────────────

function EditableTypeRow({
  item, withComplement, onUpdate, onDelete, isDeleting,
}: {
  item: SimpleType
  withComplement?: boolean
  onUpdate: (id: number, name: string, desc?: string, isSym?: boolean, compName?: string, applicableTo?: string) => void
  onDelete: (id: number) => void
  isDeleting: number | null
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(item.name)
  const [editDesc, setEditDesc] = useState(item.description ?? '')
  const [editSym, setEditSym] = useState(item.is_symmetric ?? true)
  const [editComp, setEditComp] = useState(item.complementary_name ?? '')
  const [editApplicableTo, setEditApplicableTo] = useState(item.applicable_to ?? 'both')

  if (editing) {
    return (
      <div className={styles.typeRow} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-5)' }}>
        <div className={styles.addFormGrid}>
          <div className="form-group">
            <label>{t('admin.vocab.name')}</label>
            <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <label>{t('resources.form.fields.description')}</label>
            <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder={t('identifiers.notePlaceholder')} />
          </div>
        </div>
        {item.applicable_to !== undefined && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-ink-faint)' }}>{t('admin.vocab.appliesTo')}</span>
            {(['both', 'agent', 'node'] as const).map(v => (
              <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
                <input type="radio" checked={editApplicableTo === v} onChange={() => setEditApplicableTo(v)} />
                {v === 'both' ? t('admin.vocab.both') : v === 'agent' ? t('admin.vocab.agents') : t('search.facets.resources')}
              </label>
            ))}
          </div>
        )}
        {withComplement && (
          <>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" checked={editSym} onChange={e => setEditSym(e.target.checked)} />
              {t('admin.vocab.symmetricLabel')}
            </label>
            {!editSym && (
              <div className="form-group">
                <label>{t('admin.vocab.complementaryTypeName')}</label>
                <input value={editComp} onChange={e => setEditComp(e.target.value)}
                  placeholder={t('admin.vocab.complementNamePlaceholder')} />
              </div>
            )}
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
          <button className="btn btn-primary btn-sm" onClick={() => {
            onUpdate(item.id, editName, editDesc, editSym, editComp, editApplicableTo)
            setEditing(false)
          }}>
            <Check size={13} /> {t('common.save')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.typeRow}>
      <div className={styles.typeRowBody}>
        <span className={styles.typeName}>{item.name}</span>
        {item.description && <span className={styles.typeDesc}>{item.description}</span>}
        {withComplement && item.is_symmetric && (
          <span className={styles.symmetricBadge}><ArrowLeftRight size={10} /> {t('admin.vocab.symmetricBadge')}</span>
        )}
        {withComplement && !item.is_symmetric && item.complementary_name && (
          <span className={styles.asymmetricBadge}>↔ {item.complementary_name}</span>
        )}
        {item.applicable_to && item.applicable_to !== 'both' && (
          <span className={styles.applicableBadge}>
            {item.applicable_to === 'agent' ? t('admin.vocab.agentsOnly') : t('admin.vocab.resourcesOnly')}
          </span>
        )}
      </div>
      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(true)} title={t('common.edit')}>
        <Pencil size={12} />
      </button>
      <button className="btn btn-ghost btn-sm btn-icon" disabled={isDeleting === item.id}
        onClick={() => { if (confirm(t('admin.vocab.deleteTypeConfirm', { name: item.name, complement: item.complementary_name ? t('admin.vocab.andComplement', { name: item.complementary_name }) : '' }))) onDelete(item.id) }}>
        {isDeleting === item.id ? <Spinner size={12} /> : <Trash2 size={12} />}
      </button>
    </div>
  )
}

// ─── Simple vocabulary section ────────────────────────────────────────

interface SimpleType {
  id: number
  name: string
  description?: string | null
  is_symmetric?: boolean
  complementary_name?: string | null
  complementary_id?: number | null
  applicable_to?: string | null
}

function SimpleVocabSection({
  title,
  description,
  items,
  isLoading,
  onCreate,
  onUpdate,
  onDelete,
  isCreating,
  isDeleting,
  withComplement = false,
}: {
  title: string
  description: string
  items: SimpleType[]
  isLoading: boolean
  onCreate: (name: string, desc: string, isSymmetric: boolean, complementName: string) => void
  onUpdate: (id: number, name: string, desc?: string, isSym?: boolean, compName?: string, applicableTo?: string) => void
  onDelete: (id: number) => void
  isCreating: boolean
  isDeleting: number | null
  withComplement?: boolean
}) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [isSymmetric, setIsSymmetric] = useState(true)
  const [complementName, setComplementName] = useState('')

  const handleCreate = () => {
    if (!newName.trim()) return
    onCreate(newName.trim(), newDesc.trim(), isSymmetric, complementName.trim())
    setNewName(''); setNewDesc(''); setComplementName(''); setIsSymmetric(true)
    setAdding(false)
  }

  return (
    <div className={styles.vocabSection}>
      <div className={styles.vocabSectionHeader}>
        <div>
          <h3 className={styles.vocabSectionTitle}>{title}</h3>
          <p className={styles.vocabSectionDesc}>{description}</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setAdding(v => !v)}>
          <Plus size={13} /> {t('common.add')}
        </button>
      </div>

      {adding && (
        <div className={styles.addForm}>
          {withComplement ? (
            <div className={styles.addFormGrid}>
              <div className="form-group">
                <label>{t('agents.form.name')}</label>
                <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. is related to"
                  onKeyDown={e => { if (e.key === 'Escape') setAdding(false) }} />
              </div>
              <div className="form-group">
                <label>{t('resources.form.fields.description')}</label>
                <input value={newDesc} onChange={e => setNewDesc(e.target.value)}
                  placeholder={t('identifiers.notePlaceholder')} />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className={styles.checkboxLabel}>
                  <input type="checkbox" checked={isSymmetric}
                    onChange={e => setIsSymmetric(e.target.checked)} />
                  {t('admin.vocab.symmetricLabel')}
                </label>
              </div>
              {!isSymmetric && (
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>{t('admin.vocab.complementaryTypeNameRequired')}</label>
                  <input value={complementName} onChange={e => setComplementName(e.target.value)}
                    placeholder="e.g. is related from" />
                </div>
              )}
            </div>
          ) : (
            <div className={styles.addFormRow}>
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                placeholder={`${t('admin.vocab.name')}…`} className={styles.addInput}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setAdding(false) }} />
              <input value={newDesc} onChange={e => setNewDesc(e.target.value)}
                placeholder={`${t('resources.form.fields.description')} ${t('representations.optional')}`} className={styles.addInput} />
            </div>
          )}
          <div className={styles.addFormActions}>
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>{t('common.cancel')}</button>
            <button className="btn btn-primary btn-sm"
              disabled={!newName.trim() || (!isSymmetric && withComplement && !complementName.trim()) || isCreating}
              onClick={handleCreate}>
              {isCreating ? <Spinner size={13} /> : <Check size={13} />}
              {t('common.add')}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className={styles.loading}><Spinner size={16} /></div>
      ) : items.length === 0 ? (
        <p className={styles.empty}>{t('admin.vocab.noTypesDefined')}</p>
      ) : (
        <div className={styles.typeList}>
          {items.map(item => (
            <EditableTypeRow
              key={item.id}
              item={item}
              withComplement={withComplement}
              onUpdate={onUpdate}
              onDelete={onDelete}
              isDeleting={isDeleting}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Agent-agent relation types section ───────────────────────────────

function AgentAgentRow({ rt, onUpdate, onDelete, isDeleting }: {
  rt: any
  onUpdate: (id: number, data: Record<string, unknown>) => void
  onDelete: (id: number) => void
  isDeleting: boolean
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(rt.name)
  const [desc, setDesc] = useState(rt.description ?? '')
  const [isSym, setIsSym] = useState(rt.is_symmetric ?? true)
  const [compName, setCompName] = useState(rt.complementary_name ?? '')

  if (editing) {
    return (
      <div className={styles.typeRow} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-5)' }}>
        <div className={styles.addFormGrid}>
          <div className="form-group">
            <label>{t('admin.vocab.name')}</label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <label>{t('resources.form.fields.description')}</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder={t('identifiers.notePlaceholder')} />
          </div>
        </div>
        <label className={styles.checkboxLabel}>
          <input type="checkbox" checked={isSym} onChange={e => setIsSym(e.target.checked)} />
          {t('admin.vocab.symmetricLabel')}
        </label>
        {!isSym && (
          <div className="form-group">
            <label>{t('admin.vocab.complementaryTypeName')}</label>
            <input value={compName} onChange={e => setCompName(e.target.value)}
              placeholder={t('admin.vocab.agentAgent.complementPlaceholder')} />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
          <button className="btn btn-primary btn-sm" onClick={() => {
            onUpdate(rt.id, { name, description: desc, is_symmetric: isSym, complementary_name: compName || null })
            setEditing(false)
          }}>
            <Check size={13} /> {t('common.save')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.typeRow}>
      <div className={styles.typeRowBody}>
        <span className={styles.typeName}>{rt.name}</span>
        {rt.description && <span className={styles.typeDesc}>{rt.description}</span>}
        <div className={styles.typeRowMeta}>
          {rt.is_symmetric ? (
            <span className={styles.symmetricBadge}><ArrowLeftRight size={10} /> {t('admin.vocab.symmetricBadge')}</span>
          ) : rt.complementary_name ? (
            <span className={styles.asymmetricBadge}>↔ {rt.complementary_name}</span>
          ) : null}
        </div>
      </div>
      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(true)} title={t('common.edit')}>
        <Pencil size={12} />
      </button>
      <button className="btn btn-ghost btn-sm btn-icon" disabled={isDeleting}
        onClick={() => onDelete(rt.id)}>
        {isDeleting ? <Spinner size={12} /> : <Trash2 size={12} />}
      </button>
    </div>
  )
}

function AgentRelationSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({
    name: '', description: '', is_symmetric: true, complementary_name: ''
  })
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const { data: types, isLoading } = useQuery({
    queryKey: ['vocab-agent-relation-types'],
    queryFn: () => vocabApi.listAgentRelationTypes().then(r => r.data.data),
  })

  const createMutation = useMutation({
    mutationFn: () => vocabApi.createAgentRelationType(form as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vocab-agent-relation-types'] })
      setForm({ name: '', description: '', is_symmetric: true, complementary_name: '' })
      setAdding(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: number; [k: string]: unknown }) =>
      vocabApi.updateAgentRelationType(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vocab-agent-relation-types'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => {
      setDeletingId(id)
      return vocabApi.deleteAgentRelationType(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vocab-agent-relation-types'] })
      setDeletingId(null)
    },
    onError: () => setDeletingId(null),
  })

  return (
    <div className={styles.vocabSection}>
      <div className={styles.vocabSectionHeader}>
        <div>
          <h3 className={styles.vocabSectionTitle}>{t('admin.vocab.agentAgent.title')}</h3>
          <p className={styles.vocabSectionDesc}>
            {t('admin.vocab.agentAgent.desc')}
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setAdding(v => !v)}>
          <Plus size={13} /> {t('common.add')}
        </button>
      </div>

      {adding && (
        <div className={styles.addForm}>
          <div className={styles.addFormGrid}>
            <div className="form-group">
              <label>{t('agents.form.name')}</label>
              <input
                autoFocus
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={t('admin.vocab.agentAgent.namePlaceholder')}
              />
            </div>
            <div className="form-group">
              <label>{t('resources.form.fields.description')}</label>
              <input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder={t('admin.vocab.agentAgent.descPlaceholder')}
              />
            </div>
          </div>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={form.is_symmetric}
              onChange={e => setForm(f => ({ ...f, is_symmetric: e.target.checked }))}
            />
            {t('admin.vocab.agentAgent.symmetricLabel')}
          </label>
          {!form.is_symmetric && (
            <div className={styles.complementRow}>
              <span className={styles.complementArrow}>
                <ChevronRight size={14} />
              </span>
              <div className="form-group" style={{ flex: 1 }}>
                <label>{t('admin.vocab.complementaryTypeNameRequired')}</label>
                <input
                  value={form.complementary_name}
                  onChange={e => setForm(f => ({ ...f, complementary_name: e.target.value }))}
                  placeholder={t('admin.vocab.agentAgent.complementPlaceholder')}
                />
              </div>
            </div>
          )}
          <div className={styles.addFormActions}>
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>{t('common.cancel')}</button>
            <button
              className="btn btn-primary btn-sm"
              disabled={
                !form.name.trim() ||
                (!form.is_symmetric && !form.complementary_name.trim()) ||
                createMutation.isPending
              }
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? <Spinner size={13} /> : t('admin.vocab.create')}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className={styles.loading}><Spinner size={16} /></div>
      ) : !types?.length ? (
        <p className={styles.empty}>{t('admin.vocab.agentAgent.noneDefined')}</p>
      ) : (
        <div className={styles.typeList}>
          {types.map((rt: any) => (
            <AgentAgentRow
              key={rt.id}
              rt={rt}
              onUpdate={(id, data) => updateMutation.mutate({ id, ...data })}
              onDelete={(id) => {
                if (confirm(t('admin.vocab.deleteTypeConfirm', { name: rt.name, complement: rt.complementary_name ? t('admin.vocab.andComplement', { name: rt.complementary_name }) : '' }))) {
                  deleteMutation.mutate(id)
                }
              }}
              isDeleting={deletingId === rt.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Place types vocab ────────────────────────────────────────────────

function PlaceTypesSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const { data: types = [], isLoading } = useQuery({
    queryKey: ['place-types-vocab'],
    queryFn: () => vocabApi.listPlaceTypes().then(r => r.data.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: { name: string; desc: string; isSymmetric: boolean; complementName: string }) =>
      vocabApi.createPlaceType({
        name: data.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        label: data.name,
        applicable_to: 'both',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['place-types-vocab'] })
      queryClient.invalidateQueries({ queryKey: ['place-types'] })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, name, applicableTo }: { id: number; name: string; applicableTo?: string }) =>
      vocabApi.updatePlaceType(id, { label: name, applicable_to: applicableTo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['place-types-vocab'] })
      queryClient.invalidateQueries({ queryKey: ['place-types'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => { setDeletingId(id); return vocabApi.deletePlaceType(id) },
    onSuccess: () => {
      setDeletingId(null)
      queryClient.invalidateQueries({ queryKey: ['place-types-vocab'] })
      queryClient.invalidateQueries({ queryKey: ['place-types'] })
    },
  })

  const items: SimpleType[] = (types as any[]).map(pt => ({
    id: pt.id,
    name: pt.label,
    description: pt.applicable_to !== 'both'
      ? (pt.applicable_to === 'agent' ? t('admin.vocab.agentsOnly') : t('admin.vocab.resourcesOnly'))
      : null,
  }))

  return (
    <SimpleVocabSection
      title={t('admin.vocab.placeTypes.title')}
      description={t('admin.vocab.placeTypes.desc')}
      items={items}
      isLoading={isLoading}
      onCreate={(name) => createMutation.mutate({ name, desc: '', isSymmetric: true, complementName: '' })}
      onUpdate={(id, name, _d, _s, _c, applicableTo) => updateMutation.mutate({ id, name, applicableTo })}
      onDelete={(id) => { if (confirm(t('admin.vocab.placeTypes.deleteConfirm'))) deleteMutation.mutate(id) }}
      isCreating={createMutation.isPending}
      isDeleting={deletingId}
    />
  )
}

// ─── Tag categories vocab ─────────────────────────────────────────────

function TagCategoriesSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const { data: cats = [], isLoading } = useQuery({
    queryKey: ['tag-categories-vocab'],
    queryFn: () => vocabApi.listTagCategories().then(r => r.data.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: { name: string; desc: string; isSymmetric: boolean; complementName: string }) =>
      vocabApi.createTagCategory({
        name: data.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        label: data.name,
        applicable_to: 'both',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tag-categories-vocab'] })
      queryClient.invalidateQueries({ queryKey: ['tag-categories'] })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, name, applicableTo }: { id: number; name: string; applicableTo?: string }) =>
      vocabApi.updateTagCategory(id, { label: name, applicable_to: applicableTo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tag-categories-vocab'] })
      queryClient.invalidateQueries({ queryKey: ['tag-categories'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => { setDeletingId(id); return vocabApi.deleteTagCategory(id) },
    onSuccess: () => {
      setDeletingId(null)
      queryClient.invalidateQueries({ queryKey: ['tag-categories-vocab'] })
      queryClient.invalidateQueries({ queryKey: ['tag-categories'] })
    },
  })

  const items: SimpleType[] = (cats as any[]).map(tc => ({
    id: tc.id,
    name: tc.label,
    description: tc.applicable_to !== 'both'
      ? (tc.applicable_to === 'agent' ? t('admin.vocab.agentsOnly') : t('admin.vocab.resourcesOnly'))
      : null,
  }))

  return (
    <SimpleVocabSection
      title={t('admin.vocab.tagCategories.title')}
      description={t('admin.vocab.tagCategories.desc')}
      items={items}
      isLoading={isLoading}
      onCreate={(name) => createMutation.mutate({ name, desc: '', isSymmetric: true, complementName: '' })}
      onUpdate={(id, name, _d, _s, _c, applicableTo) => updateMutation.mutate({ id, name, applicableTo })}
      onDelete={(id) => { if (confirm(t('admin.vocab.tagCategories.deleteConfirm'))) deleteMutation.mutate(id) }}
      isCreating={createMutation.isPending}
      isDeleting={deletingId}
    />
  )
}

// ─── Representation types vocab ───────────────────────────────────────

function RepresentationTypesSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const { data: types = [], isLoading } = useQuery({
    queryKey: ['representation-types'],
    queryFn: () => representationsApi.listTypes().then(r => r.data.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: { name: string; desc: string; isSymmetric: boolean; complementName: string }) =>
      representationsApi.createType({ name: data.name, description: data.desc || undefined }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['representation-types'] }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, name, desc }: { id: number; name: string; desc?: string }) =>
      representationsApi.updateType(id, { name, description: desc }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['representation-types'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => { setDeletingId(id); return representationsApi.deleteType(id) },
    onSuccess: () => {
      setDeletingId(null)
      queryClient.invalidateQueries({ queryKey: ['representation-types'] })
    },
    onError: () => setDeletingId(null),
  })

  const items: SimpleType[] = (types as any[]).map(rt => ({
    id: rt.id,
    name: rt.name,
    description: rt.description,
  }))

  return (
    <SimpleVocabSection
      title={t('admin.vocab.representationTypes.title')}
      description={t('admin.vocab.representationTypes.desc')}
      items={items}
      isLoading={isLoading}
      onCreate={(name, desc) => createMutation.mutate({ name, desc, isSymmetric: true, complementName: '' })}
      onUpdate={(id, name, desc) => updateMutation.mutate({ id, name, desc })}
      onDelete={(id) => { if (confirm(t('admin.vocab.representationTypes.deleteConfirm'))) deleteMutation.mutate(id) }}
      isCreating={createMutation.isPending}
      isDeleting={deletingId}
    />
  )
}

// ─── Checklist templates ──────────────────────────────────────────────

const DELIVERY_METHOD_VALUES_FOR_CHECKLIST = ['', 'physical', 'digital_transfer', 'email', 'sftp', 'cloud', 'other']

function ChecklistItemEditor({ items, onChange }: {
  items: any[]; onChange: (items: any[]) => void
}) {
  const { t } = useTranslation()
  const add = () => onChange([...items, { label: '', key: '', description: '' }])
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i))
  const update = (i: number, field: string, val: string) => {
    const next = items.map((item, idx) => {
      if (idx !== i) return item
      const updated = { ...item, [field]: val }
      if (field === 'label' && !item.key) {
        updated.key = val.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      }
      return updated
    })
    onChange(next)
  }
  const move = (i: number, dir: -1 | 1) => {
    const next = [...items]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {items.map((item, i) => (
        <div key={i} style={{
          display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start',
          padding: 'var(--space-2)', background: 'var(--color-bg-subtle)',
          borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
            <button className="btn btn-ghost btn-sm btn-icon" disabled={i === 0}
              onClick={() => move(i, -1)} style={{ padding: '2px' }}>↑</button>
            <button className="btn btn-ghost btn-sm btn-icon" disabled={i === items.length - 1}
              onClick={() => move(i, 1)} style={{ padding: '2px' }}>↓</button>
          </div>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>{t('admin.vocab.checklist.label')}</label>
              <input value={item.label} onChange={e => update(i, 'label', e.target.value)}
                placeholder={t('admin.vocab.checklist.labelPlaceholder')} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>{t('admin.vocab.checklist.key')}</label>
              <input value={item.key} onChange={e => update(i, 'key', e.target.value)}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}
                placeholder="virus_scan" />
            </div>
            <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label>{t('resources.form.fields.description')}</label>
              <input value={item.description ?? ''} onChange={e => update(i, 'description', e.target.value)}
                placeholder={t('admin.vocab.checklist.itemDescPlaceholder')} />
            </div>
          </div>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => remove(i)}>
            <X size={13} />
          </button>
        </div>
      ))}
      <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={add}>
        <Plus size={13} /> {t('admin.vocab.checklist.addItem')}
      </button>
    </div>
  )
}

function ChecklistTemplateEditor({ template, onSave, onCancel, isSaving }: {
  template?: any; onSave: (d: any) => void; onCancel: () => void; isSaving: boolean
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(template?.name ?? '')
  const [method, setMethod] = useState(template?.delivery_method ?? '')
  const [isDefault, setIsDefault] = useState(template?.is_default ?? false)
  const [items, setItems] = useState<any[]>(template?.items ?? [])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
      padding: 'var(--space-4)', background: 'var(--color-bg-subtle)',
      border: '1px solid var(--color-accent-border)', borderRadius: 'var(--radius-lg)',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
        <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
          <label>{t('admin.vocab.checklist.templateName')}</label>
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder={t('admin.vocab.checklist.templateNamePlaceholder')} autoFocus />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label>{t('admin.vocab.checklist.appliesTo')}</label>
          <select value={method} onChange={e => setMethod(e.target.value)}>
            {DELIVERY_METHOD_VALUES_FOR_CHECKLIST.map(m => (
              <option key={m} value={m}>{m === '' ? t('admin.vocab.checklist.allDeliveryTypesDefault') : t(`acquisitions.methods.${m}`)}</option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className={styles.checkboxLabel} style={{ paddingTop: 24 }}>
            <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
            {t('admin.vocab.checklist.useAsDefault')}
          </label>
        </div>
      </div>
      <div>
        <label style={{
          fontSize: 'var(--text-sm)', fontWeight: 600, display: 'block',
          marginBottom: 'var(--space-2)', color: 'var(--color-ink-muted)',
        }}>
          {t('admin.vocab.checklist.checklistItems')}
        </label>
        <ChecklistItemEditor items={items} onChange={setItems} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn btn-primary btn-sm"
          disabled={!name.trim() || isSaving}
          onClick={() => onSave({ name, delivery_method: method || null, is_default: isDefault, items })}>
          {isSaving ? <Spinner size={13} /> : <Check size={13} />}
          {template ? t('common.save') : t('admin.vocab.checklist.createTemplate')}
        </button>
      </div>
    </div>
  )
}

function ChecklistTemplatesSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['checklist-templates'],
    queryFn: () => checklistTemplatesApi.list().then(r => r.data.data),
  })

  const createMutation = useMutation({
    mutationFn: (d: any) => checklistTemplatesApi.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['checklist-templates'] }); setCreating(false) },
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => checklistTemplatesApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['checklist-templates'] }); setEditingId(null) },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => checklistTemplatesApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['checklist-templates'] }),
  })

  const methodLabel = (m: string | null) =>
    DELIVERY_METHOD_VALUES_FOR_CHECKLIST.includes(m ?? '')
      ? ((m ?? '') === '' ? t('admin.vocab.checklist.allDeliveryTypesDefault') : t(`acquisitions.methods.${m}`))
      : (m ?? t('admin.vocab.checklist.allTypes'))

  return (
    <div className={styles.vocabSection}>
      <div className={styles.vocabSectionHeader}>
        <div>
          <h3 className={styles.vocabSectionTitle}>{t('admin.vocab.checklist.title')}</h3>
          <p className={styles.vocabSectionDesc}>
            {t('admin.vocab.checklist.desc')}
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setCreating(v => !v)}>
          <Plus size={13} /> {t('admin.vocab.checklist.newTemplate')}
        </button>
      </div>

      {isLoading && <Spinner size={16} />}

      {creating && (
        <ChecklistTemplateEditor
          onSave={d => createMutation.mutate(d)}
          onCancel={() => setCreating(false)}
          isSaving={createMutation.isPending}
        />
      )}

      {(templates as any[]).length === 0 && !creating && !isLoading && (
        <p className={styles.vocabEmpty}>
          {t('admin.vocab.checklist.noneYet')}
        </p>
      )}

      {(templates as any[]).map((tmpl: any) => (
        <div key={tmpl.id}>
          {editingId === tmpl.id ? (
            <ChecklistTemplateEditor
              template={tmpl}
              onSave={d => updateMutation.mutate({ id: tmpl.id, data: d })}
              onCancel={() => setEditingId(null)}
              isSaving={updateMutation.isPending}
            />
          ) : (
            <div className={styles.typeRow}>
              <div style={{ flex: 1 }}>
                <span className={styles.typeName}>{tmpl.name}</span>
                <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 2 }}>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)' }}>
                    {methodLabel(tmpl.delivery_method)}
                  </span>
                  {tmpl.is_default && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: 'var(--color-accent)',
                      background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent-border)',
                      borderRadius: 'var(--radius-sm)', padding: '1px 5px',
                    }}>{t('admin.vocab.checklist.defaultBadge')}</span>
                  )}
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)' }}>
                    {t('acquisitions.checklist.itemsCount', { count: tmpl.items.length })}
                  </span>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditingId(tmpl.id)}>
                <Pencil size={13} />
              </button>
              <button className="btn btn-ghost btn-sm btn-icon"
                onClick={() => { if (confirm(t('admin.vocab.checklist.deleteConfirm'))) deleteMutation.mutate(tmpl.id) }}>
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────

export default function VocabulariesTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data: agentNodeTypes, isLoading: loadingAgentNode } = useQuery({
    queryKey: ['vocab-agent-node-types'],
    queryFn: () => vocabApi.listAgentNodeRelationTypes().then(r => r.data.data),
  })

  const createAgentNodeMutation = useMutation({
    mutationFn: ({ name, desc, isSymmetric, complementName }: { name: string; desc: string; isSymmetric?: boolean; complementName?: string }) =>
      vocabApi.createAgentNodeRelationType({ name, description: desc || null, is_symmetric: isSymmetric ?? true, complementary_name: complementName || null }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vocab-agent-node-types'] }),
  })

  const updateAgentNodeMutation = useMutation({
    mutationFn: ({ id, name, desc, isSym, compName }: { id: number; name: string; desc?: string; isSym?: boolean; compName?: string }) =>
      vocabApi.updateAgentNodeRelationType(id, { name, description: desc, is_symmetric: isSym, complementary_name: compName }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vocab-agent-node-types'] }),
  })

  const [deletingAgentNode, setDeletingAgentNode] = useState<number | null>(null)
  const deleteAgentNodeMutation = useMutation({
    mutationFn: (id: number) => { setDeletingAgentNode(id); return vocabApi.deleteAgentNodeRelationType(id) },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['vocab-agent-node-types'] }); setDeletingAgentNode(null) },
    onError: () => setDeletingAgentNode(null),
  })

  const { data: nodeNodeTypes, isLoading: loadingNodeNode } = useQuery({
    queryKey: ['vocab-node-relation-types'],
    queryFn: () => vocabApi.listNodeRelationTypes().then(r => r.data.data),
  })

  const createNodeNodeMutation = useMutation({
    mutationFn: ({ name, desc, isSymmetric, complementName }: { name: string; desc: string; isSymmetric?: boolean; complementName?: string }) =>
      vocabApi.createNodeRelationType({ name, description: desc || null, is_symmetric: isSymmetric ?? true, complementary_name: complementName || null }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vocab-node-relation-types'] }),
  })

  const updateNodeNodeMutation = useMutation({
    mutationFn: ({ id, name, desc, isSym, compName }: { id: number; name: string; desc?: string; isSym?: boolean; compName?: string }) =>
      vocabApi.updateNodeRelationType(id, { name, description: desc, is_symmetric: isSym, complementary_name: compName }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vocab-node-relation-types'] }),
  })

  const [deletingNodeNode, setDeletingNodeNode] = useState<number | null>(null)
  const deleteNodeNodeMutation = useMutation({
    mutationFn: (id: number) => { setDeletingNodeNode(id); return vocabApi.deleteNodeRelationType(id) },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['vocab-node-relation-types'] }); setDeletingNodeNode(null) },
    onError: () => setDeletingNodeNode(null),
  })

  const [vocabTab, setVocabTab] = useState<'relations' | 'geo' | 'objects' | 'deliveries'>('relations')

  const VOCAB_TABS = [
    { key: 'relations',  label: t('admin.vocab.tabs.relationTypes') },
    { key: 'geo',        label: t('admin.vocab.tabs.geography') },
    { key: 'objects',    label: t('resources.tabs.objects') },
    { key: 'deliveries', label: t('acquisitions.page.deliveries') },
  ]

  return (
    <div className={styles.tab}>
      <p className={styles.intro}>
        {t('admin.vocab.intro')}
      </p>

      <div className={styles.vocabTabBar}>
        {VOCAB_TABS.map(vt => (
          <button key={vt.key}
            className={`${styles.vocabTabBtn} ${vocabTab === vt.key ? styles.vocabTabBtnActive : ''}`}
            onClick={() => setVocabTab(vt.key as any)}>
            {vt.label}
          </button>
        ))}
      </div>

      {vocabTab === 'relations' && (
        <div className={styles.group}>
          <AgentRelationSection />
          <SimpleVocabSection
            title={t('admin.vocab.agentResource.title')}
            description={t('admin.vocab.agentResource.desc')}
            items={agentNodeTypes ?? []}
            isLoading={loadingAgentNode}
            onCreate={(name, desc, sym, comp) => createAgentNodeMutation.mutate({ name, desc, isSymmetric: sym, complementName: comp })}
            withComplement
            onUpdate={(id, name, desc, isSym, compName) => updateAgentNodeMutation.mutate({ id, name, desc, isSym, compName })}
            onDelete={id => { if (confirm(t('admin.vocab.agentAgent.deleteConfirm'))) deleteAgentNodeMutation.mutate(id) }}
            isCreating={createAgentNodeMutation.isPending}
            isDeleting={deletingAgentNode}
          />
          <SimpleVocabSection
            title={t('admin.vocab.resourceResource.title')}
            description={t('admin.vocab.resourceResource.desc')}
            items={nodeNodeTypes ?? []}
            isLoading={loadingNodeNode}
            onCreate={(name, desc, sym, comp) => createNodeNodeMutation.mutate({ name, desc, isSymmetric: sym, complementName: comp })}
            withComplement
            onUpdate={(id, name, desc, isSym, compName) => updateNodeNodeMutation.mutate({ id, name, desc, isSym, compName })}
            onDelete={id => { if (confirm(t('admin.vocab.agentAgent.deleteConfirm'))) deleteNodeNodeMutation.mutate(id) }}
            isCreating={createNodeNodeMutation.isPending}
            isDeleting={deletingNodeNode}
          />
        </div>
      )}

      {vocabTab === 'geo' && (
        <div className={styles.group}>
          <PlaceTypesSection />
          <TagCategoriesSection />
        </div>
      )}

      {vocabTab === 'objects' && (
        <div className={styles.group}>
          <RepresentationTypesSection />
        </div>
      )}

      {vocabTab === 'deliveries' && (
        <div className={styles.group}>
          <ChecklistTemplatesSection />
        </div>
      )}
    </div>
  )
}