import { useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Archive, CheckCircle2, Globe, ShieldCheck, ShieldAlert, Lock,
  ChevronDown, Check, AlertCircle,
} from 'lucide-react'
import { nodesApi } from '@/api'
import type { AccessStatus, DescriptionStatus, NodeDetail } from '@/types'
import { Spinner } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import styles from './NodeStatusPanel.module.css'

type MenuKey = 'description' | 'portal' | 'access' | null
type Tone = 'neutral' | 'good' | 'info' | 'warn' | 'danger'

const ACCESS_STATUSES: AccessStatus[] = ['open', 'review', 'restricted']

const ACCESS_ICON: Record<AccessStatus, typeof ShieldCheck> = {
  open: ShieldCheck,
  review: ShieldAlert,
  restricted: Lock,
}
const ACCESS_TONE: Record<AccessStatus, Tone> = {
  open: 'neutral',
  review: 'warn',
  restricted: 'danger',
}

const errorText = (err: unknown, fallback: string) =>
  (err as any)?.response?.data?.message ?? fallback

// ─── Chip with dropdown ───────────────────────────────────────────────

function StatusChip({
  icon, label, tone, title, open, onToggle, children,
}: {
  icon: ReactNode
  label: string
  tone: Tone
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className={styles.chipWrap}>
      <button
        type="button"
        className={`${styles.chip} ${styles[tone]} ${open ? styles.chipOpen : ''}`}
        onClick={onToggle}
        title={title}
      >
        {icon}
        <span>{label}</span>
        <ChevronDown size={11} className={styles.chevron} />
      </button>
      {open && (
        <>
          <div className={styles.backdrop} onClick={onToggle} />
          <div className={styles.menu}>{children}</div>
        </>
      )}
    </div>
  )
}

function MenuItem({
  label, hint, active, disabled, onClick,
}: {
  label: string
  hint?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className={styles.menuItem} disabled={disabled} onClick={onClick}>
      <span className={styles.menuCheck}>{active && <Check size={12} />}</span>
      <span className={styles.menuText}>
        <span>{label}</span>
        {hint && <span className={styles.menuHint}>{hint}</span>}
      </span>
    </button>
  )
}

// ─── Access form (inside the access menu) ────────────────────────────

