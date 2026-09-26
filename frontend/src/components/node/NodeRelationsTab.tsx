import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Plus, X, User, Building2, UsersRound, Bot,
  MapPin, Tag, Link, Search, ChevronDown,
  ArrowUpFromLine, ArrowDownToLine
} from 'lucide-react'
import { nodeRelationsApi, agentsApi, locationsApi, classificationsApi, nodesApi } from '@/api'
import { Spinner, TypePill } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import styles from './NodeRelationsTab.module.css'

// ─── Shared search-and-pick popover ──────────────────────────────────

interface PickerProps {
  onClose: () => void
  onPick: (id: number, extra?: string) => void
  title: string
  searchResults: any[]
  isLoading: boolean
  search: string
  onSearch: (v: string) => void
  renderItem: (item: any) => React.ReactNode
  extra?: React.ReactNode   // optional extra field (e.g. relation type)
  extraValue?: string
  onExtraChange?: (v: string) => void
  extraOptions?: string[]
  extraOptionLabel?: (value: string) => string
  extraLabel?: string
  isPicking?: boolean
  extraAction?: React.ReactNode  // e.g. back button
  confirmLabel?: string  // overrides the confirm button text, default 'Add'
}

function Picker({
  onClose, onPick, title,
  searchResults, isLoading, search, onSearch,
  renderItem, extra, extraValue, onExtraChange,
  extraOptions, extraOptionLabel, extraLabel, isPicking, extraAction,
  confirmLabel,
}: PickerProps) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState<number | null>(null)

  return (
    <div className={styles.picker}>
      <div className={styles.pickerHeader}>
        <span className={styles.pickerTitle}>{title}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
          {extraAction}
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><X size={13} /></button>
        </div>
      </div>

      {extraOptions && (
        <div className={styles.pickerExtra}>
          <label>{extraLabel}</label>
          <select value={extraValue} onChange={e => onExtraChange?.(e.target.value)}>
            <option value="">{t('relations.picker.selectPlaceholder')}</option>
            {extraOptions.map(o => <option key={o} value={o}>{extraOptionLabel ? extraOptionLabel(o) : o}</option>)}
          </select>
        </div>
      )}

      <div className={styles.pickerSearch}>
        <Search size={13} className={styles.pickerSearchIcon} />
        <input
          autoFocus
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder={t('relations.picker.searchPlaceholder')}
          className={styles.pickerSearchInput}
        />
      </div>

      <div className={styles.pickerResults}>
        {isLoading && <div className={styles.pickerLoading}><Spinner size={16} /></div>}
        {!isLoading && searchResults.length === 0 && search.length > 0 && (
          <p className={styles.pickerEmpty}>{t('relations.picker.noResults')}</p>
        )}
        {!isLoading && search.length === 0 && searchResults.length === 0 && (
          <p className={styles.pickerEmpty}>{t('relations.picker.typeToSearch')}</p>
        )}
        {searchResults.map(item => (
          <button
            key={item.id}
            className={`${styles.pickerItem} ${selectedId === item.id ? styles.pickerItemSelected : ''}`}
            onClick={() => setSelectedId(item.id)}
          >
            {renderItem(item)}
          </button>
        ))}
      </div>

      <div className={styles.pickerFooter}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>{t('common.cancel')}</button>
        <button
          className="btn btn-primary btn-sm"
          disabled={!selectedId || isPicking || (extraOptions ? !extraValue : false)}
          onClick={() => selectedId && onPick(selectedId, extraValue)}
        >
          {isPicking ? <Spinner size={13} /> : (confirmLabel ?? t('common.add'))}
        </button>
      </div>
    </div>
  )
}

// ─── Agent type icon ─────────────────────────────────────────────────

const AGENT_ICONS: Record<string, typeof User> = {
  person: User,
  organization: Building2,
  family: UsersRound,
  software: Bot,
}

// ─── Section components ───────────────────────────────────────────────

