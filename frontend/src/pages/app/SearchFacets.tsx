import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'
import { agentsApi } from '@/api'
import styles from './SearchFacets.module.css'

interface FacetValue {
  value: string
  label?: string
  code?: string
  count: number
}
interface Facets {
  agent?: FacetValue[]
  agent_type?: FacetValue[]
  classification?: FacetValue[]
  hierarchy_type?: FacetValue[]
  level?: FacetValue[]
  status?: FacetValue[]
}

// The facet key -> URL param key it filters on.
const FACET_PARAM: Record<string, string> = {
  agent: 'agent_id',
  agent_type: 'agent_type',
  classification: 'classification_id',
  hierarchy_type: 'hierarchy_type_id',
  level: 'level',
  status: 'status',
}

// The facet key -> translation key under search.facets.*
const FACET_TITLE_KEYS: Record<string, string> = {
  agent: 'search.facets.agent',
  agent_type: 'search.facets.agentType',
  classification: 'search.facets.classification',
  hierarchy_type: 'search.facets.hierarchy',
  level: 'search.facets.level',
  status: 'flags.status',
}

const FACET_ORDER = ['classification', 'agent', 'agent_type', 'hierarchy_type', 'level', 'status']

// value -> translation key under search.facets.* / nav.* / resources.tabs.*
const RECORD_TYPE_KEYS: Record<string, string> = {
  'nodes,agents': 'flags.all',
  'nodes': 'search.facets.resources',
  'agents': 'nav.agents',
  'files': 'resources.tabs.files',
}
const RECORD_TYPES = ['nodes,agents', 'nodes', 'agents', 'files']

// Which text a query is matched against — 'attachments' only exists for resources.
const SEARCH_SCOPES = ['all', 'description', 'notes', 'attachments']
const SCOPE_KEYS: Record<string, string> = {
  all: 'search.facets.scopeAll',
  description: 'search.facets.scopeDescription',
  notes: 'search.facets.scopeNotes',
  attachments: 'search.facets.scopeAttachments',
}

type SetParam = (k: string, v: string) => void
type ClearParam = (k: string) => void

// ─── Shared facet value list ──────────────────────────────────────────

