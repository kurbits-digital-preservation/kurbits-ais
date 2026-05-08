import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, FileText, User, Building2, UsersRound, Bot,
  SlidersHorizontal, X, ChevronLeft, ChevronRight,
  Bookmark, BookmarkCheck, Trash2,
} from 'lucide-react'
import { searchApi, hierarchyApi, savedSearchesApi } from '@/api'
import { Spinner } from '@/components/ui'
import styles from './SearchPage.module.css'

const AGENT_ICONS: Record<string, typeof User> = {
  person: User, organization: Building2, family: UsersRound, software: Bot,
}
const NODE_STATUSES = ['draft', 'published', 'restricted']
const AGENT_TYPES = ['person', 'organization', 'family', 'software']
const FILTER_KEYS = ['status', 'level', 'date_from', 'date_to', 'agent_type', 'types']

// ─── Helpers ──────────────────────────────────────────────────────────

function paramsToObject(params: URLSearchParams): Record<string, string> {
  const obj: Record<string, string> = {}
  for (const [k, v] of params.entries()) {
    if (k !== 'page') obj[k] = v
  }
  return obj
}

function summariseParams(params: Record<string, string>): string {
  const parts: string[] = []
  if (params.q) parts.push(`"${params.q}"`)
  if (params.status) parts.push(params.status)
  if (params.level) parts.push(params.level)
  if (params.date_from || params.date_to) parts.push(`${params.date_from ?? '…'}–${params.date_to ?? '…'}`)
  if (params.agent_type) parts.push(params.agent_type)
  if (params.types && params.types !== 'nodes,agents') parts.push(params.types.replace(',', ' & '))
  return parts.join(', ')
}

// ─── Result rows ──────────────────────────────────────────────────────

function NodeRow({ item, onClick }: { item: any; onClick: () => void }) {
  return (
    <button className={styles.resultRow} onClick={onClick}>
      <div className={styles.resultIconWrap}><FileText size={15} /></div>
      <div className={styles.resultBody}>
        <div className={styles.resultTitle}>{item.title}</div>
        <div className={styles.resultMeta}>
          {item.ref_code && <span className={styles.resultRef}>{item.ref_code}</span>}
          {item.ref_code && item.level && <span className={styles.dot}>·</span>}
          {item.level && <span className={styles.resultLevel}>{item.level}</span>}
          {item.status && item.status !== 'published' && (
            <><span className={styles.dot}>·</span>
            <span className={styles.statusBadge} data-status={item.status}>{item.status}</span></>
          )}
        </div>
      </div>
      <span className={styles.resultType}>Resource</span>
    </button>
  )
}

function AgentRow({ item, onClick }: { item: any; onClick: () => void }) {
  const Icon = AGENT_ICONS[item.agent_type] ?? User
  return (
    <button className={styles.resultRow} onClick={onClick}>
      <div className={styles.resultIconWrap}><Icon size={15} /></div>
      <div className={styles.resultBody}>
        <div className={styles.resultTitle}>{item.name ?? item.authorized_form}</div>
        <div className={styles.resultMeta}>
          <span className={styles.resultLevel}>{item.agent_type}</span>
          {item.date_from && (
            <><span className={styles.dot}>·</span>
            <span>{item.date_from}{item.date_to ? `–${item.date_to}` : ''}</span></>
          )}
        </div>
      </div>
      <span className={styles.resultType}>Agent</span>
    </button>
  )
}

// ─── Filter panel ─────────────────────────────────────────────────────

