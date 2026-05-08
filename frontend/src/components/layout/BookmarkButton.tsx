import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import { historyApi } from '@/api'
import styles from './BookmarkButton.module.css'

interface Props {
  entityType: 'node' | 'agent'
  entityId: number
  title: string
  subtitle?: string
}

export default function BookmarkButton({ entityType, entityId, title, subtitle }: Props) {
  const queryClient = useQueryClient()

  // Track as recent when this mounts (i.e. when the user opens the record)
  useEffect(() => {
    historyApi.trackRecent({ entity_type: entityType, entity_id: entityId, title, subtitle })
      .then(() => queryClient.invalidateQueries({ queryKey: ['recent'] }))
  }, [entityType, entityId])

  const { data } = useQuery({
    queryKey: ['bookmark-check', entityType, entityId],
    queryFn: () => historyApi.checkBookmark(entityType, entityId).then(r => r.data.data),
  })

  const bookmarked = data?.bookmarked ?? false

  const toggleMutation = useMutation({
    mutationFn: () => bookmarked
      ? historyApi.removeBookmark(entityType, entityId)
      : historyApi.addBookmark({ entity_type: entityType, entity_id: entityId, title, subtitle }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookmark-check', entityType, entityId] })
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] })
    },
  })

  return (
    <button
      className={`${styles.btn} ${bookmarked ? styles.active : ''}`}
      onClick={() => toggleMutation.mutate()}
      title={bookmarked ? 'Remove bookmark' : 'Bookmark'}
      disabled={toggleMutation.isPending}
    >
      <Star size={14} fill={bookmarked ? 'currentColor' : 'none'} />
    </button>
  )
}