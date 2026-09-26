import { useTranslation } from 'react-i18next'
import styles from './SearchFacets.module.css'

interface FacetValue {
  value: string
  label?: string
  code?: string
  count: number
}
interface Facets {
  agent_type?: FacetValue[]
  classification?: FacetValue[]
  hierarchy_type?: FacetValue[]
  level?: FacetValue[]
  status?: FacetValue[]
}

// The facet key -> URL param key it filters on.
const FACET_PARAM: Record<string, string> = {
  agent_type: 'agent_type',
  classification: 'classification_id',
  hierarchy_type: 'hierarchy_type_id',
  level: 'level',
  status: 'status',
}

// The facet key -> translation key under search.facets.*
const FACET_TITLE_KEYS: Record<string, string> = {
  agent_type: 'search.facets.agentType',
  classification: 'search.facets.classification',
  hierarchy_type: 'search.facets.hierarchy',
  level: 'search.facets.level',
  status: 'flags.status',
}

const FACET_ORDER = ['classification', 'agent_type', 'hierarchy_type', 'level', 'status']

// value -> translation key under search.facets.* / nav.* / resources.tabs.*
const RECORD_TYPE_KEYS: Record<string, string> = {
  'nodes,agents': 'flags.all',
  'nodes': 'search.facets.resources',
  'agents': 'nav.agents',
  'files': 'resources.tabs.files',
}
const RECORD_TYPES = ['nodes,agents', 'nodes', 'agents', 'files']

export default function SearchFacets({ facets, params, setParam, clearParam }: {
  facets: Facets | undefined
  params: URLSearchParams
  setParam: (k: string, v: string) => void
  clearParam: (k: string) => void
}) {
  const { t } = useTranslation()
  const currentType = params.get('types') ?? 'nodes,agents'

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

      {facets && FACET_ORDER.map(facetKey => {
        const values: FacetValue[] = (facets as any)[facetKey] ?? []
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
          </div>
        )
      })}
    </div>
  )
}
