import { useState, useCallback, useEffect } from 'react'
import { ChevronRight, ChevronDown, Loader2, FilePlus } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { nodesApi } from '@/api'
import type { NodeStub } from '@/types'
import styles from './NodeTree.module.css'

interface NodeTreeProps {
  selectedId: number | null
  onSelect: (node: NodeStub) => void
  onAddChild?: (parentId: number) => void
  searchQuery?: string
  hierarchyTypeId?: number
  // Multi-select for bulk actions
  selectedIds?: Set<number>
  onToggleSelect?: (node: NodeStub) => void
}

interface NodeRowProps {
  node: NodeStub
  depth: number
  selectedId: number | null
  expandedIds: Set<number>
  onToggle: (id: number) => void
  onSelect: (node: NodeStub) => void
  onAddChild?: (parentId: number) => void
  selectedIds?: Set<number>
  onToggleSelect?: (node: NodeStub) => void
}

function NodeRow({ node, depth, selectedId, expandedIds, onToggle, onSelect, onAddChild, selectedIds, onToggleSelect }: NodeRowProps) {
  const expanded = expandedIds.has(node.id)

  const { data: childrenData, isLoading } = useQuery({
    queryKey: ['node-children', node.id],
    queryFn: () => nodesApi.getChildren(node.id).then(r => r.data.data),
    enabled: expanded && node.has_children,
  })

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (node.has_children) onToggle(node.id)
  }, [node.has_children, node.id, onToggle])

  const isSelected = selectedId === node.id
  const isChecked = selectedIds?.has(node.id) ?? false

  return (
    <div className={styles.nodeRow}>
      <div
        className={`${styles.nodeItem} ${isSelected ? styles.selected : ''} ${isChecked ? styles.checked : ''}`}
        style={{ paddingLeft: `${onToggleSelect ? 6 + depth * 18 : 12 + depth * 18}px` }}
        onClick={() => onToggleSelect ? onToggleSelect(node) : onSelect(node)}
      >
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={isChecked}
            onChange={e => { e.stopPropagation(); onToggleSelect(node) }}
            onClick={e => e.stopPropagation()}
            style={{ marginRight: 6, flexShrink: 0, cursor: 'pointer', accentColor: 'var(--color-accent)' }}
          />
        )}
        <button
          className={styles.expandBtn}
          onClick={toggle}
          disabled={!node.has_children}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {node.has_children ? (
            isLoading ? (
              <Loader2 size={12} className={styles.spinner} />
            ) : expanded ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )
          ) : (
            <span className={styles.leaf} />
          )}
        </button>

        <div className={styles.nodeInfo}>
          <span className={styles.nodeTitle}>{node.title || node.ref_code}</span>
          <div className={styles.nodeMeta}>
            <span className={`ref-code ${styles.refCode}`}>{node.ref_code}</span>
            <span className={styles.level}>{node.level_of_description}</span>
            {node.status !== 'published' && (
              <span className={`${styles.statusBadge} ${styles[`status_${node.status}`]}`}>
                {node.status}
              </span>
            )}
          </div>
        </div>

        {onAddChild && isSelected && (
          <button
            className={styles.addChildBtn}
            onClick={(e) => { e.stopPropagation(); onAddChild(node.id) }}
            title="Add child node"
          >
            <FilePlus size={13} />
          </button>
        )}
      </div>

      {expanded && childrenData && (
        <div className={styles.children}>
          {childrenData.map(child => (
            <NodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
              onAddChild={onAddChild}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function NodeTree({ selectedId, onSelect, onAddChild, searchQuery, hierarchyTypeId, selectedIds, onToggleSelect }: NodeTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  const { data, isLoading, error } = useQuery({
    queryKey: ['node-tree'],
    queryFn: () => nodesApi.getTree().then(r => r.data.data),
  })

  // Search results — flat list when query is active
  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ['node-tree-search', searchQuery, hierarchyTypeId],
    queryFn: () => nodesApi.list({
      q: searchQuery,
      per_page: 50,
      hierarchy_type_id: hierarchyTypeId,
    }).then(r => r.data.data),
    enabled: (searchQuery?.length ?? 0) >= 2,
  })

  // When selectedId changes (e.g. from search), fetch the breadcrumb
  // and expand all ancestor nodes so the selected node is visible
  const { data: selectedNode } = useQuery({
    queryKey: ['node', selectedId],
    queryFn: () => nodesApi.get(selectedId!).then(r => r.data.data),
    enabled: !!selectedId,
  })

  useEffect(() => {
    if (!selectedNode?.breadcrumb) return
    const ancestorIds = selectedNode.breadcrumb
      .slice(0, -1)  // all except the node itself
      .map((b: any) => b.id)
    if (ancestorIds.length === 0) return
    setExpandedIds(prev => {
      const next = new Set(prev)
      ancestorIds.forEach((id: number) => next.add(id))
      return next
    })
  }, [selectedNode])

  const onToggle = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  if (isLoading) {
    return (
      <div className={styles.state}>
        <Loader2 size={18} className={styles.spinner} />
        <span>Loading…</span>
      </div>
    )
  }

  if (error) {
    return <div className={styles.state}><span className="text-muted">Failed to load tree</span></div>
  }

  if (!data?.length) {
    return (
      <div className={styles.empty}>
        <p>No resources yet.</p>
        <p className="text-faint">Create your first resource to get started.</p>
      </div>
    )
  }

  // Search mode — flat results list
  if (searchQuery && searchQuery.length >= 2) {
    if (searchLoading) return (
      <div className={styles.state}><Loader2 size={18} className={styles.spinner} /><span>Searching…</span></div>
    )
    if (!searchResults?.length) return (
      <div className={styles.empty}><p>No results for "{searchQuery}"</p></div>
    )
    return (
      <div className={styles.tree}>
        {(searchResults as any[]).map((node: any) => (
          <div
            key={node.id}
            className={`${styles.nodeItem} ${node.id === selectedId ? styles.selected : ''} ${selectedIds?.has(node.id) ? styles.checked : ''}`}
            style={{ paddingLeft: 'var(--space-3)', cursor: 'pointer' }}
            onClick={() => onToggleSelect ? onToggleSelect(node) : onSelect(node)}
          >
            {onToggleSelect && (
              <input
                type="checkbox"
                checked={selectedIds?.has(node.id) ?? false}
                onChange={() => onToggleSelect(node)}
                onClick={e => e.stopPropagation()}
                style={{ marginRight: 6, flexShrink: 0, cursor: 'pointer', accentColor: 'var(--color-accent)' }}
              />
            )}
            <div className={styles.nodeInfo}>
              <span className={styles.nodeTitle}>{node.title}</span>
              <div className={styles.nodeMeta}>
                <span className={`ref-code ${styles.refCode}`}>{node.ref_code}</span>
                {node.level_of_description && (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)' }}>
                    {node.level_of_description}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={styles.tree}>
      {data.map(node => (
        <NodeRow
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          expandedIds={expandedIds}
          onToggle={onToggle}
          onSelect={onSelect}
          onAddChild={onAddChild}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  )
}