import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Pencil, Check, X, ArrowLeftRight, ChevronRight } from 'lucide-react'
import { Spinner } from '@/components/ui'
import { vocabApi, checklistTemplatesApi } from '@/api'
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
      title="Click to edit"
    >
      {value || <span className={styles.placeholder}>{placeholder}</span>}
      <Pencil size={10} className={styles.inlineIcon} />
    </span>
  )
}

// ─── Editable type row ───────────────────────────────────────────────

function EditableTypeRow({
  item, withComplement, onUpdate, onDelete, isDeleting,
}: {
  item: SimpleType
  withComplement?: boolean
  onUpdate: (id: number, name: string, desc?: string, isSym?: boolean, compName?: string, applicableTo?: string) => void
  onDelete: (id: number) => void
  isDeleting: number | null
}) {
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
            <label>Name</label>
            <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <label>Description</label>
            <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        {item.applicable_to !== undefined && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-ink-faint)' }}>Applies to</span>
            {(['both', 'agent', 'node'] as const).map(v => (
              <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
                <input type="radio" checked={editApplicableTo === v} onChange={() => setEditApplicableTo(v)} />
                {v === 'both' ? 'Both' : v === 'agent' ? 'Agents' : 'Resources'}
              </label>
            ))}
          </div>
        )}
        {withComplement && (
          <>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" checked={editSym} onChange={e => setEditSym(e.target.checked)} />
              Symmetric (A → B implies B → A)
            </label>
            {!editSym && (
              <div className="form-group">
                <label>Complementary type name</label>
                <input value={editComp} onChange={e => setEditComp(e.target.value)}
                  placeholder="Complement name" />
              </div>
            )}
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={() => {
            onUpdate(item.id, editName, editDesc, editSym, editComp, editApplicableTo)
            setEditing(false)
          }}>
            <Check size={13} /> Save
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
          <span className={styles.symmetricBadge}><ArrowLeftRight size={10} /> symmetric</span>
        )}
        {withComplement && !item.is_symmetric && item.complementary_name && (
          <span className={styles.asymmetricBadge}>↔ {item.complementary_name}</span>
        )}
        {item.applicable_to && item.applicable_to !== 'both' && (
          <span className={styles.applicableBadge}>
            {item.applicable_to === 'agent' ? 'agents' : 'resources'}
          </span>
        )}
      </div>
      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(true)} title="Edit">
        <Pencil size={12} />
      </button>
      <button className="btn btn-ghost btn-sm btn-icon" disabled={isDeleting === item.id}
        onClick={() => { if (confirm(`Delete "${item.name}"${item.complementary_name ? ` and "${item.complementary_name}"` : ''}?`)) onDelete(item.id) }}>
        {isDeleting === item.id ? <Spinner size={12} /> : <Trash2 size={12} />}
      </button>
    </div>
  )
}

// ─── Simple vocabulary section with optional symmetric/complementary support ───

interface SimpleType {
  id: number
  name: string
  description?: string | null
  is_symmetric?: boolean
  complementary_name?: string | null
  complementary_id?: number | null
  applicable_to?: string | null   // 'agent' | 'node' | 'both' — for place types & tag categories
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
          <Plus size={13} /> Add
        </button>
      </div>

