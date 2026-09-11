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

const FACET_TITLES: Record<string, string> = {
  agent_type: 'Agent type',
  classification: 'Classification',
  hierarchy_type: 'Hierarchy',
  level: 'Level',
  status: 'Status',
}

const FACET_ORDER = ['classification', 'agent_type', 'hierarchy_type', 'level', 'status']

const RECORD_TYPES = [
  { value: 'nodes,agents', label: 'All' },
  { value: 'nodes',        label: 'Resources' },
  { value: 'agents',       label: 'Agents' },
  { value: 'files',        label: 'Files' },
]

export default function SearchFacets({ facets, params, setParam, clearParam }: {
  facets: Facets | undefined
  params: URLSearchParams
  setParam: (k: string, v: string) => void
  clearParam: (k: string) => void
}) {
  const currentType = params.get('types') ?? 'nodes,agents'

  return (
    <div className={styles.facets}>
      {/* Record type — decides which facets are relevant, so it lives here */}
      <div className={styles.facetGroup}>
        <div className={styles.facetTitle}>Record type</div>
        <div className={styles.recordTypeRow}>
          {RECORD_TYPES.map(rt => (
            <button
              key={rt.value}
              className={`${styles.recordTypeBtn} ${currentType === rt.value ? styles.recordTypeActive : ''}`}
              onClick={() => setParam('types', rt.value)}
            >
              {rt.label}
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
              {FACET_TITLES[facetKey]}
              {active && (
                <button className={styles.facetClear} onClick={() => clearParam(paramKey)}>
                  clear
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