function FilterPanel({ params, setParam, clearParam, levels }: {
  params: URLSearchParams
  setParam: (k: string, v: string) => void
  clearParam: (k: string) => void
  levels: string[]
}) {
  const types = params.get('types') ?? 'nodes,agents'
  const showNodeFilters = types.includes('nodes')
  const showAgentFilters = types.includes('agents')
  return (
    <div className={styles.filters}>
      <div className={styles.filterGroup}>
        <label className={styles.filterLabel}>Record type</label>
        {[{ value: 'nodes,agents', label: 'All' }, { value: 'nodes', label: 'Resources only' }, { value: 'agents', label: 'Agents only' }]
          .map(opt => (
            <label key={opt.value} className={styles.radioLabel}>
              <input type="radio" checked={types === opt.value} onChange={() => setParam('types', opt.value)} />
              {opt.label}
            </label>
          ))}
      </div>
      {showNodeFilters && (<>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Status</label>
          <select value={params.get('status') ?? ''}
            onChange={e => e.target.value ? setParam('status', e.target.value) : clearParam('status')}>
            <option value="">Any</option>
            {NODE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {levels.length > 0 && (
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>Level</label>
            <select value={params.get('level') ?? ''}
              onChange={e => e.target.value ? setParam('level', e.target.value) : clearParam('level')}>
              <option value="">Any</option>
              {levels.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        )}
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Date range</label>
          <div className={styles.dateRow}>
            <label className={styles.filterLabel} style={{ textTransform: 'none', fontWeight: 400 }}>From</label>
            <input type="date" value={params.get('date_from') ?? ''}
              onChange={e => e.target.value ? setParam('date_from', e.target.value) : clearParam('date_from')} />
            <label className={styles.filterLabel} style={{ textTransform: 'none', fontWeight: 400 }}>To</label>
            <input type="date" value={params.get('date_to') ?? ''}
              onChange={e => e.target.value ? setParam('date_to', e.target.value) : clearParam('date_to')} />
          </div>
        </div>
      </>)}
      {showAgentFilters && (
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Agent type</label>
          <select value={params.get('agent_type') ?? ''}
            onChange={e => e.target.value ? setParam('agent_type', e.target.value) : clearParam('agent_type')}>
            <option value="">Any</option>
            {AGENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      )}
      {FILTER_KEYS.filter(k => k !== 'types').some(k => params.has(k)) && (
        <button className={styles.clearFilters}
          onClick={() => FILTER_KEYS.filter(k => k !== 'types').forEach(clearParam)}>
          <X size={12} /> Clear filters
        </button>
      )}
    </div>
  )
}

// ─── Saved searches panel ─────────────────────────────────────────────

function SavedSearchesPanel({ onLoad }: { onLoad: (params: Record<string, string>) => void }) {
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [nameError, setNameError] = useState('')

  const { data: savedSearches = [], isLoading } = useQuery({
    queryKey: ['saved-searches'],
    queryFn: () => savedSearchesApi.list().then(r => r.data.data),
  })

  const [searchParams] = useSearchParams()
  const currentParams = paramsToObject(searchParams)
  const hasAnything = Object.keys(currentParams).length > 0

  const createMutation = useMutation({
    mutationFn: ({ name, params }: { name: string; params: Record<string, string> }) =>
      savedSearchesApi.create(name, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-searches'] })
      setSaving(false)
      setNameInput('')
      setNameError('')
    },
    onError: (err: any) => {
      setNameError(err?.response?.data?.message ?? 'Could not save')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => savedSearchesApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-searches'] }),
  })

  const handleSave = () => {
    const name = nameInput.trim()
    if (!name) { setNameError('Enter a name'); return }
    setNameError('')
    createMutation.mutate({ name, params: currentParams })
  }

  return (
    <div className={styles.savedPanel}>
      <div className={styles.savedHeader}>
        <Bookmark size={13} />
        Saved searches
      </div>

      {hasAnything && (
        saving ? (
          <div className={styles.saveForm}>
            <input
              className={styles.saveInput}
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setSaving(false) }}
              placeholder="Name this search…"
              autoFocus
            />
            {nameError && <span className={styles.saveError}>{nameError}</span>}
            <div className={styles.saveActions}>
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={createMutation.isPending}>
                {createMutation.isPending ? <Spinner size={12} /> : 'Save'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setSaving(false); setNameError('') }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className={styles.saveCurrentBtn} onClick={() => setSaving(true)}>
            <BookmarkCheck size={13} />
            Save current search
          </button>
        )
      )}

      <div className={styles.savedList}>
        {isLoading && <span className={styles.savedEmpty}><Spinner size={13} /></span>}
        {!isLoading && savedSearches.length === 0 && (
          <span className={styles.savedEmpty}>No saved searches yet</span>
        )}
        {savedSearches.map((s: any) => (
          <div key={s.id} className={styles.savedItem}>
            <button
              className={styles.savedItemBtn}
              onClick={() => onLoad(s.params)}
              title={summariseParams(s.params)}
            >
              <span className={styles.savedItemName}>{s.name}</span>
              <span className={styles.savedItemSummary}>{summariseParams(s.params)}</span>
            </button>
            <button
              className={styles.savedItemDelete}
              onClick={() => { if (confirm(`Delete "${s.name}"?`)) deleteMutation.mutate(s.id) }}
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Pagination ───────────────────────────────────────────────────────

function Pagination({ page, pages, total, perPage, onPage }: {
  page: number; pages: number; total: number; perPage: number; onPage: (p: number) => void
}) {
  if (pages <= 1) return null
  const from = (page - 1) * perPage + 1
  const to = Math.min(page * perPage, total)
  return (
    <div className={styles.pagination}>
      <span className={styles.paginationInfo}>{from}–{to} of {total}</span>
      <div className={styles.paginationBtns}>
        <button className="btn btn-ghost btn-sm btn-icon" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></button>
        {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
          const p = pages <= 7 ? i + 1 : page <= 4 ? i + 1 : page >= pages - 3 ? pages - 6 + i : page - 3 + i
          return <button key={p} className={`${styles.paginationBtn} ${p === page ? styles.paginationBtnActive : ''}`} onClick={() => onPage(p)}>{p}</button>
        })}
        <button className="btn btn-ghost btn-sm btn-icon" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [inputValue, setInputValue] = useState(searchParams.get('q') ?? '')
  const [showFilters, setShowFilters] = useState(false)

  const q = searchParams.get('q') ?? ''
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = 25

  useEffect(() => { setInputValue(searchParams.get('q') ?? '') }, [searchParams])

  const { data: hierarchyTypes } = useQuery({
    queryKey: ['hierarchy-types-search'],
    queryFn: () => hierarchyApi.listTypes().then((r: any) => r.data.data as any[]),
  })

  const { data: allLevels } = useQuery({
    queryKey: ['all-levels', hierarchyTypes?.map((h: any) => h.id)],
    queryFn: async () => {
      if (!hierarchyTypes?.length) return []
      const results = await Promise.all(
        hierarchyTypes.map((ht: any) => hierarchyApi.listLevels(ht.id).then((r: any) => r.data.data as any[]))
      )
      return [...new Set(results.flat().map((l: any) => l.name))] as string[]
    },
    enabled: !!hierarchyTypes?.length,
  })

  const { data, isFetching } = useQuery({
    queryKey: ['full-search', Object.fromEntries(searchParams)],
    queryFn: () => {
      const params: any = { q, per_page: perPage, page }
      for (const [k, v] of searchParams.entries()) {
        if (k !== 'q' && k !== 'page') params[k] = v
      }
      return searchApi.search(params).then(r => r.data.data)
    },
    enabled: q.length >= 2,
    staleTime: 10_000,
  })

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(searchParams)
    next.set(k, v); next.set('page', '1'); setSearchParams(next)
  }
  const clearParam = (k: string) => {
    const next = new URLSearchParams(searchParams)
    next.delete(k); next.set('page', '1'); setSearchParams(next)
  }
  const handleSearch = () => {
    const next = new URLSearchParams(searchParams)
    next.set('q', inputValue.trim()); next.set('page', '1'); setSearchParams(next)
  }
  const handleResultClick = (item: any) => {
    if (item.type === 'node') navigate('/app/resources', { state: { selectNodeId: item.id } })
    else navigate('/app/agents', { state: { selectAgentId: item.id } })
  }

  const handleLoadSaved = (params: Record<string, string>) => {
    const next = new URLSearchParams(params)
    next.set('page', '1')
    setSearchParams(next)
    if (params.q) setInputValue(params.q)
    if (['status', 'level', 'date_from', 'date_to', 'agent_type'].some(k => params[k])) {
      setShowFilters(true)
    }
  }

  const hasFilters = ['status', 'level', 'date_from', 'date_to', 'agent_type'].some(k => searchParams.has(k))
  const results: any[] = data?.results ?? []
  const total: number = data?.total ?? 0
  const pages: number = data?.pages ?? 0

  return (
    <div className={styles.page}>
      <div className={styles.searchBar}>
        <div className={styles.searchForm}>
          <Search size={18} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Search resources and agents…"
            autoFocus
          />
          {isFetching && <Spinner size={14} />}
        </div>
        <button type="button" onClick={handleSearch} className="btn btn-primary">Search</button>
        <button
          className={`btn btn-secondary ${hasFilters ? styles.filterBtnActive : ''}`}
          onClick={() => setShowFilters(v => !v)}
        >
          <SlidersHorizontal size={14} />
          Filters
          {hasFilters && (
            <span className={styles.filterCount}>
              {['status', 'level', 'date_from', 'date_to', 'agent_type'].filter(k => searchParams.has(k)).length}
            </span>
          )}
        </button>
      </div>

      <div className={styles.body}>
        {/* ── Left sidebar: filters + saved searches ── */}
        <aside className={styles.sidebar}>
          {showFilters && (
            <div className={styles.filterPanel}>
              <FilterPanel params={searchParams} setParam={setParam} clearParam={clearParam} levels={allLevels ?? []} />
            </div>
          )}
          <SavedSearchesPanel onLoad={handleLoadSaved} />
        </aside>

        <div className={styles.results}>
          {q.length >= 2 && (
            <div className={styles.statsBar}>
              {isFetching ? (
                <span className={styles.searching}><Spinner size={13} /> Searching…</span>
              ) : data ? (
                <div className={styles.statsLeft}>
                  <span className={styles.totalCount}>
                    {total === 0 ? 'No results' : `${total.toLocaleString()} result${total !== 1 ? 's' : ''}`}
                    {' for '}<strong>"{q}"</strong>
                  </span>
                  {data.engine && <span className={styles.engineBadge}>{data.engine}</span>}
                  {data.node_total > 0 && <span className={styles.typeStat}>{data.node_total} resource{data.node_total !== 1 ? 's' : ''}</span>}
                  {data.agent_total > 0 && <span className={styles.typeStat}>{data.agent_total} agent{data.agent_total !== 1 ? 's' : ''}</span>}
                </div>
              ) : null}
            </div>
          )}

          {!q && (
            <div className={styles.emptyState}>
              <Search size={40} style={{ opacity: 0.15, marginBottom: 'var(--space-4)' }} />
              <p>Enter a search term above to get started</p>
              <p className={styles.emptyHint}>Searches across titles, descriptions, scope notes, and custom metadata fields</p>
            </div>
          )}

          {q.length === 1 && <div className={styles.emptyState}><p className={styles.emptyHint}>Type at least 2 characters…</p></div>}

          {q.length >= 2 && !isFetching && results.length === 0 && (
            <div className={styles.emptyState}>
              <p>No results for <strong>"{q}"</strong></p>
              <p className={styles.emptyHint}>Try different keywords or adjust your filters.</p>
            </div>
          )}

          {results.length > 0 && (
            <div className={styles.resultList}>
              {results.map((item: any) =>
                item.type === 'node'
                  ? <NodeRow key={`n${item.id}`} item={item} onClick={() => handleResultClick(item)} />
                  : <AgentRow key={`a${item.id}`} item={item} onClick={() => handleResultClick(item)} />
              )}
            </div>
          )}

          {pages > 1 && (
            <Pagination page={page} pages={pages} total={total} perPage={perPage}
              onPage={p => { const next = new URLSearchParams(searchParams); next.set('page', String(p)); setSearchParams(next) }} />
          )}
        </div>
      </div>
    </div>
  )
}