function AccessForm({
  node, onSaved,
}: {
  node: NodeDetail
  onSaved: (updated: number) => void
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<AccessStatus>(node.access_status)
  const [basis, setBasis] = useState(node.access_basis ?? '')
  const [until, setUntil] = useState(node.access_restricted_until ?? '')
  const [applyToDescendants, setApplyToDescendants] = useState(false)

  const mutation = useMutation({
    mutationFn: () => nodesApi.setAccess(node.id, {
      access_status: status,
      access_basis: status === 'open' ? null : basis,
      access_restricted_until: status === 'open' ? null : (until || null),
      apply_to_descendants: applyToDescendants,
    }),
    onSuccess: res => onSaved(res.data.meta?.updated ?? 1),
  })

  const isOpen = status === 'open'

  return (
    <div className={styles.form}>
      <div className={styles.segment}>
        {ACCESS_STATUSES.map(s => (
          <button
            key={s}
            type="button"
            className={`${styles.segmentBtn} ${status === s ? styles.segmentActive : ''}`}
            onClick={() => setStatus(s)}
          >
            {t(`resources.access.${s}`)}
          </button>
        ))}
      </div>

      {!isOpen && (
        <>
          <input
            value={basis}
            onChange={e => setBasis(e.target.value)}
            placeholder={t('resources.statusPanel.accessBasisPlaceholder')}
            aria-label={t('resources.statusPanel.accessBasis')}
          />
          <label className={styles.inlineField}>
            <span>{t('resources.statusPanel.accessUntil')}</span>
            <input type="date" value={until} onChange={e => setUntil(e.target.value)} />
          </label>
        </>
      )}

      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={applyToDescendants}
          onChange={e => setApplyToDescendants(e.target.checked)}
        />
        {t('resources.statusPanel.applyToDescendants')}
      </label>

      {mutation.error && (
        <div className={styles.error}>
          <AlertCircle size={12} /> {errorText(mutation.error, t('resources.form.genericError'))}
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
      >
        {mutation.isPending && <Spinner size={12} />} {t('common.save')}
      </button>
    </div>
  )
}

// ─── Controls ─────────────────────────────────────────────────────────

export default function NodeStatusPanel({ node }: { node: NodeDetail }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState<MenuKey>(null)
  const [flash, setFlash] = useState<{ text: string; error?: boolean } | null>(null)

  const toggle = (key: MenuKey) => () => setOpen(prev => (prev === key ? null : key))

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['node', node.id] })
    queryClient.invalidateQueries({ queryKey: ['node-tree'] })
    queryClient.invalidateQueries({ queryKey: ['node-children'] })
    queryClient.invalidateQueries({ queryKey: ['node-children-list'] })
    queryClient.invalidateQueries({ queryKey: ['node-history', node.id] })
  }

  const showFlash = (text: string | null, error = false) => {
    setFlash(text ? { text, error } : null)
    if (text) setTimeout(() => setFlash(null), 5000)
  }

  const done = (message: string | null = null) => {
    setOpen(null)
    showFlash(message)
    refresh()
  }

  const onError = (err: unknown) => {
    setOpen(null)
    showFlash(errorText(err, t('resources.form.genericError')), true)
  }

  const descriptionMutation = useMutation({
    mutationFn: (status: DescriptionStatus) => nodesApi.setDescriptionStatus(node.id, status),
    onSuccess: () => done(),
    onError,
  })

  const publishMutation = useMutation({
    mutationFn: (withDescendants: boolean) => nodesApi.publish(node.id, withDescendants),
    onSuccess: (res, withDescendants) => {
      const meta = res.data.meta
      done(withDescendants
        ? t('resources.statusPanel.publishResult', { published: meta?.published ?? 0, skipped: meta?.skipped ?? 0 })
        : null)
    },
    onError,
  })

  const unpublishMutation = useMutation({
    mutationFn: () => nodesApi.unpublish(node.id),
    onSuccess: res => {
      const count = res.data.meta?.unpublished ?? 0
      done(count > 1 ? t('resources.statusPanel.unpublishResult', { count }) : null)
    },
    onError,
  })

  const busy = descriptionMutation.isPending || publishMutation.isPending || unpublishMutation.isPending
  const isFinal = node.description_status === 'final'
  const AccessIcon = ACCESS_ICON[node.access_status]
  const accessLabel = node.access_status === 'open'
    ? t('resources.access.open')
    : t(`resources.accessShort.${node.access_status}`)

  return (
    <div className={styles.wrap}>
      <div className={styles.chips}>
        {/* Description status */}
        <StatusChip
          icon={isFinal ? <CheckCircle2 size={12} /> : <Archive size={12} />}
          label={t(`resources.descriptionStatus.${node.description_status}`)}
          tone={isFinal ? 'good' : 'neutral'}
          title={t('resources.statusPanel.description')}
          open={open === 'description'}
          onToggle={toggle('description')}
        >
          <MenuItem
            label={t('resources.descriptionStatus.draft')}
            hint={node.portal_published ? t('resources.statusPanel.draftNeedsUnpublish') : undefined}
            active={!isFinal}
            disabled={busy || !isFinal || node.portal_published}
            onClick={() => descriptionMutation.mutate('draft')}
          />
          <MenuItem
            label={t('resources.descriptionStatus.final')}
            active={isFinal}
            disabled={busy || isFinal}
            onClick={() => descriptionMutation.mutate('final')}
          />
        </StatusChip>

        {/* Portal */}
        <StatusChip
          icon={<Globe size={12} />}
          label={node.portal_published ? t('resources.portal.published') : t('resources.portal.notPublished')}
          tone={node.portal_published ? 'info' : 'neutral'}
          title={node.portal_published && node.portal_published_at
            ? t('resources.portal.publishedAt', { date: new Date(node.portal_published_at).toLocaleDateString() })
            : t('resources.statusPanel.portal')}
          open={open === 'portal'}
          onToggle={toggle('portal')}
        >
          {node.portal_published ? (
            <>
              <MenuItem
                label={t('resources.statusPanel.publishDescendants')}
                disabled={busy}
                onClick={() => publishMutation.mutate(true)}
              />
              <MenuItem
                label={t('resources.statusPanel.unpublish')}
                hint={t('resources.statusPanel.unpublishHint')}
                disabled={busy}
                onClick={() => { if (confirm(t('resources.statusPanel.unpublishConfirm'))) unpublishMutation.mutate() }}
              />
            </>
          ) : (
            <>
              <MenuItem
                label={t('resources.statusPanel.publish')}
                hint={!isFinal ? t('resources.statusPanel.publishNeedsFinal') : undefined}
                disabled={busy || !isFinal}
                onClick={() => publishMutation.mutate(false)}
              />
              <MenuItem
                label={t('resources.statusPanel.publishWithDescendants')}
                disabled={busy || !isFinal}
                onClick={() => publishMutation.mutate(true)}
              />
            </>
          )}
        </StatusChip>

        {/* Access */}
        <StatusChip
          icon={<AccessIcon size={12} />}
          label={accessLabel}
          tone={ACCESS_TONE[node.access_status]}
          title={[
            t(`resources.access.${node.access_status}`),
            node.access_basis,
            node.access_restricted_until && t('resources.statusPanel.until', { date: node.access_restricted_until }),
          ].filter(Boolean).join(' · ')}
          open={open === 'access'}
          onToggle={toggle('access')}
        >
          <AccessForm
            node={node}
            onSaved={updated => done(updated > 1 ? t('resources.statusPanel.accessUpdated', { count: updated }) : null)}
          />
        </StatusChip>
      </div>

      {node.portal_published && node.access_status !== 'open' && (
        <span className={styles.note} title={t('resources.statusPanel.filesNotPublished')}>
          <AlertCircle size={11} /> {t('resources.statusPanel.filesNotPublishedShort')}
        </span>
      )}
      {flash && (
        <span className={flash.error ? styles.flashError : styles.flash}>
          {flash.error ? <AlertCircle size={11} /> : <Check size={11} />} {flash.text}
        </span>
      )}
    </div>
  )
}