function FacetValueList({ values, active, paramKey, setParam, clearParam }: {
  values: FacetValue[]
  active: string | null
  paramKey: string
  setParam: SetParam
  clearParam: ClearParam
}) {
  return (
    <div className={styles.facetValues}>
      {values.map(fv => {
        const isActive = active === fv.value
        return (
          <button
            key={fv.value}
            className={`${styles.facetValue} ${isActive ? styles.facetValueActive : ''}`}
            onClick={() => isActive ? clearParam(paramKey) : setParam(paramKey, fv.value)}
            title={fv.code ? `${fv.code} — ${fv.label ?? fv.value}` : undefined}
          >
            <span className={styles.facetLabel}>{fv.label ?? fv.value}</span>
            <span className={styles.facetCount}>{fv.count}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Agent picker ─────────────────────────────────────────────────────

function AgentPicker({ onPick }: { onPick: (agentId: number) => void }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const { data: agents = [], isFetching } = useQuery({
    queryKey: ['search-agent-picker', query],
    queryFn: () => agentsApi.list({ q: query, per_page: 8 }).then(r => r.data.data),
    enabled: query.trim().length > 1,
  })

  return (
    <div className={styles.agentPicker}>
      <div className={styles.agentPickerInputWrap}>
        <Search size={12} className={styles.agentPickerIcon} />
        <input
          className={styles.agentPickerInput}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={t('search.facets.agentPlaceholder')}
        />
        {query && (
          <button className={styles.agentPickerClear} onClick={() => setQuery('')}>
            <X size={11} />
          </button>
        )}
      </div>
      {open && query.trim().length > 1 && (
        <div className={styles.agentPickerDropdown}>
          {!isFetching && agents.length === 0 && (
            <div className={styles.agentPickerEmpty}>{t('search.facets.agentNoMatch')}</div>
          )}
          {agents.map(a => (
            <button
              key={a.id}
              className={styles.agentPickerOption}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onPick(a.id); setQuery(''); setOpen(false) }}
            >
              <span className={styles.facetLabel}>{a.name}</span>
              <span className={styles.agentPickerType}>
                {t(`agents.types.${a.agent_type}`, { defaultValue: a.agent_type })}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Agent facet (always available when resources are searched) ──────

function AgentFacet({ values, params, setParam, clearParam }: {
  values: FacetValue[]
  params: URLSearchParams
  setParam: SetParam
  clearParam: ClearParam
}) {
  const { t } = useTranslation()
  const paramKey = FACET_PARAM.agent
  const active = params.get(paramKey)
  const shown = active ? values.filter(fv => fv.value === active) : values

  return (
    <div className={styles.facetGroup}>
      <div className={styles.facetTitle}>
        {t(FACET_TITLE_KEYS.agent)}
        {active && (
          <button className={styles.facetClear} onClick={() => clearParam(paramKey)}>
            {t('search.facets.clear')}
          </button>
        )}
      </div>
      {!active && <AgentPicker onPick={id => setParam(paramKey, String(id))} />}
      <FacetValueList
        values={shown}
        active={active}
        paramKey={paramKey}
        setParam={setParam}
        clearParam={clearParam}
      />
    </div>
  )
}

// ─── Facets ───────────────────────────────────────────────────────────

export default function SearchFacets({ facets, params, setParam, clearParam }: {
  facets: Facets | undefined
  params: URLSearchParams
  setParam: SetParam
  clearParam: ClearParam
}) {
  const { t } = useTranslation()
  const currentType = params.get('types') ?? 'nodes,agents'
  const searchesNodes = currentType.split(',').includes('nodes')
  const currentScope = params.get('scope') ?? 'all'
  const availableScopes = SEARCH_SCOPES.filter(sc => sc !== 'attachments' || searchesNodes)

  return (
    <div className={styles.facets}>
      {/* Record type — decides which facets are relevant, so it lives here */}
      <div className={styles.facetGroup}>
        <div className={styles.facetTitle}>{t('search.facets.recordType')}</div>
        <div className={styles.recordTypeRow}>
          {RECORD_TYPES.map(rt => (
            <button
              key={rt}
              className={`${styles.recordTypeBtn} ${currentType === rt ? styles.recordTypeActive : ''}`}
              onClick={() => setParam('types', rt)}
            >
              {t(RECORD_TYPE_KEYS[rt])}
            </button>
          ))}
        </div>
      </div>

      {/* Search scope — which text the query is matched against */}
      {currentType !== 'files' && (
        <div className={styles.facetGroup}>
          <div className={styles.facetTitle}>{t('search.facets.scope')}</div>
          <div className={styles.recordTypeRow}>
            {availableScopes.map(sc => (
              <button
                key={sc}
                className={`${styles.recordTypeBtn} ${currentScope === sc ? styles.recordTypeActive : ''}`}
                onClick={() => sc === 'all' ? clearParam('scope') : setParam('scope', sc)}
              >
                {t(SCOPE_KEYS[sc])}
              </button>
            ))}
          </div>
        </div>
      )}

      {FACET_ORDER.map(facetKey => {
        if (facetKey === 'agent') {
          return searchesNodes ? (
            <AgentFacet
              key={facetKey}
              values={facets?.agent ?? []}
              params={params}
              setParam={setParam}
              clearParam={clearParam}
            />
          ) : null
        }

        const values: FacetValue[] = (facets as any)?.[facetKey] ?? []
        if (values.length === 0) return null

        const paramKey = FACET_PARAM[facetKey]
        const active = params.get(paramKey)

        return (
          <div key={facetKey} className={styles.facetGroup}>
            <div className={styles.facetTitle}>
              {t(FACET_TITLE_KEYS[facetKey])}
              {active && (
                <button className={styles.facetClear} onClick={() => clearParam(paramKey)}>
                  {t('search.facets.clear')}
                </button>
              )}
            </div>
            <FacetValueList
              values={values}
              active={active}
              paramKey={paramKey}
              setParam={setParam}
              clearParam={clearParam}
            />
          </div>
        )
      })}
    </div>
  )
}