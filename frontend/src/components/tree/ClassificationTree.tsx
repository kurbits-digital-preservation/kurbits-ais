import { useState, useCallback } from 'react'
import { ChevronRight, ChevronDown, Circle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { classificationsApi } from '@/api'
import { Spinner } from '@/components/ui'
import type { ClassificationStub } from '@/types'
import styles from './ClassificationTree.module.css'
import { useAuthStore } from '@/store/auth'


interface ClassificationTreeProps {
  selectedId: number | null
  onSelect: (c: ClassificationStub) => void
  hierarchyTypeId?: number
}

interface RowProps {
  node: ClassificationStub
  depth: number
  selectedId: number | null
  onSelect: (c: ClassificationStub) => void
}

function Row({ node, depth, selectedId, onSelect }: RowProps) {
  const [expanded, setExpanded] = useState(false)

  const { data: children, isLoading } = useQuery({
    queryKey: ['classification-children', node.id],
    queryFn: () => classificationsApi.getChildren(node.id).then(r => r.data.data),
    enabled: expanded && node.has_children,
  })

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (node.has_children) setExpanded(v => !v)
  }, [node.has_children])

  const isSelected = selectedId === node.id

  return (
    <div className={styles.row}>
      <div
        className={`${styles.item} ${isSelected ? styles.selected : ''} ${!node.is_active ? styles.inactive : ''}`}
        style={{ paddingLeft: `${12 + depth * 18}px` }}
        onClick={() => onSelect(node)}
      >
        <button className={styles.expandBtn} onClick={toggle} disabled={!node.has_children}>
          {node.has_children ? (
            isLoading ? <Spinner size={12} /> :
            expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
          ) : (
            <span className={styles.leaf} />
          )}
        </button>

        <div className={styles.info}>
          <div className={styles.nameRow}>
            <span className={styles.code}>{node.full_code}</span>
            <span className={styles.name}>{node.name}</span>
            {!node.is_active && <span className={styles.retiredBadge}>retired</span>}
          </div>
          <div className={styles.meta}>
            <span className={styles.level}>{node.level_name}</span>
            {node.node_count > 0 && (
              <>
                <span className={styles.metaSep}>·</span>
                <span className={styles.nodeCount}>{node.node_count} linked</span>
              </>
            )}
          </div>
        </div>
      </div>

      {expanded && children && (
        <div className={styles.children}>
          {children.map(child => (
            <Row
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
          {children.length === 0 && (
            <p className={styles.noChildren} style={{ paddingLeft: `${30 + (depth + 1) * 18}px` }}>
              No sub-classifications
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function ClassificationTree({ selectedId, onSelect, hierarchyTypeId }: ClassificationTreeProps) {

  const { user } = useAuthStore()
  const institutionId = user?.active_institution?.id
  const { data, isLoading, error } = useQuery({
    queryKey: ['classification-tree', hierarchyTypeId, institutionId],
    queryFn: () => classificationsApi.getTree(hierarchyTypeId).then(r => r.data.data),
  })

  if (isLoading) return <div className={styles.state}><Spinner /><span>Loading…</span></div>
  if (error)     return <div className={styles.state}><span className="text-muted">Failed to load</span></div>
  if (!data?.length) return (
    <div className={styles.empty}>
      <p>No classifications defined.</p>
      <p className="text-faint">Create one to get started.</p>
    </div>
  )

  return (
    <div className={styles.tree}>
      {data.map(c => (
        <Row key={c.id} node={c} depth={0} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  )
}