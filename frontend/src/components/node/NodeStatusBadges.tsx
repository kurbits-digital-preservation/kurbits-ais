import { Archive, Globe, Lock, ShieldAlert } from 'lucide-react'
import type { NodeState } from '@/types'
import { useTranslation } from 'react-i18next'

const SIZES = {
  sm: { fontSize: undefined, padding: undefined, icon: 10 },
  xs: { fontSize: '10px', padding: '1px 5px', icon: 9 },
} as const

export default function NodeStatusBadges({
  node,
  showPortal = false,
  size = 'sm',
}: {
  node: Partial<NodeState>
  showPortal?: boolean
  size?: keyof typeof SIZES
}) {
  const { t } = useTranslation()
  const s = SIZES[size]
  const style = { fontSize: s.fontSize, padding: s.padding }

  return (
    <>
      {node.description_status === 'draft' && (
        <span className="badge badge-draft" style={style}>
          <Archive size={s.icon} /> {t('resources.descriptionStatus.draft')}
        </span>
      )}
      {node.access_status === 'review' && (
        <span className="badge badge-review" style={style}>
          <ShieldAlert size={s.icon} /> {t('resources.accessShort.review')}
        </span>
      )}
      {node.access_status === 'restricted' && (
        <span className="badge badge-restricted" style={style}>
          <Lock size={s.icon} /> {t('resources.accessShort.restricted')}
        </span>
      )}
      {showPortal && node.portal_published && (
        <span className="badge badge-published" style={style}>
          <Globe size={s.icon} /> {t('resources.portal.published')}
        </span>
      )}
    </>
  )
}