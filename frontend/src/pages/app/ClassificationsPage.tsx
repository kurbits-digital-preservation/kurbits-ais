import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Plus, Tag, Pencil, Trash2, X, Save,
  History, FileText, Globe, ChevronRight,
  CalendarRange, RotateCcw,
  Eye, Archive, BarChart2, Upload, Check, GitCommit, Search
} from 'lucide-react'
import { classificationsApi, hierarchyApi, nodesApi } from '@/api'
import ClassificationTree from '@/components/tree/ClassificationTree'
import { PageShell, SidebarPanel, EmptyState, Tabs, FieldList, Spinner } from '@/components/ui'
import HierarchyLevelSelect from '@/components/ui/HierarchyLevelSelect'
import type { ClassificationStub } from '@/types'
import styles from './ClassificationsPage.module.css'

// ─── Form ─────────────────────────────────────────────────────────────

interface FormData {
  name: string
  code: string
  level_name: string
  hierarchy_type_id: string
  description: string
  scope_note: string
  valid_from: string
  valid_to: string
}

const EMPTY_FORM: FormData = {
  name: '', code: '', level_name: '', hierarchy_type_id: '',
  description: '', scope_note: '', valid_from: '', valid_to: '',
}

function ClassificationForm({
  initial,
  parentClassification,
  onSave,
  onCancel,
  isSaving,
}: {
  initial?: Partial<FormData>
  parentClassification?: any
  onSave: (data: FormData) => void
  onCancel: () => void
  isSaving: boolean
}) {
  const [form, setForm] = useState<FormData>({ ...EMPTY_FORM, ...initial })
  const set = (field: keyof FormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))

  return (
    <div className={styles.form}>
      {parentClassification && (
        <div className={styles.parentNote}>
          <ChevronRight size={13} />
          <span>
            Child of <strong>{parentClassification.full_code}</strong> — {parentClassification.name}
          </span>
        </div>
      )}

      <div className={styles.formGrid}>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>Name *</label>
          <input value={form.name} onChange={set('name')} placeholder="Classification name" required />
        </div>

        <div className="form-group">
          <label>Code *</label>
          <input value={form.code} onChange={set('code')} placeholder="e.g. A, 1.2, F3" />
          <span className="form-hint">Unique within parent. Full code is computed automatically.</span>
        </div>

        <HierarchyLevelSelect
          entityType="classification"
          hierarchyTypeId={form.hierarchy_type_id}
          levelName={form.level_name}
          onHierarchyTypeChange={v => setForm(f => ({ ...f, hierarchy_type_id: v }))}
          onLevelChange={v => setForm(f => ({ ...f, level_name: v }))}
          parentClassificationId={parentClassification?.id ?? null}
        />

        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>Description</label>
          <textarea value={form.description} onChange={set('description')} rows={3}
            placeholder="What this classification covers…" />
        </div>

        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>Scope note</label>
          <textarea value={form.scope_note} onChange={set('scope_note')} rows={2}
            placeholder="Guidance on what to include / exclude…" />
        </div>

        <div className="form-group">
          <label>Valid from</label>
          <input value={form.valid_from} onChange={set('valid_from')} type="date" />
        </div>

        <div className="form-group">
          <label>Valid to</label>
          <input value={form.valid_to} onChange={set('valid_to')} type="date" />
          <span className="form-hint">Leave empty if still active</span>
        </div>
      </div>

      <div className={styles.formActions}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={isSaving}>
          <X size={14} /> Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={() => onSave(form)}
          disabled={!form.name || !form.code || !form.level_name || !form.hierarchy_type_id || isSaving}
        >
          {isSaving ? <Spinner size={14} /> : <Save size={14} />}
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ─── Details tab ──────────────────────────────────────────────────────

function DetailsTab({ classification }: { classification: any }) {
  return (
    <div className={styles.tabContent}>
      <FieldList fields={[
        { label: 'Full code',    value: classification.full_code },
        { label: 'Level',        value: classification.level_name },
        { label: 'Description',  value: classification.description },
        { label: 'Scope note',   value: classification.scope_note },
        {
          label: 'Validity period',
          value: classification.valid_from || classification.valid_to
            ? `${classification.valid_from ?? '?'} → ${classification.valid_to ?? 'present'}`
            : null,
        },
      ]} />
      <div className={styles.detailFooter}>
        <span>Created by {classification.created_by ?? '—'}</span>
        <span>Updated {new Date(classification.updated_at).toLocaleDateString()}</span>
      </div>
    </div>
  )
}

// ─── Linked nodes tab ─────────────────────────────────────────────────

function LinkedNodesTab({ classification }: { classification: any }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [rootFilter, setRootFilter] = useState<{ id: number; label: string } | null>(null)
  const [rootInput, setRootInput] = useState('')
  const [rootOpen, setRootOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setRootOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const { data, isLoading } = useQuery({
    queryKey: ['classification-nodes', classification.id],
    queryFn: () => classificationsApi.getNodes(classification.id).then(r => r.data.data as any[]),
  })

  const removeMutation = useMutation({
    mutationFn: (nodeId: number) => classificationsApi.removeNode(classification.id, nodeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classification-nodes', classification.id] })
      queryClient.invalidateQueries({ queryKey: ['classification', classification.id] })
      queryClient.invalidateQueries({ queryKey: ['classification-tree'] })
    },
  })

  const { data: roots } = useQuery({
    queryKey: ['node-tree'],
    queryFn: () => nodesApi.getTree().then(r => r.data.data as any[]),
    enabled: (data?.length ?? 0) > 0,
  })

  const getRootNode = (node: any): { id: number; label: string } | null => {
    if (!roots?.length) return null
    const root = roots.find((r: any) =>
      node.ref_code === r.ref_code ||
      node.ref_code.startsWith(r.ref_code + '/') ||
      node.ref_code.startsWith(r.ref_code + '-') ||
      node.ref_code.startsWith(r.ref_code + ' ')
    )
    return root ? { id: root.id, label: root.title || root.ref_code } : null
  }

  // Unique roots among linked nodes
  const usedRoots: { id: number; label: string }[] = roots
    ? Array.from(
        new Map(
          (data ?? [])
            .map((n: any) => getRootNode(n))
            .filter(Boolean)
            .map((r: any) => [r!.id, r!])
        ).values()
      ) as { id: number; label: string }[]
    : []

  // Typeahead suggestions filtered by rootInput
  const rootSuggestions = rootInput
    ? usedRoots.filter(r => r.label.toLowerCase().includes(rootInput.toLowerCase()))
    : usedRoots

  const filtered = (data ?? []).filter((node: any) => {
    const root = getRootNode(node)
    if (rootFilter && root?.id !== rootFilter.id) return false
    if (search) {
      const q = search.toLowerCase()
      if (
        !node.title?.toLowerCase().includes(q) &&
        !node.ref_code?.toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  if (isLoading) return <div className={styles.tabContent}><Spinner /></div>

  return (
    <div className={styles.tabContent} style={{ padding: 0 }}>

      {(data?.length ?? 0) > 0 && (
        <div className={styles.linkedNodesFilter}>
          <div className={styles.linkedNodesSearchWrap}>
            <Search size={12} className={styles.linkedNodesSearchIcon} />
            <input
              className={styles.linkedNodesSearchInput}
              placeholder={`Search ${data?.length} resource${data?.length !== 1 ? 's' : ''}…`}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className={styles.linkedNodesSearchClear} onClick={() => setSearch('')}>
                <X size={11} />
              </button>
            )}
          </div>

          {usedRoots.length > 1 && (
            <div className={styles.rootTypeahead} ref={rootRef}>
              <div className={styles.rootTypeaheadInput}>
                <input
                  className={styles.linkedNodesSearchInput}
                  style={{ fontSize: 'var(--text-xs)' }}
                  placeholder="Filter by fonds…"
                  value={rootFilter ? rootFilter.label : rootInput}
                  readOnly={!!rootFilter}
                  onChange={e => { setRootInput(e.target.value); setRootOpen(true) }}
                  onFocus={() => { if (!rootFilter) setRootOpen(true) }}
                />
                {rootFilter ? (
                  <button
                    className={styles.linkedNodesSearchClear}
                    onClick={() => { setRootFilter(null); setRootInput(''); setRootOpen(false) }}
                  >
                    <X size={11} />
                  </button>
                ) : rootInput ? (
                  <button className={styles.linkedNodesSearchClear} onClick={() => { setRootInput(''); setRootOpen(false) }}>
                    <X size={11} />
                  </button>
                ) : null}
              </div>
              {rootOpen && rootSuggestions.length > 0 && (
                <div className={styles.rootTypeaheadDropdown}>
                  {rootSuggestions.map(r => (
                    <button
                      key={r.id}
                      className={styles.rootTypeaheadOption}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { setRootFilter(r); setRootInput(''); setRootOpen(false) }}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {(!data || data.length === 0) ? (
        <p className={styles.emptyText} style={{ padding: 'var(--space-5)' }}>
          No resources linked. Associate from the Resources section.
        </p>
      ) : filtered.length === 0 ? (
        <p className={styles.emptyText} style={{ padding: 'var(--space-5)' }}>
          No results.
        </p>
      ) : (
        filtered.map((node: any) => {
          const root = getRootNode(node)
          return (
            <div key={node.id} className={styles.linkedNode}>
              <button
                className={styles.linkedNodeBtn}
                onClick={() => navigate('/app/resources', { state: { selectNodeId: node.id } })}
              >
                <div className={styles.linkedNodeInfo}>
                  <span className={styles.linkedNodeTitle}>{node.title || node.ref_code}</span>
                  <div className={styles.linkedNodeMeta}>
                    <span className="ref-code" style={{ fontSize: 'var(--text-xs)' }}>{node.ref_code}</span>
                    {node.level_of_description && (
                      <span className={styles.linkedNodeLevel}>{node.level_of_description}</span>
                    )}
                    {root && (
                      <>
                        <span style={{ color: 'var(--color-border-strong)' }}>·</span>
                        <span className={styles.linkedNodeRoot}>{root.label}</span>
                      </>
                    )}
                  </div>
                </div>
              </button>
              <div className={styles.linkedNodeActions}>
                <span className={`badge badge-${node.status}`}>{node.status}</span>
                <button
                  className="btn btn-ghost btn-sm btn-icon"
                  onClick={() => { if (confirm('Remove this link?')) removeMutation.mutate(node.id) }}
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

// ─── History tab ──────────────────────────────────────────────────────

function HistoryTab({ classificationId }: { classificationId: number }) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['classification-history', classificationId],
    queryFn: () => classificationsApi.getHistory(classificationId).then(r => r.data.data as any[]),
  })

  if (isLoading) return <div className={styles.tabContent}><Spinner /></div>

  return (
    <div className={styles.tabContent}>
      {(!data || data.length === 0) ? (
        <p className={styles.emptyText}>No history yet.</p>
      ) : (
        data.map((change: any, i: number) => (
          <div key={change.id} className={styles.historyEntry}>
            <div className={styles.historyHeader}>
              <span className={styles.historyType}>{change.change_type}</span>
              <span className={styles.historyMeta}>
                {change.created_by} · {new Date(change.created_at).toLocaleString()}
              </span>
            </div>
            <p className={styles.historyDesc}>{change.description}</p>
            {Object.keys(change.before_data).length > 0 && (
              <div className={styles.historyDiff}>
                {Object.entries(change.after_data)
                  .filter(([k, v]) => v !== change.before_data[k] && change.before_data[k] !== undefined)
                  .map(([key, newVal]) => (
                    <div key={key} className={styles.diffRow}>
                      <span className={styles.diffKey}>{key}</span>
                      <span className={styles.diffOld}>{String(change.before_data[key] ?? '—')}</span>
                      <span className={styles.diffArrow}>→</span>
                      <span className={styles.diffNew}>{String(newVal ?? '—')}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}

// ─── Detail panel ─────────────────────────────────────────────────────

function ClassificationDetailPanel({
  classificationId,
  onEdit,
  onAddChild,
  onDelete,
}: {
  classificationId: number
  onEdit: (c: any) => void
  onAddChild: (parentId: number) => void
  onDelete: () => void
}) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('details')

  const { data: classification, isLoading } = useQuery({
    queryKey: ['classification', classificationId],
    queryFn: () => classificationsApi.get(classificationId).then(r => r.data.data),
  })

  const deleteMutation = useMutation({
    mutationFn: () => classificationsApi.delete(classificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classification-tree'] })
      // Invalidate parent's children so the tree node collapses correctly
      if (classification?.parent_id) {
        queryClient.invalidateQueries({ queryKey: ['classification-children', classification.parent_id] })
      }
      onDelete()
    },
  })

  if (isLoading) return <div className={styles.loadingState}><Spinner /><span>Loading…</span></div>
  if (!classification) return null

  const tabs = [
    { key: 'details', icon: <FileText size={13} />,      label: 'Details' },
    { key: 'nodes',   icon: <Globe size={13} />,         label: `Resources${classification.node_count ? ` (${classification.node_count})` : ''}` },
    { key: 'diagram', icon: <BarChart2 size={13} />,     label: 'Diagram' },
    { key: 'history', icon: <History size={13} />,       label: 'History' },
  ]

  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailHeader}>
        <div className={styles.detailHeaderRow}>
          <div>
            {classification.breadcrumb.length > 1 && (
              <div className={styles.breadcrumb}>
                {classification.breadcrumb.slice(0, -1).map((crumb: any, i: number) => (
                  <span key={crumb.id} className={styles.breadcrumbItem}>
                    {i > 0 && <ChevronRight size={10} className={styles.breadcrumbSep} />}
                    <span className={styles.breadcrumbCode}>{crumb.code}</span>
                    <span className={styles.breadcrumbName}>{crumb.name}</span>
                  </span>
                ))}
                <ChevronRight size={10} className={styles.breadcrumbSep} />
              </div>
            )}
            <div className={styles.detailTitleRow}>
              <span className={styles.detailCode}>{classification.full_code}</span>
              <h2 className={styles.detailName}>{classification.name}</h2>
              <StatusBadge status={classification.status} version={classification.version} versionLabel={classification.version_label} />
            </div>
            <div className={styles.detailMeta}>
              <span className={styles.detailLevel}>{classification.level_name}</span>
              {(classification.valid_from || classification.valid_to) && (
                <>
                  <span className={styles.metaSep}>·</span>
                  <span className={styles.detailValidity}>
                    <CalendarRange size={11} />
                    {classification.valid_from ?? '?'} → {classification.valid_to ?? 'present'}
                  </span>
                </>
              )}
              {classification.node_count > 0 && (
                <>
                  <span className={styles.metaSep}>·</span>
                  <span className={styles.detailNodeCount}>{classification.node_count} linked</span>
                </>
              )}
            </div>
          </div>

          <div className={styles.detailActions}>
            {classification.status !== 'published' && (
              <PublishButton classificationId={classificationId} onDone={() => queryClient.invalidateQueries({ queryKey: ['classification', classificationId] })} />
            )}
            {classification.status === 'published' && (
              <div style={{ position: 'relative' }}>
                <NewVersionButton classification={classification} onDone={() => {
                  queryClient.invalidateQueries({ queryKey: ['classification', classificationId] })
                  queryClient.invalidateQueries({ queryKey: ['classification-tree'] })
                }} />
              </div>
            )}
            {classification.status === 'published' && (
              <RetireButton
                classificationId={classificationId}
                hasChildren={classification.has_children}
                onDone={() => {
                  queryClient.invalidateQueries({ queryKey: ['classification', classificationId] })
                  queryClient.invalidateQueries({ queryKey: ['classification-tree'] })
                  if (classification.parent_id) {
                    queryClient.invalidateQueries({ queryKey: ['classification-children', classification.parent_id] })
                  }
                }}
              />
            )}
            <button className="btn btn-secondary btn-sm" onClick={() => onAddChild(classificationId)}>
              <Plus size={13} /> Add child
            </button>
            {classification.status === 'published' ? (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)', fontStyle: 'italic', padding: '4px 8px' }}
                title="Create a new version to edit">
                🔒 Published
              </span>
            ) : (
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => onEdit(classification)}
                title="Edit">
                <Pencil size={14} />
              </button>
            )}
            <button
              className="btn btn-ghost btn-sm btn-icon"
              title={classification.status === 'published' ? 'Retire before deleting' : 'Delete'}
              onClick={() => {
                if (classification.status === 'published') return
                const msg = classification.has_children
                  ? `Delete "${classification.name}" and all its children? All must be retired or draft.`
                  : `Delete "${classification.name}"?`
                if (confirm(msg)) deleteMutation.mutate()
              }}
              style={{ opacity: classification.status === 'published' ? 0.3 : 1 }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className={styles.detailBody}>
        {tab === 'details' && <DetailsTab classification={classification} />}
        {tab === 'nodes'   && <LinkedNodesTab classification={classification} />}
        {tab === 'diagram' && <DiagramTab classification={classification} />}
        {tab === 'history' && <HistoryTab classificationId={classificationId} />}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────

type ViewMode = 'detail' | 'create' | 'edit'

// ─── Status badge ────────────────────────────────────────────────────

function StatusBadge({ status, version, versionLabel }: {
  status: string; version: number; versionLabel?: string | null
}) {
  const s = status || 'draft'
  const label = s === 'published'
    ? `v${versionLabel ?? version} published`
    : s
  const cls = s === 'published'
    ? { background: 'var(--color-success-bg)', color: 'var(--color-success)', border: '1px solid var(--color-success-border)' }
    : s === 'retired'
    ? { background: 'var(--color-bg-subtle)', color: 'var(--color-ink-faint)', border: '1px solid var(--color-border)' }
    : { background: 'var(--color-warning-bg)', color: 'var(--color-warning)', border: '1px solid var(--color-warning-border)' }
  return (
    <span style={{ ...cls, fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

// ─── Publish / Retire buttons ─────────────────────────────────────────

function PublishButton({ classificationId, onDone }: { classificationId: number; onDone: () => void }) {
  const [showLabel, setShowLabel] = useState(false)
  const [label, setLabel] = useState('')
  const mutation = useMutation({
    mutationFn: () => classificationsApi.publish(classificationId, label || undefined),
    onSuccess: () => { setShowLabel(false); onDone() },
  })
  if (showLabel) {
    return (
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <input value={label} onChange={e => setLabel(e.target.value)}
          placeholder="Version label e.g. 2.1" style={{ fontSize: 'var(--text-sm)', padding: '4px 8px', width: 160 }}
          onKeyDown={e => { if (e.key === 'Enter') mutation.mutate(); if (e.key === 'Escape') setShowLabel(false) }}
          autoFocus />
        <button className="btn btn-primary btn-sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          <Eye size={13} /> Publish
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowLabel(false)}>Cancel</button>
      </div>
    )
  }
  return (
    <button className="btn btn-secondary btn-sm" onClick={() => setShowLabel(true)}>
      <Eye size={13} /> Publish
    </button>
  )
}

function RetireButton({ classificationId, hasChildren, onDone }: {
  classificationId: number; hasChildren: boolean; onDone: () => void
}) {
  const mutation = useMutation({
    mutationFn: (recursive: boolean) =>
      classificationsApi.retire(classificationId, recursive),
    onSuccess: onDone,
  })

  if (!hasChildren) {
    return (
      <button className="btn btn-ghost btn-sm"
        onClick={() => { if (confirm('Retire this classification?')) mutation.mutate(false) }}
        style={{ color: 'var(--color-ink-faint)' }}>
        <Archive size={13} /> Retire
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
      <button className="btn btn-ghost btn-sm"
        onClick={() => { if (confirm('Retire this classification only?')) mutation.mutate(false) }}
        style={{ color: 'var(--color-ink-faint)' }} title="Retire this node only">
        <Archive size={13} /> Retire
      </button>
      <button className="btn btn-ghost btn-sm"
        onClick={() => { if (confirm('Retire this classification AND all its children?')) mutation.mutate(true) }}
        style={{ color: 'var(--color-ink-faint)' }} title="Retire entire tree">
        <Archive size={13} /> Retire tree
      </button>
    </div>
  )
}

// ─── Diagram tab ──────────────────────────────────────────────────────

function DiagramTab({ classification }: { classification: any }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(classification.diagram ?? '')

  const mutation = useMutation({
    mutationFn: () => classificationsApi.updateDiagram(classification.id, draft || null),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['classification', classification.id] })
      setEditing(false)
    },
  })

  return (
    <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {editing ? (
        <>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-faint)' }}>
            Enter a <a href="https://mermaid.js.org" target="_blank" rel="noreferrer">Mermaid</a> diagram. Use <code>graph TD</code>, <code>flowchart LR</code>, <code>sequenceDiagram</code>, etc.
          </p>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={12}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', resize: 'vertical' }}
            placeholder='graph TD\n  A[Start] --> B[Process]'
            autoFocus
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setDraft(classification.diagram ?? '') }}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              <Save size={13} /> Save diagram
            </button>
          </div>
        </>
      ) : classification.diagram ? (
        <>
          <MermaidRenderer source={classification.diagram} />
          {classification.status !== 'published' && (
            <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing(true)}>
              <Pencil size={13} /> Edit diagram
            </button>
          )}
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-ink-faint)' }}>
          <BarChart2 size={32} style={{ marginBottom: 'var(--space-3)', opacity: 0.3 }} />
          <p>No diagram yet.</p>
          {classification.status !== 'published' && (
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--space-3)' }} onClick={() => setEditing(true)}>
              Add Mermaid diagram
            </button>
          )}
          {classification.status === 'published' && (
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)', marginTop: 'var(--space-2)' }}>
              Create a new version to add a diagram
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Mermaid renderer ─────────────────────────────────────────────────

function MermaidRenderer({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2)}`)
  const [renderError, setRenderError] = useState('')

  useEffect(() => {
    if (!ref.current || !source) return
    setRenderError('')
    const el = ref.current
    const diagramId = idRef.current

    const doRender = (mermaid: any) => {
      mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' })
      mermaid.render(diagramId, source)
        .then(({ svg }: { svg: string }) => { if (el) el.innerHTML = svg })
        .catch((e: unknown) => setRenderError(String(e)))
    }

    const win = window as any
    if (win.mermaid) {
      doRender(win.mermaid)
    } else {
      const existing = document.getElementById('mermaid-cdn')
      if (!existing) {
        const s = document.createElement('script')
        s.id = 'mermaid-cdn'
        s.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js'
        s.onload = () => doRender(win.mermaid)
        s.onerror = () => setRenderError('Failed to load Mermaid from CDN')
        document.head.appendChild(s)
      } else {
        // Script tag exists but not loaded yet — poll briefly
        let attempts = 0
        const poll = setInterval(() => {
          if (win.mermaid) { clearInterval(poll); doRender(win.mermaid) }
          if (++attempts > 20) { clearInterval(poll); setRenderError('Mermaid load timeout') }
        }, 200)
      }
    }
  }, [source])

  if (renderError) return (
    <div style={{ padding: 'var(--space-4)', background: 'var(--color-error-bg)', borderRadius: 'var(--radius-md)', color: 'var(--color-error)', fontSize: 'var(--text-sm)' }}>
      Diagram error: {renderError}
    </div>
  )
  return <div ref={ref} style={{ overflow: 'auto' }} />
}

// ─── New Version button ───────────────────────────────────────────────

function NewVersionButton({ classification, onDone }: { classification: any; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [versionLabel, setVersionLabel] = useState('')
  const [type, setType] = useState<'major' | 'minor'>('minor')

  const mutation = useMutation({
    mutationFn: async () => {
      if (type === 'major' && !classification.parent_id) {
        // Major revision: deep-copy the entire tree, then publish the copy
        return classificationsApi.createMajorVersion(classification.id, versionLabel)
      } else {
        // Minor revision: publish the existing node with incremented version
        return classificationsApi.publish(classification.id, versionLabel)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classification-tree'] })
      queryClient.invalidateQueries({ queryKey: ['classification', classification.id] })
      setOpen(false)
      onDone()
    },
  })

  if (!open) {
    return (
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        <GitCommit size={13} /> New version
      </button>
    )
  }

  const isRoot = !classification.parent_id

  return (
    <div style={{
      position: 'absolute', top: '100%', right: 0, zIndex: 200, marginTop: 4,
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-xl)',
      padding: 'var(--space-4)', minWidth: 320, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
    }}>
      <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Create new version</div>

      {isRoot && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <label style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>Revision type</label>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
            <input type="radio" checked={type === 'major'} onChange={() => setType('major')} style={{ marginTop: 3 }} />
            <div>
              <div style={{ fontWeight: 500 }}>Major revision</div>
              <div style={{ color: 'var(--color-ink-faint)', fontSize: 'var(--text-xs)' }}>
                Copies the entire tree as a new draft. The current published tree remains active until the new one is published.
              </div>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
            <input type="radio" checked={type === 'minor'} onChange={() => setType('minor')} style={{ marginTop: 3 }} />
            <div>
              <div style={{ fontWeight: 500 }}>Minor revision</div>
              <div style={{ color: 'var(--color-ink-faint)', fontSize: 'var(--text-xs)' }}>
                Republishes this node with an incremented version number. No copy is made.
              </div>
            </div>
          </label>
        </div>
      )}

      <div className="form-group" style={{ margin: 0 }}>
        <label>Version label (optional)</label>
        <input value={versionLabel} onChange={e => setVersionLabel(e.target.value)}
          placeholder={type === 'major' ? 'e.g. 3.0' : 'e.g. 2.1'}
          autoFocus />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? 'Creating…' : type === 'major' ? 'Copy & draft' : 'Publish new version'}
        </button>
      </div>
    </div>
  )
}

// ─── Import modal ─────────────────────────────────────────────────────

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [hierarchyTypeId, setHierarchyTypeId] = useState('')
  const [result, setResult] = useState<any>(null)
  const [importError, setImportError] = useState('')

  const { data: types } = useQuery({
    queryKey: ['hierarchy-types', 'classification'],
    queryFn: () => hierarchyApi.listTypes('classification').then(r => r.data.data as any[]),
  })

  const mutation = useMutation({
    mutationFn: () => classificationsApi.importFile(file!, parseInt(hierarchyTypeId)),
    onSuccess: (res) => {
      setResult(res.data.data)
      setImportError('')
      onImported()
    },
    onError: (e: any) => setImportError(e.response?.data?.message ?? 'Import failed'),
  })

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 600 }}
      onClick={onClose}>
      <div style={{ width: 480, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-5)', borderBottom: '1px solid var(--color-border)' }}>
          <h3 style={{ fontWeight: 600 }}><Upload size={15} style={{ marginRight: 'var(--space-2)' }} />Import classifications</h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><X size={14} /></button>
        </div>
        <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {result ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
              <Check size={24} style={{ color: 'var(--color-success)', marginBottom: 'var(--space-2)' }} />
              <p>{result.created} classifications imported</p>
              {result.errors?.length > 0 && <p style={{ color: 'var(--color-warning)', fontSize: 'var(--text-sm)' }}>{result.errors.length} skipped</p>}
            </div>
          ) : (
            <>
              {importError && <div style={{ padding: 'var(--space-3)', background: 'var(--color-error-bg)', color: 'var(--color-error)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)' }}>{importError}</div>}
              <div className="form-group">
                <label>Kurbits JSON file *</label>
                <input type="file" accept=".json" onChange={e => setFile(e.target.files?.[0] ?? null)} />
              </div>
              <div className="form-group">
                <label>Hierarchy type *</label>
                <select value={hierarchyTypeId} onChange={e => setHierarchyTypeId(e.target.value)}>
                  <option value="">Select…</option>
                  {types?.map((ht: any) => <option key={ht.id} value={ht.id}>{ht.name}</option>)}
                </select>
              </div>
              <div style={{ background: 'var(--color-bg-subtle)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)' }}>
                JSON format: <code>{`[{"code":"A","name":"...","level":"Klass","children":[...],"diagram":"graph TD..."}]`}</code>
              </div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', padding: 'var(--space-4) var(--space-5)', borderTop: '1px solid var(--color-border)' }}>
          <button className="btn btn-ghost" onClick={onClose}>{result ? 'Close' : 'Cancel'}</button>
          {!result && <button className="btn btn-primary" disabled={!file || !hierarchyTypeId || mutation.isPending} onClick={() => mutation.mutate()}>
            <Upload size={14} /> Import
          </button>}
        </div>
      </div>
    </div>
  )
}

export default function ClassificationsPage() {
  const queryClient = useQueryClient()
  const location = useLocation()
  const [selectedId, setSelectedId] = useState<number | null>(
    location.state?.selectClassificationId ?? null
  )
  const [showImport, setShowImport] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('detail')
  const [editingItem, setEditingItem] = useState<any>(null)
  const [addingChildOf, setAddingChildOf] = useState<number | null>(null)

  // Pick up selectClassificationId if navigated here from another page
  useEffect(() => {
    const id = location.state?.selectClassificationId
    if (id) {
      setSelectedId(id)
      setViewMode('detail')
    }
  }, [location.state?.selectClassificationId])

  const { data: parentData } = useQuery({
    queryKey: ['classification', addingChildOf],
    queryFn: () => classificationsApi.get(addingChildOf!).then(r => r.data.data),
    enabled: addingChildOf !== null,
  })

  const createMutation = useMutation({
    mutationFn: (data: FormData) => classificationsApi.create({
      ...data,
      hierarchy_type_id: parseInt(data.hierarchy_type_id),
      valid_from: data.valid_from || null,
      valid_to: data.valid_to || null,
      parent_id: addingChildOf,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['classification-tree'] })
      queryClient.invalidateQueries({ queryKey: ['classification-children', addingChildOf] })
      setSelectedId(res.data.data.id)
      setViewMode('detail')
      setAddingChildOf(null)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: FormData) => classificationsApi.update(editingItem.id, {
      ...data,
      valid_from: data.valid_from || null,
      valid_to: data.valid_to || null,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['classification-tree'] })
      queryClient.invalidateQueries({ queryKey: ['classification', editingItem.id] })
      setSelectedId(res.data.data.id)
      setViewMode('detail')
      setEditingItem(null)
    },
  })

  const showDetail = selectedId !== null && viewMode === 'detail'
  const showForm   = viewMode === 'create' || viewMode === 'edit'

  return (
    <>
    <PageShell
      sidebar={
        <SidebarPanel
          title="Classifications"
          actions={
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowImport(true)}
                title="Import from JSON"
              >
                <Upload size={14} />
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => { setAddingChildOf(null); setViewMode('create') }}
              >
                <Plus size={14} /> New
              </button>
            </div>
          }
        >
          <div className={styles.treeWrap}>
            <ClassificationTree
              selectedId={selectedId}
              onSelect={(c) => { setSelectedId(c.id); setViewMode('detail') }}
            />
          </div>
        </SidebarPanel>
      }

      content={
        showForm ? (
          <div className={styles.formPanel}>
            <div className={styles.formPanelHeader}>
              <h2 className={styles.formPanelTitle}>
                {viewMode === 'create'
                  ? addingChildOf ? 'Add child classification' : 'New classification'
                  : `Edit: ${editingItem?.name}`}
              </h2>
            </div>
            <div className={styles.formPanelBody}>
              <ClassificationForm
                initial={editingItem ? {
                  name:               editingItem.name,
                  code:               editingItem.code,
                  level_name:         editingItem.level_name,
                  hierarchy_type_id:  String(editingItem.hierarchy_type_id),
                  description:        editingItem.description ?? '',
                  scope_note:         editingItem.scope_note ?? '',
                  valid_from:         editingItem.valid_from ?? '',
                  valid_to:           editingItem.valid_to ?? '',
                } : undefined}
                parentClassification={addingChildOf ? (parentData ?? null) : null}
                onSave={(data) => {
                  if (viewMode === 'create') createMutation.mutate(data)
                  else updateMutation.mutate(data)
                }}
                onCancel={() => {
                  setViewMode('detail')
                  setEditingItem(null)
                  setAddingChildOf(null)
                }}
                isSaving={createMutation.isPending || updateMutation.isPending}
              />
            </div>
          </div>
        ) : showDetail ? (
          <ClassificationDetailPanel
            key={selectedId}
            classificationId={selectedId}
            onEdit={(c) => { setEditingItem(c); setViewMode('edit') }}
            onAddChild={(parentId) => { setAddingChildOf(parentId); setViewMode('create') }}
            onDelete={() => { setSelectedId(null); setViewMode('detail') }}
          />
        ) : (
          <EmptyState
            icon={<Tag size={36} />}
            title="Select a classification to view details"
            subtitle="or create a new one"
          />
        )
      }
    />
    {showImport && (
      <ImportModal
        onClose={() => setShowImport(false)}
        onImported={() => {
          setShowImport(false)
          queryClient.invalidateQueries({ queryKey: ['classification-tree'] })
        }}
      />
    )}
    </>
  )
}