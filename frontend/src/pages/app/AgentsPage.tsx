import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Users, User, Building2, UsersRound, Bot,
  Pencil, Trash2, Link, FileText, StickyNote,
  X, Save, ExternalLink, Globe, Upload, Check, AlertCircle,
  MapPin, Tag as Tag2, Search, Download
} from 'lucide-react'
import { agentsApi, agentsImportApi, nodesApi} from '@/api'
import PlacesPanel from '@/components/geo/PlacesPanel'
import TagsPanel from '@/components/geo/TagsPanel'
import {
  PageShell, SidebarPanel, EmptyState, Tabs,
  FieldList, SearchInput, Spinner, TypePill
} from '@/components/ui'
import type { AgentDetail, AgentStub, AgentType } from '@/types'
import styles from './AgentsPage.module.css'
import AuthorityLookup from '@/components/ui/AuthorityLookup'
import type { AuthorityResult } from '@/components/ui/AuthorityLookup'
import BookmarkButton from '@/components/layout/BookmarkButton'

// ─── Constants ───────────────────────────────────────────────────────

const AGENT_TYPE_ICONS: Record<AgentType, typeof User> = {
  person: User,
  organization: Building2,
  family: UsersRound,
  software: Bot,
}

const AGENT_TYPES: AgentType[] = ['person', 'organization', 'family', 'software']

// ─── Agent list item ──────────────────────────────────────────────────

