import { useState, useCallback } from 'react'
import { ChevronRight, ChevronDown, Package, Building2, Layers } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { locationsApi } from '@/api'
import { Spinner } from '@/components/ui'
import type { LocationStub } from '@/types'
import styles from './LocationTree.module.css'
import { useAuthStore } from '@/store/auth'

interface LocationTreeProps {
  selectedId: number | null
  onSelect: (location: LocationStub) => void
  search?: string
}

interface LocationRowProps {
  location: LocationStub
  depth: number
  selectedId: number | null
  onSelect: (location: LocationStub) => void
}



function CapacityBar({ stored, capacity }: { stored: number; capacity: number | null }) {
  if (capacity === null) return null
  const pct = Math.min((stored / capacity) * 100, 100)
  const colour = pct > 90 ? 'var(--color-error)' : pct > 70 ? 'var(--color-warning)' : 'var(--color-success)'
  return (
    <div className={styles.capacityBar} title={`${stored} / ${capacity}`}>
      <div className={styles.capacityFill} style={{ width: `${pct}%`, background: colour }} />
    </div>
  )
}

function LevelIcon({ level }: { level: string }) {
  const l = level.toLowerCase()
  if (['building', 'floor', 'room'].includes(l)) return <Building2 size={13} />
  if (['shelf', 'box'].includes(l)) return <Package size={13} />
  return <Layers size={13} />
}

function LocationRow({ location, depth, selectedId, onSelect }: LocationRowProps) {
  const [expanded, setExpanded] = useState(false)

  const { data: children, isLoading } = useQuery({
    queryKey: ['location-children', location.id],
    queryFn: () => locationsApi.getChildren(location.id).then(r => r.data.data),
    enabled: expanded && location.has_children,
  })

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (location.has_children) setExpanded(v => !v)
  }, [location.has_children])

  const isSelected = selectedId === location.id

  return (
    <div className={styles.row}>
      <div
        className={`${styles.item} ${isSelected ? styles.selected : ''}`}
        style={{ paddingLeft: `${12 + depth * 18}px` }}
        onClick={() => onSelect(location)}
      >
        <button
          className={styles.expandBtn}
          onClick={toggle}
          disabled={!location.has_children}
        >
          {location.has_children ? (
            isLoading ? <Spinner size={12} /> :
            expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
          ) : (
            <span className={styles.leaf} />
          )}
        </button>

        <span className={styles.levelIcon}>
          <LevelIcon level={location.level_name} />
        </span>

        <div className={styles.info}>
          <div className={styles.nameRow}>
            <span className={styles.name}>{location.name}</span>
            <span className={styles.code}>{location.code}</span>
          </div>
          <div className={styles.meta}>
            <span className={styles.level}>{location.level_name}</span>
            {location.can_store_nodes && (
              <>
                <span className={styles.metaSep}>·</span>
                <span className={styles.stored}>
                  {location.stored_count} stored
                  {location.capacity !== null && ` / ${location.capacity}`}
                </span>
                <CapacityBar stored={location.stored_count} capacity={location.capacity} />
              </>
            )}
          </div>
        </div>
      </div>

      {expanded && children && (
        <div className={styles.children}>
          {children.map(child => (
            <LocationRow
              key={child.id}
              location={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
          {children.length === 0 && (
            <p className={styles.noChildren} style={{ paddingLeft: `${30 + (depth + 1) * 18}px` }}>
              No sub-locations
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function LocationTree({ selectedId, onSelect, search = '' }: LocationTreeProps) {
  // When search is active, show flat search results instead of the tree
  const { user } = useAuthStore()
  const institutionId = user?.active_institution?.id
  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ['locations-search-tree', search],
    queryFn: () => locationsApi.search(search, false).then(r => r.data.data),
    enabled: search.trim().length > 1,
  })

  const { data, isLoading, error } = useQuery({
     queryKey: ['location-tree', institutionId],
    queryFn: () => locationsApi.getTree().then(r => r.data.data),
    enabled: search.trim().length <= 1,
  })

  if (search.trim().length > 1) {
    if (searchLoading) return <div className={styles.state}><Spinner /><span>Searching…</span></div>
    if (!searchResults?.length) return <div className={styles.empty}><p>No locations found.</p></div>
    return (
      <div className={styles.tree}>
        {searchResults.map((loc: any) => (
          <div
            key={loc.id}
            className={`${styles.locationRow} ${selectedId === loc.id ? styles.selected : ''}`}
            style={{ paddingLeft: '12px' }}
            onClick={() => onSelect(loc)}
          >
            <span className={styles.levelIcon}><LevelIcon level={loc.level_name} /></span>
            <div className={styles.info}>
              <div className={styles.nameRow}>
                <span className={styles.name}>{loc.name}</span>
                <span className={styles.code}>{loc.code}</span>
              </div>
              <div className={styles.meta}>
                <span className={styles.level}>{loc.level_name}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (isLoading) return <div className={styles.state}><Spinner /><span>Loading…</span></div>
  if (error) return <div className={styles.state}><span className="text-muted">Failed to load</span></div>
  if (!data?.length) return (
    <div className={styles.empty}>
      <p>No locations defined.</p>
      <p className="text-faint">Add a root location to get started.</p>
    </div>
  )

  return (
    <div className={styles.tree}>
      {data.map(loc => (
        <LocationRow key={loc.id} location={loc} depth={0} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  )
}