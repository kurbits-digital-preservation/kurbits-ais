import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, X, FolderTree } from 'lucide-react'
import { classificationsApi } from '@/api'
import { Spinner } from '@/components/ui'
import styles from './ClassificationPickerModal.module.css'

export interface PickedClassification {
  id: number
  code: string
  full_code: string
  name: string
}

export default function ClassificationPickerModal({ onPick, onClose, currentId, title }: {
  onPick: (c: PickedClassification) => void
  onClose: () => void
  currentId?: number
  title?: string
}) {
  const [query, setQuery] = useState('')
  const [schemeId, setSchemeId] = useState<number | undefined>(undefined)

  const { data: schemes } = useQuery({
    queryKey: ['classification-schemes'],
    queryFn: () => classificationsApi.listSchemes().then(r => r.data.data),
  })

  const { data: results, isFetching } = useQuery({
    queryKey: ['classification-picker-search', query, schemeId],
    queryFn: () => classificationsApi.search(query, schemeId).then(r => r.data.data),
    enabled: query.length >= 1,
  })

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title}>
            <FolderTree size={16} /> {title || 'Link to classification'}
          </h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><X size={14} /></button>
        </div>

        <div className={styles.body}>
          {schemes && schemes.length > 1 && (
            <select
              value={schemeId ?? ''}
              onChange={e => setSchemeId(e.target.value ? parseInt(e.target.value) : undefined)}
              className={styles.schemeSelect}
            >
              <option value="">All schemes</option>
              {schemes.map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}

          <div className={styles.searchRow}>
            <Search size={15} className={styles.searchIcon} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name or code…"
              autoFocus
            />
            {isFetching && <Spinner size={14} />}
          </div>

          <div className={styles.results}>
            {query.length < 1 && (
              <p className={styles.hint}>Type to search the classification scheme.</p>
            )}
            {query.length >= 1 && results && results.length === 0 && !isFetching && (
              <p className={styles.hint}>No matches.</p>
            )}
            {(results ?? []).map((c: any) => (
              <button
                key={c.id}
                className={styles.result}
                disabled={c.id === currentId}
                onClick={() => onPick({
                  id: c.id, code: c.code, full_code: c.full_code, name: c.name,
                })}
              >
                <span className={styles.resultCode}>{c.full_code}</span>
                <span className={styles.resultName}>{c.name}</span>
                <span className={styles.resultLevel}>{c.level_name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
