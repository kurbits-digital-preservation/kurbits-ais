import { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Flag, Filter, User, ChevronRight } from 'lucide-react'
import { flagsApi } from '@/api'
import { Spinner } from '@/components/ui'
import { FLAG_TYPES, SEVERITIES, STATUSES } from '@/components/node/FlagsTab'
import styles from './FlagsPage.module.css'

function getFlagType(value: string) {
  return FLAG_TYPES.find(t => t.value === value) ?? { label: value, color: '#9ca3af' }
}
function getSeverity(value: string) {
  return SEVERITIES.find(s => s.value === value) ?? { label: value, color: '#9ca3af' }
}

function FlagRow({ flag, onStatusChange }: {
  flag: any; onStatusChange: (flagId: number, nodeId: number, status: string) => void
}) {
  const navigate = useNavigate()
  const ft = getFlagType(flag.flag_type)
  const sv = getSeverity(flag.severity)

  return (
    <div className={styles.flagRow}>
      <div className={styles.flagMain}>
        <div className={styles.flagBadges}>
          <span className={styles.flagType} style={{ '--flag-color': ft.color } as any}>
            <Flag size={11} /> {ft.label}
          </span>
          <span className={styles.flagSeverity} style={{ color: sv.color }}>{sv.label}</span>
        </div>
        <div className={styles.flagTitle}>{flag.title}</div>
        {flag.body && <div className={styles.flagBody}>{flag.body}</div>}
        <div className={styles.flagMeta}>
          {flag.assigned_to && (
            <span className={styles.flagAssigned}><User size={11} /> {flag.assigned_to}</span>
          )}
          <span>{flag.created_by}</span>
          <span>·</span>
          <span>{new Date(flag.created_at).toLocaleDateString('sv-SE')}</span>
        </div>
      </div>

      <div className={styles.flagRight}>
        {flag.node && (
          <button className={styles.nodeLink}
            onClick={() => navigate(`/app/resources?node=${flag.node_id}`)}>
            <div className={styles.nodeLinkRef}>{flag.node.ref_code}</div>
            <div className={styles.nodeLinkTitle}>{flag.node.title}</div>
            <ChevronRight size={13} />
          </button>
        )}
        <select
          className={styles.statusSelect}
          data-status={flag.status}
          value={flag.status}
          onChange={e => onStatusChange(flag.id, flag.node_id, e.target.value)}
        >
          {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
    </div>
  )
}

export default function FlagsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()

  const status      = searchParams.get('status') ?? ''
  const flagType    = searchParams.get('flag_type') ?? ''
  const severity    = searchParams.get('severity') ?? ''
  const assignedToMe = searchParams.get('assigned_to_me') === 'true'
  const unassigned   = searchParams.get('unassigned') === 'true'
  const page        = parseInt(searchParams.get('page') ?? '1')

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(searchParams)
    if (v) next.set(k, v); else next.delete(k)
    next.set('page', '1')
    setSearchParams(next)
  }

  const { data, isLoading } = useQuery({
    queryKey: ['flags-overview', status, flagType, severity, assignedToMe, unassigned, page],
    queryFn: () => flagsApi.listAll({
      status: status || undefined,
      flag_type: flagType || undefined,
      severity: severity || undefined,
      assigned_to_me: assignedToMe || undefined,
      unassigned: unassigned || undefined,
      page,
    }).then(r => r.data.data),
  })

  const updateMutation = useMutation({
    mutationFn: ({ nodeId, flagId, status }: { nodeId: number; flagId: number; status: string }) =>
      flagsApi.updateFlag(nodeId, flagId, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flags-overview'] })
    },
  })

  const flags: any[] = data?.flags ?? []
  const total: number = data?.total ?? 0
  const pages: number = data?.pages ?? 0

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}><Flag size={20} /> Flags</h1>
          <p className={styles.desc}>Review and manage flagged records across the institution.</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className={styles.filterBar}>
        <Filter size={14} style={{ color: 'var(--color-ink-faint)', flexShrink: 0 }} />

        <select value={status} onChange={e => setParam('status', e.target.value)}
          className={styles.filterSelect}>
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Resolved</option>
        </select>

        <select value={flagType} onChange={e => setParam('flag_type', e.target.value)}
          className={styles.filterSelect}>
          <option value="">All types</option>
          {FLAG_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        <select value={severity} onChange={e => setParam('severity', e.target.value)}
          className={styles.filterSelect}>
          <option value="">All severities</option>
          {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <label className={styles.assignedMe}>
          <input type="checkbox" checked={assignedToMe}
            onChange={e => {
              const next = new URLSearchParams(searchParams)
              if (e.target.checked) { next.set('assigned_to_me', 'true'); next.delete('unassigned') }
              else next.delete('assigned_to_me')
              next.set('page', '1'); setSearchParams(next)
            }} />
          Assigned to me
        </label>
        <label className={styles.assignedMe}>
          <input type="checkbox" checked={unassigned}
            onChange={e => {
              const next = new URLSearchParams(searchParams)
              if (e.target.checked) { next.set('unassigned', 'true'); next.delete('assigned_to_me') }
              else next.delete('unassigned')
              next.set('page', '1'); setSearchParams(next)
            }} />
          Unassigned
        </label>

        <span className={styles.totalCount}>
          {isLoading ? <Spinner size={13} /> : `${total} flag${total !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* List */}
      {isLoading ? (
        <div className={styles.loading}><Spinner size={20} /></div>
      ) : flags.length === 0 ? (
        <div className={styles.empty}>
          <Flag size={36} style={{ opacity: 0.15, marginBottom: 'var(--space-3)' }} />
          <p>No flags matching the current filters.</p>
        </div>
      ) : (
        <div className={styles.list}>
          {flags.map(flag => (
            <FlagRow
              key={flag.id}
              flag={flag}
              onStatusChange={(flagId, nodeId, status) =>
                updateMutation.mutate({ flagId, nodeId, status })
              }
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className={styles.pagination}>
          <button className="btn btn-ghost btn-sm" disabled={page <= 1}
            onClick={() => setParam('page', String(page - 1))}>← Prev</button>
          <span className={styles.pageInfo}>Page {page} of {pages}</span>
          <button className="btn btn-ghost btn-sm" disabled={page >= pages}
            onClick={() => setParam('page', String(page + 1))}>Next →</button>
        </div>
      )}
    </div>
  )
}