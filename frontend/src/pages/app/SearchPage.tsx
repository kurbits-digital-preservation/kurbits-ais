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
import SearchFacets from './SearchFacets'
import FileFilters from './FileFilters'
import FileResults from './FileResults'
import { useTranslation } from 'react-i18next'
// ─── Constants ────────────────────────────────────────────────────────

const AGENT_ICONS: Record<string, typeof User> = {
  person: User, organization: Building2, family: UsersRound, software: Bot,
}
const NODE_STATUSES = ['draft', 'published', 'restricted']
const AGENT_TYPES   = ['person', 'organization', 'family', 'software']
const FILTER_KEYS = ['status', 'level', 'date_from', 'date_to', 'agent_type', 'types', 'classification_id', 'hierarchy_type_id']

// ─── Helpers ──────────────────────────────────────────────────────────

function paramsToObject(params: URLSearchParams): Record<string, string> {
  const obj: Record<string, string> = {}
  for (const [k, v] of params.entries()) {
    if (k !== 'page') obj[k] = v
  }
  return obj
}

function summariseParams(params: Record<string, string>, t?: (key: string, opts?: any) => string): string {
  const parts: string[] = []
  if (params.q) parts.push(`"${params.q}"`)
  if (params.status) parts.push(t ? t(`resources.status.${params.status}`, { defaultValue: params.status }) : params.status)
  if (params.level) parts.push(params.level)
  if (params.date_from || params.date_to) parts.push(`${params.date_from ?? '…'}–${params.date_to ?? '…'}`)
  if (params.agent_type) parts.push(t ? t(`agents.types.${params.agent_type}`, { defaultValue: params.agent_type }) : params.agent_type)
  if (params.types && params.types !== 'nodes,agents') parts.push(params.types.replace(',', ' & '))
  return parts.join(', ')
}

// ─── Result rows ──────────────────────────────────────────────────────

function NodeRow({ item, onClick }: { item: any; onClick: () => void }) {
  const { t } = useTranslation()
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
            <span className={styles.statusBadge} data-status={item.status}>{t(`resources.status.${item.status}`, { defaultValue: item.status })}</span></>
          )}
        </div>
      </div>
      <span className={styles.resultType}>{t('search.resource')}</span>
    </button>
  )
}

function AgentRow({ item, onClick }: { item: any; onClick: () => void }) {
  const { t } = useTranslation()
  const Icon = AGENT_ICONS[item.agent_type] ?? User
  return (
    <button className={styles.resultRow} onClick={onClick}>
      <div className={styles.resultIconWrap}><Icon size={15} /></div>
      <div className={styles.resultBody}>
        <div className={styles.resultTitle}>{item.name ?? item.authorized_form}</div>
        <div className={styles.resultMeta}>
          <span className={styles.resultLevel}>{t(`agents.types.${item.agent_type}`, { defaultValue: item.agent_type })}</span>
          {item.date_from && (
            <><span className={styles.dot}>·</span>
            <span>{item.date_from}{item.date_to ? `–${item.date_to}` : ''}</span></>
          )}
        </div>
      </div>
      <span className={styles.resultType}>{t('search.agent')}</span>
    </button>
  )
}

// ─── Filter panel ─────────────────────────────────────────────────────

function FilterPanel({ params, setParam, clearParam }: {
  params: URLSearchParams
  setParam: (k: string, v: string) => void
  clearParam: (k: string) => void
}) {
  const { t } = useTranslation()
  const types = params.get('types') ?? 'nodes,agents'
  const showNodeFilters = types.includes('nodes')
  const hasDateFilter = params.has('date_from') || params.has('date_to')
  return (
    <div className={styles.filters}>
      {showNodeFilters && (
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>{t('search.dateRange')}</label>
          <div className={styles.dateRow}>
            <label className={styles.filterLabel} style={{ textTransform: 'none', fontWeight: 400 }}>{t('search.from')}</label>
            <input type="date" value={params.get('date_from') ?? ''}
              onChange={e => e.target.value ? setParam('date_from', e.target.value) : clearParam('date_from')} />
            <label className={styles.filterLabel} style={{ textTransform: 'none', fontWeight: 400 }}>{t('search.to')}</label>
            <input type="date" value={params.get('date_to') ?? ''}
              onChange={e => e.target.value ? setParam('date_to', e.target.value) : clearParam('date_to')} />
          </div>
        </div>
      )}
      {hasDateFilter && (
        <button className={styles.clearFilters}
          onClick={() => { clearParam('date_from'); clearParam('date_to') }}>
          <X size={12} /> {t('search.clearDates')}
        </button>
      )}
    </div>
  )
}