function AgentsSection({ nodeId }: { nodeId: number }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const [relationType, setRelationType] = useState('')

  const { data: linked, isLoading } = useQuery({
    queryKey: ['node-agents', nodeId],
    queryFn: () => nodeRelationsApi.getAgents(nodeId).then(r => r.data.data),
  })

  const { data: relTypes } = useQuery({
    queryKey: ['agent-node-relation-types'],
    queryFn: () => agentsApi.getNodeRelationTypes().then(r => r.data.data as any[]),
  })

  const { data: searchResults, isLoading: searching } = useQuery({
    queryKey: ['agents-search', search],
    queryFn: () => agentsApi.list({ q: search, per_page: 8 }).then(r => r.data.data),
    enabled: search.length > 1,
  })

  const addMutation = useMutation({
    mutationFn: ({ agentId, type }: { agentId: number; type: string }) =>
      nodeRelationsApi.addAgent(nodeId, agentId, type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node-agents', nodeId] })
      setAdding(false)
      setSearch('')
      setRelationType('')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (agentId: number) => nodeRelationsApi.removeAgent(nodeId, agentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['node-agents', nodeId] }),
  })

  if (isLoading) return <div className={styles.sectionLoading}><Spinner size={16} /></div>

  const relationTypeOptions = relTypes?.map((rt: any) => rt.name) ?? ['creator', 'contributor', 'publisher', 'subject']

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionLabel}><User size={13} /> {t('relations.agents.title')}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setAdding(v => !v)}>
          <Plus size={13} /> {t('common.add')}
        </button>
      </div>

      {adding && (
        <Picker
          title={t('relations.agents.linkAgent')}
          onClose={() => { setAdding(false); setSearch(''); setRelationType('') }}
          onPick={(id, type) => addMutation.mutate({ agentId: id, type: type! })}
          search={search}
          onSearch={setSearch}
          searchResults={searchResults ?? []}
          isLoading={searching}
          extraLabel={t('relations.agents.relationType')}
          extraOptions={relationTypeOptions}
          extraValue={relationType}
          onExtraChange={setRelationType}
          isPicking={addMutation.isPending}
          renderItem={(agent) => {
            const Icon = AGENT_ICONS[agent.agent_type] ?? User
            return (
              <div className={styles.agentPickItem}>
                <Icon size={13} className={styles.agentPickIcon} />
                <span className={styles.agentPickName}>{agent.name}</span>
                <TypePill type={agent.agent_type} />
              </div>
            )
          }}
        />
      )}

      {linked?.length === 0 && !adding && (
        <p className={styles.empty}>{t('relations.agents.noneYet')}</p>
      )}

      {linked?.map((agent: any) => {
        const Icon = AGENT_ICONS[agent.agent_type] ?? User
        return (
          <div key={agent.id} className={styles.linkedItem}>
            <button
              className={styles.linkedItemBtn}
              onClick={() => navigate('/app/agents', { state: { selectAgentId: agent.id } })}
              title={t('relations.agents.openInAgents')}
            >
              <div className={styles.linkedItemIcon}>
                <Icon size={14} />
              </div>
              <div className={styles.linkedItemBody}>
                <span className={styles.linkedItemName}>{agent.name}</span>
                <span className={styles.linkedItemMeta}>{agent.relation_type}</span>
              </div>
            </button>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => removeMutation.mutate(agent.id)}
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function LocationsSection({ nodeId }: { nodeId: number }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [checkingIn, setCheckingIn] = useState(false)
  const [search, setSearch] = useState('')
  const [notes, setNotes] = useState('')
  const [selectedLoc, setSelectedLoc] = useState<any>(null)

  const { data: linked, isLoading } = useQuery({
    queryKey: ['node-locations', nodeId],
    queryFn: () => nodeRelationsApi.getLocations(nodeId).then(r => r.data.data),
  })

  const { data: searchResults, isLoading: searching } = useQuery({
    queryKey: ['locations-search', search],
    queryFn: () => locationsApi.search(search, true).then(r => r.data.data),
    enabled: search.length > 1,
    staleTime: 0,
  })

  const [checkingOut, setCheckingOut] = useState(false)
  const [checkoutCategoryId, setCheckoutCategoryId] = useState<string>('')

  const { data: checkoutCats } = useQuery({
    queryKey: ['checkout-categories'],
    queryFn: () => locationsApi.getCheckoutCategories().then(r => r.data.data),
    enabled: checkingOut,
  })

  // Use check-in which enforces single location
  const checkInMutation = useMutation({
    mutationFn: () => locationsApi.checkIn(selectedLoc.id, nodeId, notes || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node-locations', nodeId] })
      queryClient.invalidateQueries({ queryKey: ['node', nodeId] })
      queryClient.invalidateQueries({ queryKey: ['location-overview'] })
      setCheckingIn(false); setSearch(''); setNotes(''); setSelectedLoc(null)
    },
  })

  const checkOutMutation = useMutation({
    mutationFn: (locationId: number) =>
      locationsApi.checkOut(locationId, nodeId, undefined,
        checkoutCategoryId ? parseInt(checkoutCategoryId) : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node-locations', nodeId] })
      queryClient.invalidateQueries({ queryKey: ['node', nodeId] })
      queryClient.invalidateQueries({ queryKey: ['location-overview'] })
      setCheckingOut(false)
      setCheckoutCategoryId('')
    },
  })

  const returnMutation = useMutation({
    mutationFn: () => locationsApi.returnToPrevious(nodeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node-locations', nodeId] })
      queryClient.invalidateQueries({ queryKey: ['node', nodeId] })
      queryClient.invalidateQueries({ queryKey: ['location-overview'] })
    },
    onError: (err: any) => {
      alert(err?.response?.data?.message ?? t('relations.locations.returnFailed'))
    },
  })

  if (isLoading) return <div className={styles.sectionLoading}><Spinner size={16} /></div>

  const current = linked?.[0]  // only ever one
  const isCheckedOut = current &&
    ((current as any).is_checkout ?? (current as any).code === '__checked_out__')

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionLabel}><MapPin size={13} /> {t('relations.locations.title')}</span>
        {!checkingIn && !checkingOut && (
          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
            {current && !isCheckedOut && (
              <button className="btn btn-ghost btn-sm" onClick={() => setCheckingOut(true)}>
                <ArrowUpFromLine size={13} /> {t('relations.locations.checkOut')}
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setCheckingIn(true)}>
              <Plus size={13} /> {current ? t('relations.locations.move') : t('relations.locations.checkIn')}
            </button>
          </div>
        )}
      </div>

      {/* Current location */}
      {!current && !checkingIn && (
        <p className={styles.emptyState}>{t('relations.locations.notCheckedIn')}</p>
      )}
      {current && (
        <div className={`${styles.locationItem} ${isCheckedOut ? styles.locationItemCheckedOut : ''}`}>
          <span className={styles.locationItemIcon}>
            {isCheckedOut ? <ArrowUpFromLine size={13} /> : <MapPin size={13} />}
          </span>
          <div className={styles.locationItemInfo}>
            {isCheckedOut ? (
              <span className={styles.locationItemName}>
                {current.name}
              </span>
            ) : (
              <button
                className={styles.locationItemLink}
                onClick={() => navigate('/app/locations', { state: { selectLocationId: current.id } })}
                title={t('relations.locations.openThisLocation')}
              >
                {(current as any).full_path ?? current.name}
              </button>
            )}
            {isCheckedOut && (
              <span className={styles.checkedOutBadge}>{t('relations.locations.checkedOutBadge')}</span>
            )}
          </div>
          {isCheckedOut && (
            <button className="btn btn-secondary btn-sm"
              title={t('relations.locations.returnHint')}
              disabled={returnMutation.isPending}
              onClick={() => returnMutation.mutate()}>
              {returnMutation.isPending ? <Spinner size={13} /> : <><ArrowDownToLine size={13} /> {t('relations.locations.returnButton')}</>}
            </button>
          )}
        </div>
      )}

      {/* Check-out reason chooser */}
      {checkingOut && current && !isCheckedOut && (
        <div className={styles.movePanel}>
          <div className={styles.movePanelHeader}>
            <span><ArrowUpFromLine size={12} /> {t('relations.locations.checkOutReasonHeader')}</span>
            <button className="btn btn-ghost btn-sm btn-icon"
              onClick={() => { setCheckingOut(false); setCheckoutCategoryId('') }}>
              <X size={12} />
            </button>
          </div>
          <div className={styles.checkoutPanelBody}>
            <select
              value={checkoutCategoryId}
              onChange={e => setCheckoutCategoryId(e.target.value)}
              className={styles.checkoutSelect}
            >
              <option value="">{t('relations.locations.uncategorised')}</option>
              {(checkoutCats as any)?.categories?.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div className={styles.checkoutPanelActions}>
              <button className="btn btn-ghost btn-sm"
                onClick={() => { setCheckingOut(false); setCheckoutCategoryId('') }}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary btn-sm"
                disabled={checkOutMutation.isPending}
                onClick={() => checkOutMutation.mutate(current.id)}>
                {checkOutMutation.isPending ? <Spinner size={13} /> : <><ArrowUpFromLine size={13} /> {t('relations.locations.checkOut')}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Check-in / move picker */}
      {checkingIn && (
        <div className={styles.movePanel}>
          <div className={styles.movePanelHeader}>
            <span>{current ? t('relations.locations.moveToNewLocation') : t('relations.locations.checkInToLocation')}</span>
            <button className="btn btn-ghost btn-sm btn-icon"
              onClick={() => { setCheckingIn(false); setSearch(''); setSelectedLoc(null) }}>
              <X size={12} />
            </button>
          </div>
          <div style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <input value={search} onChange={e => { setSearch(e.target.value); setSelectedLoc(null) }}
              placeholder={t('relations.locations.searchStorablePlaceholder')} autoFocus />
            {selectedLoc && (
              <div style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--color-accent-bg)',
                border: '1px solid var(--color-accent-border)', borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <MapPin size={12} style={{ color: 'var(--color-accent)' }} />
                <span style={{ fontWeight: 500 }}>{(selectedLoc as any).full_path ?? selectedLoc.name}</span>
                <button className="btn btn-ghost btn-sm btn-icon" style={{ marginLeft: 'auto' }}
                  onClick={() => setSelectedLoc(null)}><X size={11} /></button>
              </div>
            )}
            {search.length > 1 && !selectedLoc && (
              <div className={styles.searchResultsList}>
                {searching && <Spinner size={13} />}
                {(searchResults as any[])?.map((loc: any) => (
                  <button key={loc.id} className={styles.locationPickItem}
                    style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none',
                      cursor: 'pointer', padding: 'var(--space-2) var(--space-3)',
                      borderBottom: '1px solid var(--color-border)', fontFamily: 'var(--font-sans)' }}
                    onClick={() => { setSelectedLoc(loc); setSearch(loc.name) }}>
                    <span className={styles.locationPickName}>{loc.name}</span>
                    <span className={styles.locationPickPath}>{loc.full_path}</span>
                  </button>
                ))}
              </div>
            )}
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder={t('relations.locations.notesPlaceholder')} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <button className="btn btn-ghost btn-sm"
                onClick={() => { setCheckingIn(false); setSearch(''); setSelectedLoc(null) }}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary btn-sm"
                disabled={!selectedLoc || checkInMutation.isPending}
                onClick={() => checkInMutation.mutate()}>
                {checkInMutation.isPending ? <Spinner size={13} /> : null}
                {current ? t('relations.locations.move') : t('relations.locations.checkIn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ClassificationsSection({ nodeId }: { nodeId: number }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [selectedScheme, setSelectedScheme] = useState<any>(null)
  const [search, setSearch] = useState('')

  const { data: linked, isLoading } = useQuery({
    queryKey: ['node-classifications', nodeId],
    queryFn: () => nodeRelationsApi.getClassifications(nodeId).then(r => r.data.data),
  })

  const { data: schemes } = useQuery({
    queryKey: ['classification-schemes'],
    queryFn: () => classificationsApi.listSchemes(true).then(r => r.data.data),
    enabled: adding,
  })

  const { data: classResults, isLoading: classSearching } = useQuery({
    queryKey: ['classifications-search', search, selectedScheme?.id],
    queryFn: () => classificationsApi.search(search, selectedScheme?.id, true).then(r => r.data.data),
    enabled: adding && !!selectedScheme,
    staleTime: 0,
  })

  const addMutation = useMutation({
    mutationFn: (classificationId: number) =>
      nodeRelationsApi.addClassification(nodeId, classificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node-classifications', nodeId] })
      setAdding(false)
      setSearch('')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (classificationId: number) =>
      nodeRelationsApi.removeClassification(nodeId, classificationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['node-classifications', nodeId] }),
  })

  if (isLoading) return <div className={styles.sectionLoading}><Spinner size={16} /></div>



  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionLabel}><Tag size={13} /> {t('relations.classifications.title')}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setAdding(v => !v)}>
          <Plus size={13} /> {t('common.add')}
        </button>
      </div>

      {adding && (
        <div className={styles.classPickerPanel}>
          <div className={styles.classPickerHeader}>
            <span className={styles.pickerTitle}>{t('relations.classifications.assignClassification')}</span>
            <button className="btn btn-ghost btn-sm btn-icon"
              onClick={() => { setAdding(false); setSearch(''); setSelectedScheme(null) }}>
              <X size={13} />
            </button>
          </div>

          {/* Step 1: Pick scheme */}
          {!selectedScheme ? (
            <div>
              <p className={styles.classPickerHint}>{t('relations.classifications.selectSchemeHint')}</p>
              {!schemes ? (
                <div className={styles.pickerLoading}><Spinner size={16} /></div>
              ) : schemes.length === 0 ? (
                <p className={styles.pickerEmpty}>{t('relations.classifications.noSchemesFound')}</p>
              ) : schemes.map((s: any) => (
                <button key={s.id} className={styles.schemeRow} onClick={() => setSelectedScheme(s)}>
                  <div className={styles.schemeName}>{s.name}</div>
                  <div className={styles.schemeMeta}>{s.code} · {s.level_name}</div>
                </button>
              ))}
            </div>
          ) : (
            /* Step 2: Search within scheme */
            <div>
              <button className={styles.schemeBack}
                onClick={() => { setSelectedScheme(null); setSearch('') }}>
                ← {selectedScheme.name}
              </button>
              <Picker
                title={t('relations.classifications.searchInScheme', { scheme: selectedScheme.name })}
                onClose={() => { setAdding(false); setSearch(''); setSelectedScheme(null) }}
                onPick={(id) => addMutation.mutate(id)}
                search={search}
                onSearch={setSearch}
                searchResults={(classResults ?? []).filter((r: any) => r.id !== selectedScheme.id)}
                isLoading={classSearching}
                isPicking={addMutation.isPending}
                renderItem={(c) => (
                  <div className={styles.classPickItem}>
                    <span className={styles.classPickCode}>{c.full_code}</span>
                    <span className={styles.classPickName}>{c.name}</span>
                  </div>
                )}
              />
            </div>
          )}
        </div>
      )}

      {linked?.length === 0 && !adding && (
        <p className={styles.empty}>{t('relations.classifications.noneAssigned')}</p>
      )}

      {linked?.map((c: any) => (
        <div key={c.id} className={styles.linkedItem}>
          <button
            className={styles.linkedItemBtn}
            onClick={() => navigate('/app/classifications', { state: { selectClassificationId: c.id } })}
            title={t('relations.classifications.openInClassifications')}
          >
            <div className={styles.linkedItemIcon}>
              <Tag size={14} />
            </div>
            <div className={styles.linkedItemBody}>
              <span className={styles.linkedItemCode}>{c.full_code}</span>
              <span className={styles.linkedItemName}>{c.name}</span>
            </div>
          </button>
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => removeMutation.mutate(c.id)}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

function NodeLinksSection({ nodeId }: { nodeId: number }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const [relationType, setRelationType] = useState('')

  // ── Tree scoping ──────────────────────────────────────────────────
  // Default: search only within the current node's own tree (its root).
  // 'all' clears scoping entirely. 'other' lets the user pick a different
  // root to search under — for the rarer cross-tree link.
  type ScopeMode = 'own' | 'all' | 'other'
  const [scopeMode, setScopeMode] = useState<ScopeMode>('own')
  const [otherRoot, setOtherRoot] = useState<{ id: number; title: string } | null>(null)
  const [pickingRoot, setPickingRoot] = useState(false)
  const [rootSearch, setRootSearch] = useState('')

  // Reuses the ['node', nodeId] cache the page already populates — no extra
  // request in practice, React Query dedupes by key.
  const { data: currentNode } = useQuery({
    queryKey: ['node', nodeId],
    queryFn: () => nodesApi.get(nodeId).then((r: any) => r.data.data),
  })
  const ownRoot = currentNode?.breadcrumb?.[0]
    ? { id: currentNode.breadcrumb[0].id, title: currentNode.breadcrumb[0].title }
    : null

  const activeRoot = scopeMode === 'own' ? ownRoot : scopeMode === 'other' ? otherRoot : null

  const { data: relations, isLoading } = useQuery({
    queryKey: ['node-relations', nodeId],
    queryFn: () => nodeRelationsApi.getRelations(nodeId).then(r => r.data.data as any[]),
  })

  const { data: searchResults, isLoading: searching } = useQuery({
    queryKey: ['nodes-search-link', search, activeRoot?.id],
    queryFn: () => nodesApi.list({
      q: search, per_page: 8,
      ...(activeRoot ? { root_id: activeRoot.id } : {}),
    } as any).then(r => r.data.data as any[]),
    enabled: search.length > 1,
  })

  const { data: rootResults, isLoading: searchingRoots } = useQuery({
    queryKey: ['nodes-search-roots', rootSearch],
    queryFn: () => nodesApi.list({ q: rootSearch, per_page: 8, roots_only: 'true' } as any)
      .then(r => r.data.data as any[]),
    enabled: pickingRoot && rootSearch.length > 1,
  })

  const addMutation = useMutation({
    mutationFn: ({ targetId, type }: { targetId: number; type: string }) =>
      nodeRelationsApi.addRelation(nodeId, targetId, type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node-relations', nodeId] })
      setAdding(false)
      setSearch('')
      setRelationType('')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (targetId: number) => nodeRelationsApi.removeRelation(nodeId, targetId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['node-relations', nodeId] }),
  })

  if (isLoading) return <div className={styles.sectionLoading}><Spinner size={16} /></div>

  const RELATION_TYPES = ['related to', 'precedes', 'follows', 'is part of', 'has part', 'see also']
  const RELATION_TYPE_KEY_MAP: Record<string, string> = {
    'related to': 'relatedTo', 'precedes': 'precedes', 'follows': 'follows',
    'is part of': 'isPartOf', 'has part': 'hasPart', 'see also': 'seeAlso',
  }

  const scopeLabel =
    scopeMode === 'own' ? (ownRoot ? t('relations.related.inThisTreeNamed', { title: ownRoot.title }) : t('relations.related.inThisTree'))
    : scopeMode === 'other' ? (otherRoot ? t('relations.related.inTree', { title: otherRoot.title }) : t('relations.related.pickATree'))
    : t('relations.related.allResources')

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionLabel}><Link size={13} /> {t('relations.related.title')}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setAdding(v => !v)}>
          <Plus size={13} /> {t('common.add')}
        </button>
      </div>

      {adding && !pickingRoot && (
        <div className={styles.pickerWithScope}>
          <div className={styles.scopeBar}>
            <span className={styles.scopeLabel} title={activeRoot ? undefined : t('relations.related.searchingAllTrees')}>
              {scopeLabel}
            </span>
            <div className={styles.scopeActions}>
              {scopeMode !== 'own' && ownRoot && (
                <button className={styles.scopeAction} onClick={() => { setScopeMode('own'); setSearch('') }}>
                  {t('relations.related.thisTreeButton')}
                </button>
              )}
              {scopeMode !== 'all' && (
                <button className={styles.scopeAction} onClick={() => { setScopeMode('all'); setSearch('') }}>
                  {t('relations.related.searchAllButton')}
                </button>
              )}
              <button className={styles.scopeAction} onClick={() => { setPickingRoot(true); setRootSearch('') }}>
                {t('relations.related.chooseTree')}
              </button>
            </div>
          </div>
          <Picker
            title={t('relations.related.linkResource')}
            onClose={() => { setAdding(false); setSearch(''); setRelationType(''); setScopeMode('own'); setOtherRoot(null) }}
            onPick={(id, type) => addMutation.mutate({ targetId: id, type: type! })}
            search={search}
            onSearch={setSearch}
            searchResults={(searchResults ?? []).filter((n: any) => n.id !== nodeId)}
            isLoading={searching}
            extraLabel={t('relations.related.relationship')}
            extraOptions={RELATION_TYPES}
            extraOptionLabel={(v) => t(`relations.related.types.${RELATION_TYPE_KEY_MAP[v]}`)}
            extraValue={relationType}
            onExtraChange={setRelationType}
            isPicking={addMutation.isPending}
            renderItem={(node) => (
              <div className={styles.nodePickItem}>
                <span className={styles.nodePickTitle}>{node.title}</span>
                <span className={styles.nodePickRef}>{node.ref_code}</span>
              </div>
            )}
          />
        </div>
      )}

      {adding && pickingRoot && (
        <Picker
          title={t('relations.related.searchWithinTree')}
          confirmLabel={t('relations.related.useThisTree')}
          onClose={() => setPickingRoot(false)}
          onPick={(id) => {
            const picked = (rootResults ?? []).find((r: any) => r.id === id)
            if (picked) {
              setOtherRoot({ id: picked.id, title: picked.title })
              setScopeMode('other')
            }
            setPickingRoot(false)
            setRootSearch('')
            setSearch('')
          }}
          search={rootSearch}
          onSearch={setRootSearch}
          searchResults={rootResults ?? []}
          isLoading={searchingRoots}
          renderItem={(node) => (
            <div className={styles.nodePickItem}>
              <span className={styles.nodePickTitle}>{node.title}</span>
              <span className={styles.nodePickRef}>{node.ref_code}</span>
            </div>
          )}
        />
      )}

      {relations?.length === 0 && !adding && (
        <p className={styles.empty}>{t('relations.related.noneYet')}</p>
      )}

      {relations?.map((rel: any) => (
        <div key={rel.id} className={styles.linkedItem}>
          <div className={styles.linkedItemIcon}>
            <Link size={14} />
          </div>
          <div className={styles.linkedItemBody}>
            <span className={styles.linkedItemName}>{rel.title}</span>
            <span className={styles.linkedItemMeta}>
              {RELATION_TYPE_KEY_MAP[rel.relation_type] ? t(`relations.related.types.${RELATION_TYPE_KEY_MAP[rel.relation_type]}`) : rel.relation_type} · {rel.ref_code}
            </span>
          </div>
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => removeMutation.mutate(rel.id)}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
// ─── Main export ─────────────────────────────────────────────────────

export default function NodeRelationsTab({ nodeId }: { nodeId: number }) {
  return (
    <div className={styles.tab}>
      <AgentsSection nodeId={nodeId} />
      <NodeLinksSection nodeId={nodeId} />
    </div>
  )
}

// ─── Standalone tab exports ───────────────────────────────────────────

export function NodeLocationsTab({ nodeId }: { nodeId: number }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [showHistory, setShowHistory] = useState(false)

  const { data: nodeData } = useQuery({
    queryKey: ['node', nodeId],
    queryFn: () => nodesApi.get(nodeId).then((r: any) => r.data.data),
  })

  const { data: history = [], isLoading: histLoading } = useQuery({
    queryKey: ['node-movements', nodeId],
    queryFn: () => locationsApi.getNodeMovements(nodeId).then(r => r.data.data),
    enabled: showHistory,
  })

  const currentLocationId = (nodeData as any)?.current_location_id

  return (
    <div className={styles.tab}>
      {/* Current location banner */}
      {currentLocationId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          padding: 'var(--space-3) var(--space-4)', background: 'var(--color-bg-subtle)',
          borderBottom: '1px solid var(--color-border)', fontSize: 'var(--text-sm)' }}>
          <MapPin size={13} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          <span style={{ fontWeight: 500, color: 'var(--color-ink)' }}>
            {t('relations.locations.currentlyAt')}
          </span>
          <CurrentLocationName locationId={currentLocationId} />
        </div>
      )}

      {/* Storage location assignment — check-in/out */}
      <LocationsSection nodeId={nodeId} />

      {/* Movement history */}
      <div style={{ borderTop: '1px solid var(--color-border)', padding: 'var(--space-3) var(--space-4)' }}>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)',
          fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}
          onClick={() => setShowHistory(v => !v)}>
          {showHistory ? '▾' : '▸'} {t('relations.locations.movementHistory')}
        </button>
        {showHistory && (
          <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {histLoading && <Spinner size={14} />}
            {!histLoading && (history as any[]).length === 0 && (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-faint)', fontStyle: 'italic' }}>
                {t('relations.locations.noMovementsYet')}
              </p>
            )}
            {(history as any[]).map((m: any) => (
              <div key={m.id} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start',
                padding: 'var(--space-2) 0', borderBottom: '1px solid var(--color-border)',
                fontSize: 'var(--text-sm)' }}>
                <MapPin size={12} style={{ color: 'var(--color-ink-faint)', marginTop: 2, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, color: 'var(--color-ink)' }}>
                    {m.location_name ?? t('relations.locations.unknownLocation')}
                  </div>
                  {m.from_location_name && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)' }}>
                      {t('relations.locations.fromLocation', { location: m.from_location_name })}
                    </div>
                  )}
                  {m.condition_note && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-muted)', fontStyle: 'italic' }}>
                      {m.condition_note}
                    </div>
                  )}
                  {m.notes && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)' }}>{m.notes}</div>
                  )}
                </div>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)', flexShrink: 0 }}>
                  {new Date(m.moved_at).toLocaleDateString('sv-SE')} · {m.moved_by}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CurrentLocationName({ locationId }: { locationId: number }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['location', locationId],
    queryFn: () => locationsApi.get(locationId).then((r: any) => r.data.data),
  })
  if (!data) return <Spinner size={12} />
  const isVirtual = (data as any).code === '__checked_out__'
  if (isVirtual) {
    return (
      <span style={{ color: 'var(--color-ink-muted)' }}>
        {(data as any).full_path ?? (data as any).name}
      </span>
    )
  }
  return (
    <button
      onClick={() => navigate('/app/locations', { state: { selectLocationId: locationId } })}
      title={t('relations.locations.openThisLocation')}
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        font: 'inherit', color: 'var(--color-accent)', textDecoration: 'underline',
        textDecorationColor: 'color-mix(in srgb, var(--color-accent) 35%, transparent)',
        textUnderlineOffset: 2 }}
    >
      {(data as any).full_path ?? (data as any).name}
    </button>
  )
}

export function NodeClassificationsTab({ nodeId }: { nodeId: number }) {
  return (
    <div className={styles.tab}>
      <ClassificationsSection nodeId={nodeId} />
    </div>
  )
}
