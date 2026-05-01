import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { MapPin, Filter, RefreshCw, ChevronRight } from 'lucide-react'
import { locationOverviewApi, locationsApi } from '@/api'
import { Spinner } from '@/components/ui'
import styles from './LocationOverviewPage.module.css'

export default function LocationOverviewPage() {
  const navigate = useNavigate()
  const [locationFilter, setLocationFilter] = useState('')

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['location-overview', locationFilter],
    queryFn: () => locationOverviewApi.getOverview(
      locationFilter ? { location_id: parseInt(locationFilter) } : {}
    ).then(r => r.data.data),
  })

  const { data: locations = [] } = useQuery({
    queryKey: ['locations-flat-overview'],
    queryFn: () => locationsApi.getTree().then((r: any) => {
      const flat: any[] = []
      const walk = (nodes: any[], depth = 0) => {
        for (const n of nodes) { flat.push({ ...n, depth }); if (n.children) walk(n.children, depth + 1) }
      }
      walk(r.data.data ?? [])
      return flat
    }),
  })

  const items: any[] = data?.items ?? []
  const total: number = data?.total ?? 0

  const byLocation: Record<string, any[]> = {}
  for (const item of items) {
    const key = item.current_location_path ?? 'Unknown'
    if (!byLocation[key]) byLocation[key] = []
    byLocation[key].push(item)
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}><MapPin size={20} /> Location overview</h1>
          <p className={styles.desc}>Current location of all objects in the collection.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => refetch()}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className={styles.filterBar}>
        <Filter size={13} style={{ color: 'var(--color-ink-faint)' }} />
        <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)}
          className={styles.filterSelect}>
          <option value="">All locations</option>
          {(locations as any[]).map((l: any) => (
            <option key={l.id} value={l.id}>{'  '.repeat(l.depth)}{l.name}</option>
          ))}
        </select>
        <span className={styles.totalCount}>
          {isLoading ? <Spinner size={13} /> : `${total} object${total !== 1 ? 's' : ''}`}
        </span>
      </div>

      {isLoading ? (
        <div className={styles.loading}><Spinner size={20} /></div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <MapPin size={36} style={{ opacity: 0.1, marginBottom: 'var(--space-3)' }} />
          <p>No objects with location data yet.</p>
          <p style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
            Check in an object via the Locations tab on any resource.
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {Object.entries(byLocation).map(([locationPath, groupItems]) => (
            <div key={locationPath}>
              <div className={styles.groupHeader}>
                <MapPin size={13} />
                <span>{locationPath}</span>
                <span className={styles.groupCount}>{groupItems.length}</span>
                {locationPath === 'Checked out' && (
                  <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px',
                    borderRadius: 3, background: 'color-mix(in srgb, #d97706 12%, transparent)',
                    color: '#d97706', border: '1px solid color-mix(in srgb, #d97706 25%, transparent)' }}>
                    CHECKED OUT
                  </span>
                )}
              </div>
              {groupItems.map((item: any) => (
                <button key={item.node_id} className={styles.row}
                  onClick={() => navigate(`/app/resources?node=${item.node_id}`)}>
                  <code className={styles.rowRef}>{item.node_ref_code}</code>
                  <span className={styles.rowTitle}>{item.node_title}</span>
                  <span className={styles.rowLevel}>{item.node_level}</span>
                  <ChevronRight size={13} style={{ color: 'var(--color-ink-faint)', flexShrink: 0 }} />
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}