      {adding && (
        <div className={styles.addForm}>
          {withComplement ? (
            <div className={styles.addFormGrid}>
              <div className="form-group">
                <label>Name *</label>
                <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. is related to"
                  onKeyDown={e => { if (e.key === 'Escape') setAdding(false) }} />
              </div>
              <div className="form-group">
                <label>Description</label>
                <input value={newDesc} onChange={e => setNewDesc(e.target.value)}
                  placeholder="Optional" />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className={styles.checkboxLabel}>
                  <input type="checkbox" checked={isSymmetric}
                    onChange={e => setIsSymmetric(e.target.checked)} />
                  Symmetric (A → B implies B → A)
                </label>
              </div>
              {!isSymmetric && (
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Complementary type name *</label>
                  <input value={complementName} onChange={e => setComplementName(e.target.value)}
                    placeholder="e.g. is related from" />
                </div>
              )}
            </div>
          ) : (
            <div className={styles.addFormRow}>
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Type name…" className={styles.addInput}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setAdding(false) }} />
              <input value={newDesc} onChange={e => setNewDesc(e.target.value)}
                placeholder="Description (optional)" className={styles.addInput} />
            </div>
          )}
          <div className={styles.addFormActions}>
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm"
              disabled={!newName.trim() || (!isSymmetric && withComplement && !complementName.trim()) || isCreating}
              onClick={handleCreate}>
              {isCreating ? <Spinner size={13} /> : <Check size={13} />}
              Add
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className={styles.loading}><Spinner size={16} /></div>
      ) : items.length === 0 ? (
        <p className={styles.empty}>No types defined. Add one to get started.</p>
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

// ─── Agent relation types section (symmetric/asymmetric) ──────────────

// ─── Agent-agent editable row ────────────────────────────────────────

function AgentAgentRow({ rt, onUpdate, onDelete, isDeleting }: {
  rt: any
  onUpdate: (id: number, data: Record<string, unknown>) => void
  onDelete: (id: number) => void
  isDeleting: boolean
}) {
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
            <label>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <label>Description</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <label className={styles.checkboxLabel}>
          <input type="checkbox" checked={isSym} onChange={e => setIsSym(e.target.checked)} />
          Symmetric (A → B implies B → A)
        </label>
        {!isSym && (
          <div className="form-group">
            <label>Complementary type name</label>
            <input value={compName} onChange={e => setCompName(e.target.value)}
              placeholder="e.g. has member" />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={() => {
            onUpdate(rt.id, { name, description: desc, is_symmetric: isSym, complementary_name: compName || null })
            setEditing(false)
          }}>
            <Check size={13} /> Save
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
            <span className={styles.symmetricBadge}><ArrowLeftRight size={10} /> symmetric</span>
          ) : rt.complementary_name ? (
            <span className={styles.asymmetricBadge}>↔ {rt.complementary_name}</span>
          ) : null}
        </div>
      </div>
      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(true)} title="Edit">
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
          <h3 className={styles.vocabSectionTitle}>Agent–agent relation types</h3>
          <p className={styles.vocabSectionDesc}>
            Relationships between agents — e.g. "is member of", "is parent of".
            Asymmetric pairs automatically create a complementary type.
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setAdding(v => !v)}>
          <Plus size={13} /> Add
        </button>
      </div>

      {adding && (
        <div className={styles.addForm}>
          <div className={styles.addFormGrid}>
            <div className="form-group">
              <label>Name *</label>
              <input
                autoFocus
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. is member of"
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional description"
              />
            </div>
          </div>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={form.is_symmetric}
              onChange={e => setForm(f => ({ ...f, is_symmetric: e.target.checked }))}
            />
            Symmetric (A relates to B = B relates to A)
          </label>
          {!form.is_symmetric && (
            <div className={styles.complementRow}>
              <span className={styles.complementArrow}>
                <ChevronRight size={14} />
              </span>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Complementary type name *</label>
                <input
                  value={form.complementary_name}
                  onChange={e => setForm(f => ({ ...f, complementary_name: e.target.value }))}
                  placeholder="e.g. has member"
                />
              </div>
            </div>
          )}
          <div className={styles.addFormActions}>
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
            <button
              className="btn btn-primary btn-sm"
              disabled={
                !form.name.trim() ||
                (!form.is_symmetric && !form.complementary_name.trim()) ||
                createMutation.isPending
              }
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? <Spinner size={13} /> : 'Create'}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className={styles.loading}><Spinner size={16} /></div>
      ) : !types?.length ? (
        <p className={styles.empty}>No relation types defined.</p>
      ) : (
        <div className={styles.typeList}>
          {types.map((rt: any) => (
            <AgentAgentRow
              key={rt.id}
              rt={rt}
              onUpdate={(id, data) => updateMutation.mutate({ id, ...data })}
              onDelete={(id) => {
                if (confirm(`Delete "${rt.name}"${rt.complementary_name ? ` and "${rt.complementary_name}"` : ''}?`)) {
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

// ─── Main export ─────────────────────────────────────────────────────


// ─── Place types vocab ────────────────────────────────────────────────

function PlaceTypesSection() {
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

  // Adapt to SimpleVocabSection's SimpleType shape
  const items: SimpleType[] = (types as any[]).map(t => ({
    id: t.id,
    name: t.label,
    description: t.applicable_to !== 'both' ? `${t.applicable_to}s only` : null,
  }))

  return (
    <SimpleVocabSection
      title="Place types"
      description="Types of geographic associations — e.g. born in, active in, created in. Add custom types for your institution's needs."
      items={items}
      isLoading={isLoading}
      onCreate={(name) => createMutation.mutate({ name, desc: '', isSymmetric: true, complementName: '' })}
      onUpdate={(id, name, _d, _s, _c, applicableTo) => updateMutation.mutate({ id, name, applicableTo })}
      onDelete={(id) => { if (confirm('Delete this place type?')) deleteMutation.mutate(id) }}
      isCreating={createMutation.isPending}
      isDeleting={deletingId}
    />
  )
}

// ─── Tag categories vocab ─────────────────────────────────────────────

function TagCategoriesSection() {
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

  const items: SimpleType[] = (cats as any[]).map(t => ({
    id: t.id,
    name: t.label,
    description: t.applicable_to !== 'both' ? `${t.applicable_to}s only` : null,
  }))

  return (
    <SimpleVocabSection
      title="Tag categories"
      description="Categories for subject tags — e.g. Topic, Occupation, Genre. Tags without a category are ungrouped."
      items={items}
      isLoading={isLoading}
      onCreate={(name) => createMutation.mutate({ name, desc: '', isSymmetric: true, complementName: '' })}
      onUpdate={(id, name, _d, _s, _c, applicableTo) => updateMutation.mutate({ id, name, applicableTo })}
      onDelete={(id) => { if (confirm('Delete this tag category?')) deleteMutation.mutate(id) }}
      isCreating={createMutation.isPending}
      isDeleting={deletingId}
    />
  )
}



// ─── Checklist templates ──────────────────────────────────────────────

const DELIVERY_METHODS_FOR_CHECKLIST = [
  { value: '',                label: 'All delivery types (default)' },
  { value: 'physical',        label: 'Physical' },
  { value: 'digital_transfer',label: 'Digital transfer' },
  { value: 'email',           label: 'Email' },
  { value: 'sftp',            label: 'SFTP' },
  { value: 'cloud',           label: 'Cloud' },
  { value: 'other',           label: 'Other' },
]

function ChecklistItemEditor({ items, onChange }: {
  items: any[]; onChange: (items: any[]) => void
}) {
  const add = () => onChange([...items, { label: '', key: '', description: '' }])
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i))
  const update = (i: number, field: string, val: string) => {
    const next = items.map((item, idx) => {
      if (idx !== i) return item
      const updated = { ...item, [field]: val }
      // Auto-generate key from label
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
        <div key={i} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start',
          padding: 'var(--space-2)', background: 'var(--color-bg-subtle)',
          borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
            <button className="btn btn-ghost btn-sm btn-icon" disabled={i === 0}
              onClick={() => move(i, -1)} style={{ padding: '2px' }}>↑</button>
            <button className="btn btn-ghost btn-sm btn-icon" disabled={i === items.length - 1}
              onClick={() => move(i, 1)} style={{ padding: '2px' }}>↓</button>
          </div>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Label *</label>
              <input value={item.label} onChange={e => update(i, 'label', e.target.value)}
                placeholder="e.g. Virus scan" />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Key</label>
              <input value={item.key} onChange={e => update(i, 'key', e.target.value)}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}
                placeholder="virus_scan" />
            </div>
            <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label>Description</label>
              <input value={item.description ?? ''} onChange={e => update(i, 'description', e.target.value)}
                placeholder="Optional guidance for the archivist…" />
            </div>
          </div>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => remove(i)}>
            <X size={13} />
          </button>
        </div>
      ))}
      <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={add}>
        <Plus size={13} /> Add item
      </button>
    </div>
  )
}

function ChecklistTemplateEditor({ template, onSave, onCancel, isSaving }: {
  template?: any; onSave: (d: any) => void; onCancel: () => void; isSaving: boolean
}) {
  const [name, setName] = useState(template?.name ?? '')
  const [method, setMethod] = useState(template?.delivery_method ?? '')
  const [isDefault, setIsDefault] = useState(template?.is_default ?? false)
  const [items, setItems] = useState<any[]>(template?.items ?? [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
      padding: 'var(--space-4)', background: 'var(--color-bg-subtle)',
      border: '1px solid var(--color-accent-border)', borderRadius: 'var(--radius-lg)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
        <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
          <label>Template name *</label>
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Digital transfer checklist" autoFocus />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label>Applies to delivery type</label>
          <select value={method} onChange={e => setMethod(e.target.value)}>
            {DELIVERY_METHODS_FOR_CHECKLIST.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className={styles.checkboxLabel} style={{ paddingTop: 24 }}>
            <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
            Use as default for this delivery type
          </label>
        </div>
      </div>
      <div>
        <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'block',
          marginBottom: 'var(--space-2)', color: 'var(--color-ink-muted)' }}>
          Checklist items
        </label>
        <ChecklistItemEditor items={items} onChange={setItems} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary btn-sm"
          disabled={!name.trim() || isSaving}
          onClick={() => onSave({ name, delivery_method: method || null, is_default: isDefault, items })}>
          {isSaving ? <Spinner size={13} /> : <Check size={13} />}
          {template ? 'Save' : 'Create template'}
        </button>
      </div>
    </div>
  )
}

function ChecklistTemplatesSection() {
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
    DELIVERY_METHODS_FOR_CHECKLIST.find(x => x.value === (m ?? ''))?.label ?? m ?? 'All types'

  return (
    <div className={styles.vocabSection}>
      <div className={styles.vocabSectionHeader}>
        <div>
          <h3 className={styles.vocabSectionTitle}>Delivery checklist templates</h3>
          <p className={styles.vocabSectionDesc}>
            Define checklist templates for different delivery types. The matching default template
            is applied automatically when a new delivery is created.
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setCreating(v => !v)}>
          <Plus size={13} /> New template
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
          No templates yet. The built-in defaults will be used for new deliveries.
        </p>
      )}

      {(templates as any[]).map((t: any) => (
        <div key={t.id}>
          {editingId === t.id ? (
            <ChecklistTemplateEditor
              template={t}
              onSave={d => updateMutation.mutate({ id: t.id, data: d })}
              onCancel={() => setEditingId(null)}
              isSaving={updateMutation.isPending}
            />
          ) : (
            <div className={styles.typeRow}>
              <div style={{ flex: 1 }}>
                <span className={styles.typeName}>{t.name}</span>
                <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 2 }}>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)' }}>
                    {methodLabel(t.delivery_method)}
                  </span>
                  {t.is_default && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-accent)',
                      background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent-border)',
                      borderRadius: 'var(--radius-sm)', padding: '1px 5px' }}>DEFAULT</span>
                  )}
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)' }}>
                    {t.items.length} item{t.items.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditingId(t.id)}>
                <Pencil size={13} />
              </button>
              <button className="btn btn-ghost btn-sm btn-icon"
                onClick={() => { if (confirm('Delete this template?')) deleteMutation.mutate(t.id) }}>
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function VocabulariesTab() {
  const queryClient = useQueryClient()

  // Agent-node relation types
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

  // Node-node relation types
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

  const [vocabTab, setVocabTab] = useState<'relations' | 'geo' | 'deliveries'>('relations')

  const VOCAB_TABS = [
    { key: 'relations', label: 'Relation types' },
    { key: 'geo',       label: 'Geography & tagging' },
    { key: 'deliveries', label: 'Deliveries' },
  ]

  return (
    <div className={styles.tab}>
      <p className={styles.intro}>
        Vocabularies define the controlled terms used across the system. Changes apply immediately
        across the institution.
      </p>

      <div className={styles.vocabTabBar}>
        {VOCAB_TABS.map(t => (
          <button key={t.key}
            className={`${styles.vocabTabBtn} ${vocabTab === t.key ? styles.vocabTabBtnActive : ''}`}
            onClick={() => setVocabTab(t.key as any)}>
            {t.label}
          </button>
        ))}
      </div>

      {vocabTab === 'relations' && (
      <div className={styles.group}>
        <AgentRelationSection />
        <SimpleVocabSection
          title="Agent – resource"
          description="How agents relate to archival descriptions — e.g. creator, contributor, publisher, subject."
          items={agentNodeTypes ?? []}
          isLoading={loadingAgentNode}
          onCreate={(name, desc, sym, comp) => createAgentNodeMutation.mutate({ name, desc, isSymmetric: sym, complementName: comp })}
          withComplement
          onUpdate={(id, name, desc, isSym, compName) => updateAgentNodeMutation.mutate({ id, name, desc, isSym, compName })}
          onDelete={id => { if (confirm('Delete this type?')) deleteAgentNodeMutation.mutate(id) }}
          isCreating={createAgentNodeMutation.isPending}
          isDeleting={deletingAgentNode}
        />
        <SimpleVocabSection
          title="Resource – resource"
          description="Relationships between archival descriptions — e.g. related to, precedes, follows, is part of."
          items={nodeNodeTypes ?? []}
          isLoading={loadingNodeNode}
          onCreate={(name, desc, sym, comp) => createNodeNodeMutation.mutate({ name, desc, isSymmetric: sym, complementName: comp })}
          withComplement
          onUpdate={(id, name, desc, isSym, compName) => updateNodeNodeMutation.mutate({ id, name, desc, isSym, compName })}
          onDelete={id => { if (confirm('Delete this type?')) deleteNodeNodeMutation.mutate(id) }}
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

      {vocabTab === 'deliveries' && (
      <div className={styles.group}>
        <ChecklistTemplatesSection />
      </div>
      )}
    </div>
  )
}