function AgentListItem({
  agent,
  isSelected,
  onClick,
}: {
  agent: AgentStub
  isSelected: boolean
  onClick: () => void
}) {
  const Icon = AGENT_TYPE_ICONS[agent.agent_type]
  return (
    <div
      className={`${styles.listItem} ${isSelected ? styles.listItemSelected : ''}`}
      onClick={onClick}
    >
      <div className={styles.listItemIcon}>
        <Icon size={14} />
      </div>
      <div className={styles.listItemBody}>
        <span className={styles.listItemName}>{agent.name}</span>
        <div className={styles.listItemMeta}>
          <TypePill type={agent.agent_type} />
          {(agent.date_from || agent.date_to) && (
            <span className={styles.listItemDates}>
              {agent.date_from ?? '?'}{agent.date_to ? ` – ${agent.date_to}` : ''}
            </span>
          )}
          {agent.identifier && (
            <span className={styles.listItemId}>{agent.identifier}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Agent form ───────────────────────────────────────────────────────

interface AgentFormData {
  name: string
  agent_type: AgentType
  authorized_form: string
  description: string
  date_from: string
  date_to: string
  identifier: string
  website: string
}

const EMPTY_FORM: AgentFormData = {
  name: '', agent_type: 'person', authorized_form: '',
  description: '', date_from: '', date_to: '',
  identifier: '', website: '',
}

function AgentForm({
  initial,
  onSave,
  onCancel,
  isSaving,
}: {
  initial?: Partial<AgentFormData>
  onSave: (data: AgentFormData) => void
  onCancel: () => void
  isSaving: boolean
}) {
  const [form, setForm] = useState<AgentFormData>({ ...EMPTY_FORM, ...initial })
  const set = (field: keyof AgentFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))

  const handleAuthorityApply = (result: AuthorityResult) => {
    setForm(f => ({
      ...f,
      name:             result.name || f.name,
      authorized_form:  result.authorized_form || f.authorized_form,
      agent_type:       result.agent_type || f.agent_type,
      date_from:        result.date_from || f.date_from,
      date_to:          result.date_to || f.date_to,
      description:      result.description || f.description,
      identifier:       result.identifier || f.identifier,
      website:          result.website || f.website,
    }))
  }

  return (
    <div className={styles.form}>
      <AuthorityLookup onApply={handleAuthorityApply} />
      <div className={styles.formGrid}>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>Name *</label>
          <input value={form.name} onChange={set('name')} placeholder="Full name or corporate name" required />
        </div>

        <div className="form-group">
          <label>Type *</label>
          <select value={form.agent_type} onChange={set('agent_type')}>
            {AGENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>Authorized form of name</label>
          <input value={form.authorized_form} onChange={set('authorized_form')}
            placeholder="As used in authority files" />
        </div>

        <div className="form-group">
          <label>Date of existence (from)</label>
          <input value={form.date_from} onChange={set('date_from')}
            placeholder="e.g. 1842 or 1842-03-15" />
        </div>

        <div className="form-group">
          <label>Date of existence (to)</label>
          <input value={form.date_to} onChange={set('date_to')}
            placeholder="Leave empty if still active" />
        </div>

        <div className="form-group">
          <label>External identifier</label>
          <input value={form.identifier} onChange={set('identifier')}
            placeholder="ISNI, VIAF, Wikidata QID…" />
        </div>

        <div className="form-group">
          <label>Website</label>
          <input value={form.website} onChange={set('website')}
            placeholder="https://…" type="url" />
        </div>

        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>Description / biography</label>
          <textarea value={form.description} onChange={set('description')}
            rows={5} placeholder="Biographical or organizational history…" />
        </div>
      </div>

      <div className={styles.formActions}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={isSaving}>
          <X size={14} /> Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={() => onSave(form)}
          disabled={!form.name || isSaving}
        >
          {isSaving ? <Spinner size={14} /> : <Save size={14} />}
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ─── Detail tabs ──────────────────────────────────────────────────────

function DetailsTab({ agent }: { agent: AgentDetail }) {
  return (
    <div className={styles.tabContent}>
      <FieldList fields={[
        { label: 'Authorized form', value: agent.authorized_form },
        { label: 'Description / Biography', value: agent.description },
        { label: 'Date of existence', value: agent.date_from || agent.date_to
            ? `${agent.date_from ?? '?'}${agent.date_to ? ` – ${agent.date_to}` : ' – present'}`
            : null },
        { label: 'External identifier', value: agent.identifier },
        { label: 'Website', value: agent.website
            ? <a href={agent.website} target="_blank" rel="noreferrer">
                {agent.website} <ExternalLink size={11} />
              </a>
            : null },
      ]} />
      <div className={styles.detailFooter}>
        <span>Created by {agent.created_by ?? '—'}</span>
        <span>Updated {new Date(agent.updated_at).toLocaleDateString()}</span>
      </div>
    </div>
  )
}

function RelationsTab({ agent }: { agent: AgentDetail }) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const [targetId, setTargetId] = useState<number | null>(null)
  const [relationType, setRelationType] = useState('')

  const { data: relTypes } = useQuery({
    queryKey: ['agent-relation-types'],
    queryFn: () => agentsApi.getRelationTypes().then(r => r.data.data as any[]),
  })

  const { data: searchResults } = useQuery({
    queryKey: ['agents-search', search],
    queryFn: () => agentsApi.list({ q: search, per_page: 8 }).then(r => r.data.data),
    enabled: search.length > 1,
  })

  const addMutation = useMutation({
    mutationFn: () => agentsApi.addRelation(agent.id, targetId!, relationType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent', agent.id] })
      setAdding(false)
      setSearch('')
      setTargetId(null)
      setRelationType('')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (targetId: number) => agentsApi.removeRelation(agent.id, targetId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent', agent.id] }),
  })

  return (
    <div className={styles.tabContent}>
      <div className={styles.tabActions}>
        <button className="btn btn-secondary btn-sm" onClick={() => setAdding(!adding)}>
          <Plus size={13} /> Add relation
        </button>
      </div>

      {adding && (
        <div className={styles.addForm}>
          <div className="form-group">
            <label>Relation type</label>
            <select value={relationType} onChange={e => setRelationType(e.target.value)}>
              <option value="">Select type…</option>
              {relTypes?.map((rt: any) => (
                <option key={rt.id} value={rt.name}>{rt.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Search for agent</label>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Type to search agents…"
            />
          </div>
          {searchResults && search.length > 1 && (
            <div className={styles.searchResults}>
              {searchResults
                .filter(a => a.id !== agent.id)
                .map((a: AgentStub) => (
                  <button
                    key={a.id}
                    className={`${styles.searchResult} ${targetId === a.id ? styles.searchResultSelected : ''}`}
                    onClick={() => setTargetId(a.id)}
                  >
                    <TypePill type={a.agent_type} />
                    <span>{a.name}</span>
                  </button>
                ))}
            </div>
          )}
          <div className={styles.addFormActions}>
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
            <button
              className="btn btn-primary btn-sm"
              disabled={!targetId || !relationType || addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {agent.relations.length === 0 && !adding && (
        <p className={styles.emptyText}>No relations recorded.</p>
      )}

      {agent.relations.map((rel, i) => (
        <div key={i} className={styles.relationRow}>
          <div className={styles.relationMeta}>
            <span className={styles.relationType}>{rel.association_type}</span>
            <span className={styles.relationDirection}>{rel.direction}</span>
          </div>
          <div className={styles.relationAgent}>
            <TypePill type={rel.agent.agent_type} />
            <span className={styles.relationName}>{rel.agent.name}</span>
          </div>
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => removeMutation.mutate(rel.agent.id)}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

function LinkedResourcesTab({ agent }: { agent: AgentDetail }) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [rootFilter, setRootFilter] = useState<{ id: number; label: string } | null>(null)
  const [rootInput, setRootInput] = useState('')
  const [rootOpen, setRootOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setRootOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const { data, isLoading } = useQuery({
    queryKey: ['agent-nodes', agent.id],
    queryFn: () => agentsApi.getNodes(agent.id).then(r => r.data.data as any[]),
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

  const rootSuggestions = rootInput
    ? usedRoots.filter(r => r.label.toLowerCase().includes(rootInput.toLowerCase()))
    : usedRoots

  const filtered = (data ?? []).filter((node: any) => {
    const root = getRootNode(node)
    if (rootFilter && root?.id !== rootFilter.id) return false
    if (search) {
      const q = search.toLowerCase()
      if (!node.title?.toLowerCase().includes(q) && !node.ref_code?.toLowerCase().includes(q)) return false
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
                {(rootFilter || rootInput) && (
                  <button className={styles.linkedNodesSearchClear} onClick={() => { setRootFilter(null); setRootInput(''); setRootOpen(false) }}>
                    <X size={11} />
                  </button>
                )}
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
          No resources linked yet. Associate this agent from the Resources section.
        </p>
      ) : filtered.length === 0 ? (
        <p className={styles.emptyText} style={{ padding: 'var(--space-5)' }}>No results.</p>
      ) : (
        filtered.map((node: any) => {
          const root = getRootNode(node)
          return (
            <button
              key={node.id}
              className={styles.linkedNode}
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
              <span className={styles.linkedNodeRelType}>{node.relation_type}</span>
            </button>
          )
        })
      )}
    </div>
  )
}

// ─── Notes tab ────────────────────────────────────────────────────────

// ─── Notes tab ────────────────────────────────────────────────────────

function NotesTab({ agent }: { agent: AgentDetail }) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [content, setContent] = useState('')
  const [noteType, setNoteType] = useState('general')

  const addMutation = useMutation({
    mutationFn: () => agentsApi.addNote(agent.id, { content, note_type: noteType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent', agent.id] })
      setContent('')
      setAdding(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (noteId: number) => agentsApi.deleteNote(agent.id, noteId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent', agent.id] }),
  })

  return (
    <div className={styles.tabContent}>
      <div className={styles.tabActions}>
        <button className="btn btn-secondary btn-sm" onClick={() => setAdding(!adding)}>
          <Plus size={13} /> Add note
        </button>
      </div>

      {adding && (
        <div className={styles.addForm}>
          <div className="form-group">
            <label>Note type</label>
            <select value={noteType} onChange={e => setNoteType(e.target.value)}>
              {['general', 'history', 'sources', 'maintenance', 'internal'].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Content</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={4} />
          </div>
          <div className={styles.addFormActions}>
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
            <button
              className="btn btn-primary btn-sm"
              disabled={!content || addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              Save
            </button>
          </div>
        </div>
      )}

      {agent.notes.length === 0 && !adding && (
        <p className={styles.emptyText}>No notes yet.</p>
      )}

      {agent.notes.map(note => (
        <div key={note.id} className={styles.noteCard}>
          <div className={styles.noteCardHeader}>
            <span className={styles.noteType}>{note.note_type}</span>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              style={{ marginLeft: 'auto' }}
              onClick={() => deleteMutation.mutate(note.id)}
            >
              <Trash2 size={12} />
            </button>
          </div>
          <p className={styles.noteContent}>{note.content}</p>
          <span className={styles.noteMeta}>
            {note.created_by} · {new Date(note.created_at).toLocaleDateString()}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Copy link button ─────────────────────────────────────────────────

function CopyAgentLinkButton({ agentId, agentName }: { agentId: number; agentName: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="btn btn-ghost btn-sm btn-icon"
      onClick={() => {
        const url = `${window.location.origin}/app/agents?agent=${agentId}`
        navigator.clipboard.writeText(url).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
      }}
      title={copied ? 'Copied!' : `Copy direct link for ${agentName}`}
    >
      {copied ? <Check size={14} /> : <Link size={14} />}
    </button>
  )
}

// ─── Detail panel ─────────────────────────────────────────────────────

function AgentDetailPanel({
  agentId,
  onEdit,
  onDelete,
}: {
  agentId: number
  onEdit: (agent: AgentDetail) => void
  onDelete: () => void
}) {
  const [tab, setTab] = useState('details')
  const queryClient = useQueryClient()

  const { data: agent, isLoading } = useQuery({
    queryKey: ['agent', agentId],
    queryFn: () => agentsApi.get(agentId).then(r => r.data.data),
  })

  const deleteMutation = useMutation({
    mutationFn: () => agentsApi.delete(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      onDelete()
    },
  })

  if (isLoading) return (
    <div className={styles.loadingState}><Spinner /><span>Loading…</span></div>
  )
  if (!agent) return null

  const Icon = AGENT_TYPE_ICONS[agent.agent_type]

  const tabs = [
    { key: 'details',   icon: <FileText size={13} />,   label: 'Details' },
    { key: 'relations', icon: <Link size={13} />,        label: `Relations${agent.relations.length ? ` (${agent.relations.length})` : ''}` },
    { key: 'resources', icon: <Globe size={13} />,       label: `Resources${agent.node_count ? ` (${agent.node_count})` : ''}` },
    { key: 'places',    icon: <MapPin size={13} />,      label: 'Places' },
    { key: 'tags',      icon: <Tag2 size={13} />,        label: 'Tags' },
    { key: 'notes',     icon: <StickyNote size={13} />,  label: `Notes${agent.notes.length ? ` (${agent.notes.length})` : ''}` },
  ]

  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailHeader}>
        <div className={styles.detailHeaderRow}>
          <div className={styles.detailTitleGroup}>
            <div className={styles.detailTypeIcon}>
              <Icon size={18} />
            </div>
            <div>
              <h2 className={styles.detailName}>{agent.name}</h2>
              {agent.authorized_form && agent.authorized_form !== agent.name && (
                <p className={styles.detailAuthorized}>{agent.authorized_form}</p>
              )}
            </div>
          </div>
          <div className={styles.detailHeaderActions}>
            <TypePill type={agent.agent_type} />
            <BookmarkButton
              entityType="agent"
              entityId={agent.id}
              title={agent.name ?? agent.authorized_form}
              subtitle={agent.agent_type}
            />
            <CopyAgentLinkButton agentId={agentId} agentName={agent.name} />
              <a      className="btn btn-ghost btn-sm btn-icon"
              href={agentsApi.exportEacUrl(agentId)}
              download
              title="Export as EAC-CPF"
            >
              <Download size={14} />
            </a>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => onEdit(agent)} title="Edit">
              <Pencil size={14} />
            </button>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              title="Delete"
              onClick={() => {
                if (confirm(`Delete agent "${agent.name}"?`)) deleteMutation.mutate()
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className={styles.detailBody}>
        {tab === 'details'   && <DetailsTab agent={agent} />}
        {tab === 'relations' && <RelationsTab agent={agent} />}
        {tab === 'resources' && <LinkedResourcesTab agent={agent} />}
        {tab === 'places'    && <PlacesPanel entityType="agent" entityId={agent.id} />}
        {tab === 'tags'      && <TagsPanel entityType="agent" entityId={agent.id} />}
        {tab === 'notes'     && <NotesTab agent={agent} />}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────

type ViewMode = 'detail' | 'create' | 'edit'

// ─── EAC-CPF import modal ─────────────────────────────────────────────

function EacCpfImportModal({ onClose, onImported }: {
  onClose: () => void; onImported: () => void
}) {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [updateExisting, setUpdateExisting] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [importError, setImportError] = useState('')

  const mutation = useMutation({
    mutationFn: () => agentsImportApi.importEacCpf(file!, updateExisting),
    onSuccess: res => {
      setResult(res.data.data)
      setImportError('')
      queryClient.invalidateQueries({ queryKey: ['agents'] })
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
          <h3 style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Upload size={16} /> Import EAC-CPF
          </h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><X size={14} /></button>
        </div>

        <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {result ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
              <Check size={28} style={{ color: 'var(--color-success)', marginBottom: 'var(--space-3)' }} />
              <div style={{ fontWeight: 600, fontSize: 'var(--text-lg)', marginBottom: 'var(--space-2)' }}>
                Import complete
              </div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-faint)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                {result.total_created > 0 && <span>{result.total_created} agent{result.total_created !== 1 ? 's' : ''} created</span>}
                {result.total_updated > 0 && <span>{result.total_updated} agent{result.total_updated !== 1 ? 's' : ''} updated</span>}
                {result.skipped?.length > 0 && <span>{result.skipped.length} skipped (already exist)</span>}
              </div>
              {result.warnings?.length > 0 && (
                <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', background: 'var(--color-warning-bg)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)', color: 'var(--color-warning)', textAlign: 'left' }}>
                  {result.warnings.map((w: string, i: number) => <div key={i}>{w}</div>)}
                </div>
              )}
            </div>
          ) : (
            <>
              {importError && (
                <div style={{ display: 'flex', gap: 'var(--space-2)', padding: 'var(--space-3)', background: 'var(--color-error-bg)', border: '1px solid var(--color-error-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-error)', fontSize: 'var(--text-sm)' }}>
                  <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />{importError}
                </div>
              )}
              <div className="form-group">
                <label>EAC-CPF XML file *</label>
                <input type="file" accept=".xml" onChange={e => setFile(e.target.files?.[0] ?? null)} />
                <span className="form-hint">Single record or collection file. Supports EAC-CPF 2010 and 2022.</span>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
                <input type="checkbox" checked={updateExisting} onChange={e => setUpdateExisting(e.target.checked)} />
                Update existing agents matched by identifier or name
              </label>
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

export default function AgentsPage() {
  const queryClient = useQueryClient()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<AgentType | ''>('')
  const [showImport, setShowImport] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(
    searchParams.get('agent')
      ? parseInt(searchParams.get('agent')!)
      : location.state?.selectAgentId ?? null
  )
  const [viewMode, setViewMode] = useState<ViewMode>('detail')
  const [editingAgent, setEditingAgent] = useState<AgentDetail | null>(null)

  useEffect(() => {
    const id = location.state?.selectAgentId
    if (id) { setSelectedId(id); setViewMode('detail') }
  }, [location.state?.selectAgentId])

  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading } = useQuery({
    queryKey: ['agents', debouncedSearch, typeFilter],
    queryFn: () => agentsApi.list({
      q: debouncedSearch || undefined,
      type: typeFilter || undefined,
      per_page: 50,
    }).then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (formData: AgentFormData) => agentsApi.create(formData as any),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      setSelectedId(res.data.data.id)
      setViewMode('detail')
    },
  })

  const updateMutation = useMutation({
    mutationFn: (formData: AgentFormData) => agentsApi.update(editingAgent!.id, formData as any),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      queryClient.invalidateQueries({ queryKey: ['agent', editingAgent!.id] })
      setSelectedId(res.data.data.id)
      setViewMode('detail')
      setEditingAgent(null)
    },
  })

  const agents = data?.data ?? []
  const total = (data as any)?.meta?.total ?? agents.length

  const showDetail = selectedId !== null && viewMode === 'detail'
  const showForm = viewMode === 'create' || viewMode === 'edit'

  return (
    <>
    {showImport && <EacCpfImportModal onClose={() => setShowImport(false)} onImported={() => setShowImport(false)} />}
    <PageShell
      sidebar={
        <SidebarPanel
          title="Agents"
          actions={
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                className="btn btn-ghost btn-sm btn-icon"
                onClick={() => setShowImport(true)}
                title="Import EAC-CPF"
              >
                <Upload size={14} />
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => { setViewMode('create'); setSelectedId(null) }}
              >
                <Plus size={14} /> New
              </button>
            </div>
          }
        >
          <SearchInput value={search} onChange={setSearch} placeholder="Search agents…" />
          <div className={styles.typeFilter}>
            <button
              className={`${styles.typeFilterBtn} ${typeFilter === '' ? styles.typeFilterActive : ''}`}
              onClick={() => setTypeFilter('')}
            >All</button>
            {AGENT_TYPES.map(t => (
              <button
                key={t}
                className={`${styles.typeFilterBtn} ${typeFilter === t ? styles.typeFilterActive : ''}`}
                onClick={() => setTypeFilter(t === typeFilter ? '' : t)}
              >
                {t}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className={styles.loadingList}><Spinner /></div>
          ) : agents.length === 0 ? (
            <div className={styles.listEmpty}>
              <p>No agents found.</p>
            </div>
          ) : (
            <>
              <div className={styles.listCount}>{total} agent{total !== 1 ? 's' : ''}</div>
              {agents.map(agent => (
                <AgentListItem
                  key={agent.id}
                  agent={agent}
                  isSelected={selectedId === agent.id}
                  onClick={() => { setSelectedId(agent.id); setViewMode('detail') }}
                />
              ))}
            </>
          )}
        </SidebarPanel>
      }

      content={
        showForm ? (
          <div className={styles.formPanel}>
            <div className={styles.formPanelHeader}>
              <h2 className={styles.formPanelTitle}>
                {viewMode === 'create' ? 'New agent' : `Edit: ${editingAgent?.name}`}
              </h2>
            </div>
            <div className={styles.formPanelBody}>
              <AgentForm
                initial={editingAgent ? {
                  name: editingAgent.name,
                  agent_type: editingAgent.agent_type,
                  authorized_form: editingAgent.authorized_form ?? '',
                  description: editingAgent.description ?? '',
                  date_from: editingAgent.date_from ?? '',
                  date_to: editingAgent.date_to ?? '',
                  identifier: editingAgent.identifier ?? '',
                  website: editingAgent.website ?? '',
                } : undefined}
                onSave={(formData) => {
                  if (viewMode === 'create') createMutation.mutate(formData)
                  else updateMutation.mutate(formData)
                }}
                onCancel={() => {
                  setViewMode('detail')
                  setEditingAgent(null)
                }}
                isSaving={createMutation.isPending || updateMutation.isPending}
              />
            </div>
          </div>
        ) : showDetail ? (
          <AgentDetailPanel
            key={selectedId}
            agentId={selectedId}
            onEdit={(agent) => { setEditingAgent(agent); setViewMode('edit') }}
            onDelete={() => { setSelectedId(null); setViewMode('detail') }}
          />
        ) : (
          <EmptyState
            icon={<Users size={36} />}
            title="Select an agent to view details"
            subtitle="or create a new one"
          />
        )
      }
    />
    </>
  )
}