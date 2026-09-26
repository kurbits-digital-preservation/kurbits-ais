import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, MoveRight, X, AlertCircle, ChevronRight } from 'lucide-react'
import { nodesApi } from '@/api'
import { Spinner } from '@/components/ui'
import type { NodeDetail } from '@/types'
import { useTranslation } from 'react-i18next'
import styles from './MoveNodeDialog.module.css'

// ─── Props ────────────────────────────────────────────────────────────

type SingleMode = { node: NodeDetail; nodeIds?: undefined }
type BulkMode   = { nodeIds: number[]; node?: undefined }

type MoveNodeDialogProps = (SingleMode | BulkMode) & {
  onClose: () => void
  onMoved: () => void
}

export default function MoveNodeDialog({ node, nodeIds, onClose, onMoved }: MoveNodeDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedTarget, setSelectedTarget] = useState<any>(null)
  const [moveError, setMoveError] = useState('')

  const isBulk = !!nodeIds
  const idsToMove = isBulk ? nodeIds : [node!.id]

  const { data: searchResults, isLoading } = useQuery({
    queryKey: ['nodes-move-search', search],
    queryFn: () => nodesApi.list({ q: search, per_page: 12 }).then(r => r.data.data as any[]),
    enabled: search.length >= 1,
  })

  const filteredResults = (searchResults ?? []).filter(
    (n: any) => !idsToMove.includes(n.id)
  )

  const moveMutation = useMutation({
    mutationFn: () => isBulk
      ? nodesApi.bulkMove(idsToMove, selectedTarget?.id ?? null)
      : nodesApi.move(node!.id, selectedTarget?.id ?? null),
    onSuccess: (res: any) => {
      const errors: any[] = res.data?.data?.errors ?? []
      queryClient.invalidateQueries({ queryKey: ['node-tree'] })
      queryClient.invalidateQueries({ queryKey: ['node-children'] })
      if (!isBulk) queryClient.invalidateQueries({ queryKey: ['node', node!.id] })
      if (errors.length > 0) {
        setMoveError(errors.map((e: any) => e.error).join(', '))
      } else {
        onMoved()
      }
    },
    onError: (err: any) => {
      setMoveError(err.response?.data?.message ?? t('moveDialog.moveFailed'))
    },
  })

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className={styles.header}>
          <div>
            <h3 className={styles.title}>{isBulk ? t('moveDialog.titleBulk', { count: idsToMove.length }) : t('moveDialog.titleSingle')}</h3>
            <div className={styles.subtitle}>
              {isBulk ? (
                <span className={styles.nodeName}>{t('moveDialog.itemsSelected', { count: idsToMove.length })}</span>
              ) : (
                <>
                  <span className={styles.nodeName}>{node!.title}</span>
                  <span className={styles.nodeRef}>{node!.ref_code}</span>
                  <span className={styles.nodeLevel}>{node!.level_of_description}</span>
                </>
              )}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {moveError && (
            <div className={styles.error}>
              <AlertCircle size={14} />
              {moveError}
            </div>
          )}

          <p className={styles.instruction}>
            {t('moveDialog.instruction')}
          </p>

          <div className={styles.searchBox}>
            <Search size={14} className={styles.searchIcon} />
            <input
              className={styles.searchInput}
              placeholder={t('moveDialog.searchPlaceholder')}
              value={search}
              onChange={e => { setSearch(e.target.value); setSelectedTarget(null) }}
              autoFocus
            />
            {isLoading && <Spinner size={13} />}
          </div>

          {filteredResults.length > 0 && (
            <div className={styles.results}>
              {filteredResults.map((n: any) => (
                <button
                  key={n.id}
                  className={`${styles.resultRow} ${selectedTarget?.id === n.id ? styles.resultSelected : ''}`}
                  onClick={() => setSelectedTarget(n)}
                >
                  <div className={styles.resultInfo}>
                    <span className={styles.resultTitle}>{n.title || n.ref_code}</span>
                    <div className={styles.resultMeta}>
                      <span className="ref-code" style={{ fontSize: 'var(--text-xs)' }}>{n.ref_code}</span>
                      {n.level_of_description && (
                        <span className={styles.resultLevel}>{n.level_of_description}</span>
                      )}
                    </div>
                  </div>
                  {selectedTarget?.id === n.id && (
                    <ChevronRight size={14} className={styles.selectedIcon} />
                  )}
                </button>
              ))}
            </div>
          )}

          {selectedTarget ? (
            <div className={styles.movePreview}>
              <div className={styles.moveFrom}>
                <span className={styles.movePLabel}>{t('moveDialog.moving')}</span>
                <span>{isBulk ? t('moveDialog.nodeCount', { count: idsToMove.length }) : (node!.title || node!.ref_code)}</span>
              </div>
              <MoveRight size={16} className={styles.moveArrow} />
              <div className={styles.moveTo}>
                <span className={styles.movePLabel}>{t('moveDialog.into')}</span>
                <span>{selectedTarget.title || selectedTarget.ref_code}</span>
              </div>
            </div>
          ) : (
            <p className={styles.moveToRoot}>
              {t('moveDialog.noTargetSelected')} <strong>{t('moveDialog.rootLevel')}</strong>
            </p>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => moveMutation.mutate()}
            disabled={moveMutation.isPending}
          >
            {moveMutation.isPending ? <Spinner size={13} /> : <MoveRight size={13} />}
            {t('moveDialog.move')}
          </button>
        </div>
      </div>
    </div>
  )
}