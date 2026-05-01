import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, MoveRight, X, AlertCircle, ChevronRight } from 'lucide-react'
import { nodesApi } from '@/api'
import { Spinner } from '@/components/ui'
import type { NodeDetail } from '@/types'
import styles from './MoveNodeDialog.module.css'

interface MoveNodeDialogProps {
  node: NodeDetail
  onClose: () => void
  onMoved: () => void
}

export default function MoveNodeDialog({ node, onClose, onMoved }: MoveNodeDialogProps) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedTarget, setSelectedTarget] = useState<any>(null)
  const [moveError, setMoveError] = useState('')

  const { data: searchResults, isLoading } = useQuery({
    queryKey: ['nodes-move-search', search],
    queryFn: () => nodesApi.list({ q: search, per_page: 12 }).then(r => r.data.data as any[]),
    enabled: search.length >= 1,
  })

  const moveMutation = useMutation({
    mutationFn: () => nodesApi.move(node.id, selectedTarget?.id ?? null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node-tree'] })
      queryClient.invalidateQueries({ queryKey: ['node', node.id] })
      queryClient.invalidateQueries({ queryKey: ['node-children'] })
      onMoved()
    },
    onError: (err: any) => {
      setMoveError(err.response?.data?.message ?? 'Move failed')
    },
  })

  // Filter out the node itself and its descendants from results
  const filteredResults = (searchResults ?? []).filter(
    (n: any) => n.id !== node.id
  )

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>

        <div className={styles.header}>
          <div>
            <h3 className={styles.title}>Move node</h3>
            <div className={styles.subtitle}>
              <span className={styles.nodeName}>{node.title}</span>
              <span className={styles.nodeRef}>{node.ref_code}</span>
              <span className={styles.nodeLevel}>{node.level_of_description}</span>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className={styles.body}>
          {moveError && (
            <div className={styles.error}>
              <AlertCircle size={14} />
              {moveError}
            </div>
          )}

          <p className={styles.instruction}>
            Search for the new parent node. Leave empty and confirm to move to root level.
          </p>

          <div className={styles.searchRow}>
            <Search size={14} className={styles.searchIcon} />
            <input
              autoFocus
              value={search}
              onChange={e => { setSearch(e.target.value); setSelectedTarget(null); setMoveError('') }}
              placeholder="Search for target parent…"
              className={styles.searchInput}
            />
          </div>

          {/* Current position */}
          <div className={styles.currentPosition}>
            <span className={styles.posLabel}>Currently under:</span>
            <span className={styles.posValue}>
              {node.parent_id
                ? node.breadcrumb.slice(0, -1).map((b: any) => b.title).join(' › ')
                : 'Root level'}
            </span>
          </div>

          {/* Search results */}
          {isLoading && (
            <div className={styles.loading}><Spinner size={16} /></div>
          )}

          {!isLoading && search && filteredResults.length === 0 && (
            <p className={styles.noResults}>No results for "{search}"</p>
          )}

          {filteredResults.length > 0 && (
            <div className={styles.results}>
              {filteredResults.map((n: any) => (
                <button
                  key={n.id}
                  className={`${styles.resultRow} ${selectedTarget?.id === n.id ? styles.resultSelected : ''}`}
                  onClick={() => setSelectedTarget(n)}
                >
                  <div className={styles.resultInfo}>
                    <span className={styles.resultTitle}>{n.title}</span>
                    <div className={styles.resultMeta}>
                      <span className="ref-code">{n.ref_code}</span>
                      <span className={styles.resultLevel}>{n.level_of_description}</span>
                    </div>
                  </div>
                  {selectedTarget?.id === n.id && (
                    <MoveRight size={14} className={styles.selectedIcon} />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Target preview */}
          {selectedTarget && (
            <div className={styles.movePreview}>
              <div className={styles.moveFrom}>
                <span className={styles.movePLabel}>From</span>
                <span>{node.breadcrumb.slice(0, -1).map((b: any) => b.title).join(' › ') || 'Root'}</span>
              </div>
              <ChevronRight size={14} className={styles.moveArrow} />
              <div className={styles.moveTo}>
                <span className={styles.movePLabel}>To</span>
                <span>{selectedTarget.title}</span>
              </div>
            </div>
          )}

          {!selectedTarget && !search && (
            <div className={styles.moveToRoot}>
              <span>Confirm to move to <strong>root level</strong></span>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={moveMutation.isPending}
            onClick={() => { setMoveError(''); moveMutation.mutate() }}
          >
            {moveMutation.isPending ? <Spinner size={14} /> : <MoveRight size={14} />}
            {selectedTarget ? `Move under "${selectedTarget.title}"` : 'Move to root'}
          </button>
        </div>
      </div>
    </div>
  )
}