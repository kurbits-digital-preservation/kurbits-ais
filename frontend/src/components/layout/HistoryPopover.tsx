import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, Star, FileText, User, Building2, UsersRound, Bot, Trash2 } from 'lucide-react'
import { historyApi } from '@/api'
import { Spinner } from '@/components/ui'
import styles from './HistoryPopover.module.css'

const AGENT_ICONS: Record<string, typeof User> = {
  person: User, organization: Building2, family: UsersRound, software: Bot,
}

function EntityIcon({ entityType, subtitle }: { entityType: string; subtitle?: string }) {
  if (entityType === 'node') return <FileText size={13} />
  const Icon = AGENT_ICONS[subtitle ?? ''] ?? User
  return <Icon size={13} />
}

function ItemRow({ item, onClick }: { item: any; onClick: () => void }) {
  return (
    <button className={styles.item} onClick={onClick}>
      <span className={styles.itemIcon}>
        <EntityIcon entityType={item.entity_type} subtitle={item.subtitle} />
      </span>
      <span className={styles.itemBody}>
        <span className={styles.itemTitle}>{item.title}</span>
        {item.subtitle && <span className={styles.itemSub}>{item.subtitle}</span>}
      </span>
    </button>
  )
}

export default function HistoryPopover() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'recent' | 'bookmarks'>('recent')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const { data: recent = [], isFetching: recentFetching } = useQuery({
    queryKey: ['recent'],
    queryFn: () => historyApi.listRecent().then(r => r.data.data),
    enabled: open,
    staleTime: 0,
  })

  const { data: bookmarks = [], isFetching: bookmarksFetching } = useQuery({
    queryKey: ['bookmarks'],
    queryFn: () => historyApi.listBookmarks().then(r => r.data.data),
    enabled: open,
    staleTime: 0,
  })

  const handleNavigate = (item: any) => {
    setOpen(false)
    if (item.entity_type === 'node') {
      navigate('/app/resources', { state: { selectNodeId: item.entity_id } })
    } else {
      navigate('/app/agents', { state: { selectAgentId: item.entity_id } })
    }
  }

  const handleRemoveBookmark = (e: React.MouseEvent, item: any) => {
    e.stopPropagation()
    historyApi.removeBookmark(item.entity_type, item.entity_id).then(() => {
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] })
      queryClient.invalidateQueries({ queryKey: ['bookmark-check', item.entity_type, item.entity_id] })
    })
  }

  const items = tab === 'recent' ? recent : bookmarks
  const fetching = tab === 'recent' ? recentFetching : bookmarksFetching

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        className={`${styles.trigger} ${open ? styles.triggerActive : ''}`}
        onClick={() => setOpen(v => !v)}
        title="Recent & bookmarks"
      >
        <Clock size={14} />
      </button>

      {open && (
        <div className={styles.popover}>
          <div className={styles.tabs}>
            <button
              className={`${styles.tabBtn} ${tab === 'recent' ? styles.tabBtnActive : ''}`}
              onClick={() => setTab('recent')}
            >
              <Clock size={12} /> Recent
            </button>
            <button
              className={`${styles.tabBtn} ${tab === 'bookmarks' ? styles.tabBtnActive : ''}`}
              onClick={() => setTab('bookmarks')}
            >
              <Star size={12} /> Bookmarks
            </button>
          </div>

          <div className={styles.list}>
            {fetching && (
              <div className={styles.empty}><Spinner size={14} /></div>
            )}
            {!fetching && items.length === 0 && (
              <div className={styles.empty}>
                {tab === 'recent' ? 'No recently viewed items' : 'No bookmarks yet'}
              </div>
            )}
            {!fetching && items.map((item: any) => (
              <div key={item.id} className={styles.itemWrap}>
                <ItemRow item={item} onClick={() => handleNavigate(item)} />
                {tab === 'bookmarks' && (
                  <button
                    className={styles.removeBtn}
                    onClick={e => handleRemoveBookmark(e, item)}
                    title="Remove bookmark"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}