// ─── Saved searches panel ─────────────────────────────────────────────

function SavedSearchesPanel({ onLoad }: { onLoad: (params: Record<string, string>) => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [saving, setSaving]     = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [nameError, setNameError] = useState('')

  const { data: savedSearches = [], isLoading } = useQuery({
    queryKey: ['saved-searches'],
    queryFn: () => savedSearchesApi.list().then(r => r.data.data),
  })

  const [searchParams] = useSearchParams()
  const currentParams = paramsToObject(searchParams)
  const hasAnything   = Object.keys(currentParams).length > 0

  const createMutation = useMutation({
    mutationFn: ({ name, params }: { name: string; params: Record<string, string> }) =>
      savedSearchesApi.create(name, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-searches'] })
      setSaving(false); setNameInput(''); setNameError('')
    },
    onError: (err: any) => setNameError(err?.response?.data?.message ?? t('search.couldNotSave')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => savedSearchesApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-searches'] }),
  })

  const handleSave = () => {
    const name = nameInput.trim()
    if (!name) { setNameError(t('search.enterName')); return }
    setNameError('')
    createMutation.mutate({ name, params: currentParams })
  }

  return (
    <div className={styles.savedPanel}>
      <div className={styles.savedHeader}><Bookmark size={13} /> {t('search.savedSearches')}</div>

      {hasAnything && (
        saving ? (
          <div className={styles.saveForm}>
            <input
              className={styles.saveInput}
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setSaving(false) }}
              placeholder={t('search.namePlaceholder')}
              autoFocus
            />
            {nameError && <span className={styles.saveError}>{nameError}</span>}
            <div className={styles.saveActions}>
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={createMutation.isPending}>
                {createMutation.isPending ? <Spinner size={12} /> : t('common.save')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setSaving(false); setNameError('') }}>{t('common.cancel')}</button>
            </div>
          </div>
        ) : (
          <button className={styles.saveCurrentBtn} onClick={() => setSaving(true)}>
            <BookmarkCheck size={13} /> {t('search.saveCurrentSearch')}
          </button>
        )
      )}

      <div className={styles.savedList}>
        {isLoading && <span className={styles.savedEmpty}><Spinner size={13} /></span>}
        {!isLoading && savedSearches.length === 0 && (
          <span className={styles.savedEmpty}>{t('search.noSavedYet')}</span>
        )}
        {savedSearches.map((s: any) => (
          <div key={s.id} className={styles.savedItem}>
            <button className={styles.savedItemBtn} onClick={() => onLoad(s.params)} title={summariseParams(s.params, t)}>
              <span className={styles.savedItemName}>{s.name}</span>
              <span className={styles.savedItemSummary}>{summariseParams(s.params, t)}</span>
            </button>
            <button
              className={styles.savedItemDelete}
              onClick={() => { if (confirm(t('search.deleteConfirm', { name: s.name }))) deleteMutation.mutate(s.id) }}
              title={t('common.delete')}
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
  const { t } = useTranslation()
  if (pages <= 1) return null
  const from = (page - 1) * perPage + 1
  const to   = Math.min(page * perPage, total)
  return (
    <div className={styles.pagination}>
      <span className={styles.paginationInfo}>{t('search.paginationInfo', { from, to, total })}</span>
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
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate    = useNavigate()
  const [inputValue, setInputValue] = useState(searchParams.get('q') ?? '')
  const [showFilters, setShowFilters] = useState(false)

  const q       = searchParams.get('q') ?? ''
  const page    = parseInt(searchParams.get('page') ?? '1')
  const perPage = 25

  useEffect(() => { setInputValue(searchParams.get('q') ?? '') }, [searchParams])

  // ── Hierarchy levels for filter panel ─────────────────────────────
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

  // ── Search ────────────────────────────────────────────────────────
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

  // ── Handlers ───────────────────────────────────────────────────────
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
    if (['status', 'level', 'date_from', 'date_to', 'agent_type'].some(k => params[k])) setShowFilters(true)
  }

  const hasFilters = FILTER_KEYS.some(k => searchParams.has(k))
  const results: any[]  = data?.results ?? []
  const total: number   = data?.total ?? 0
  const pages: number   = data?.pages ?? 0

  return (
    <div className={styles.page}>

      {/* ── Search bar ── */}
      <div className={styles.searchBar}>
        <div className={styles.searchForm}>
          <Search size={18} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder={t('search.searchPlaceholder')}
            autoFocus
          />
          {isFetching && <Spinner size={14} />}
        </div>
        <button type="button" onClick={handleSearch} className="btn btn-primary">{t('search.searchButton')}</button>
        <button
          className={`btn btn-secondary ${hasFilters ? styles.filterBtnActive : ''}`}
          onClick={() => setShowFilters(v => !v)}
        >
          <SlidersHorizontal size={14} />
          {t('search.filters')}
          {hasFilters && (
            <span className={styles.filterCount}>
              {FILTER_KEYS.filter(k => searchParams.has(k)).length}
            </span>
          )}
        </button>
      </div>

      <div className={styles.body}>

        {/* ── Sidebar: filters + saved searches ── */}
        <aside className={styles.sidebar}>
          {showFilters && (
            <div className={styles.filterPanel}>
              <FilterPanel params={searchParams} setParam={setParam} clearParam={clearParam} />
            </div>
          )}
          <SearchFacets
            facets={data?.facets}
            params={searchParams}
            setParam={setParam}
            clearParam={clearParam}
          />
          {searchParams.get('types') === 'files' && (
            <FileFilters params={searchParams} setParam={setParam} clearParam={clearParam} />
          )}
          <SavedSearchesPanel onLoad={handleLoadSaved} />

        </aside>

        {/* ── Search results ── */}
        <div className={styles.results}>
          {q.length >= 2 && (
            <div className={styles.statsBar}>
              {isFetching ? (
                <span className={styles.searching}><Spinner size={13} /> {t('search.searching')}</span>
              ) : data ? (
                <div className={styles.statsLeft}>
                  <span className={styles.totalCount}>
                    {total === 0 ? t('search.noResults') : t('search.resultsCount', { count: total })}
                    {' '}{t('search.for')} <strong>"{q}"</strong>
                  </span>
                  {data.engine && <span className={styles.engineBadge}>{data.engine}</span>}
                  {data.node_total > 0 && <span className={styles.typeStat}>{t('search.resourcesCount', { count: data.node_total })}</span>}
                  {data.agent_total > 0 && <span className={styles.typeStat}>{t('search.agentsCount', { count: data.agent_total })}</span>}
                  {data.file_total > 0 && <span className={styles.typeStat}>{t('search.filesMatchCount', { count: data.file_total })}</span>}
                </div>
              ) : null}
            </div>
          )}

          {/* Files-also-match hint (textual modes only) */}
          {searchParams.get('types') !== 'files' && (data?.file_match_hint ?? 0) > 0 && (
            <button
              className={styles.filesHint}
              onClick={() => setParam('types', 'files')}
            >
              {t('search.fileHintRecords', { count: data.file_match_hint })}
            </button>
          )}

          {!q && (
            <div className={styles.emptyState}>
              <Search size={40} style={{ opacity: 0.15, marginBottom: 'var(--space-4)' }} />
              <p>{t('search.startPrompt')}</p>
              <p className={styles.emptyHint}>{t('search.startHint')}</p>
            </div>
          )}

          {q.length === 1 && <div className={styles.emptyState}><p className={styles.emptyHint}>{t('search.typeMoreChars')}</p></div>}

          {q.length >= 2 && !isFetching && results.length === 0 && (data?.files?.length ?? 0) === 0 && (
            <div className={styles.emptyState}>
              <p>{t('search.noResultsForPrefix')} <strong>"{q}"</strong></p>
              <p className={styles.emptyHint}>{t('search.tryDifferentKeywords')}</p>
            </div>
          )}

          {searchParams.get('types') === 'files' ? (
            (data?.files?.length ?? 0) > 0 && (
              <div className={styles.resultList}>
                <FileResults groups={data.files} />
              </div>
            )
          ) : (
            results.length > 0 && (
              <div className={styles.resultList}>
                {results.map((item: any) =>
                  item.type === 'node'
                    ? <NodeRow  key={`n${item.id}`} item={item} onClick={() => handleResultClick(item)} />
                    : <AgentRow key={`a${item.id}`} item={item} onClick={() => handleResultClick(item)} />
                )}
              </div>
            )
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
