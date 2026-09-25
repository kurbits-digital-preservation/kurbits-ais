import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Flag, Plus, X, Check, Pencil, ChevronDown, User } from 'lucide-react'
import { flagsApi, institutionApi } from '@/api'
import { Spinner } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import styles from './FlagsTab.module.css'

export const FLAG_TYPES = [
  { value: 'metadata',     label: 'Metadata issue',     color: '#7c3aed' },
  { value: 'conservation', label: 'Conservation',        color: '#dc2626' },
  { value: 'digitisation', label: 'Digitisation needed', color: '#d97706' },
  { value: 'rights',       label: 'Rights unclear',      color: '#0891b2' },
  { value: 'access',       label: 'Access review',       color: '#059669' },
  { value: 'duplicate',    label: 'Possible duplicate',  color: '#6b7280' },
  { value: 'other',        label: 'Other',               color: '#9ca3af' },
]

export const SEVERITIES = [
  { value: 'low',    label: 'Low',    color: '#6b7280' },
  { value: 'medium', label: 'Medium', color: '#d97706' },
  { value: 'high',   label: 'High',   color: '#dc2626' },
]

export const STATUSES = [
  { value: 'open',        label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved',    label: 'Resolved' },
]

function getFlagType(value: string) {
  return FLAG_TYPES.find(t => t.value === value) ?? { label: value, color: '#9ca3af' }
}
function getSeverity(value: string) {
  return SEVERITIES.find(s => s.value === value) ?? { label: value, color: '#9ca3af' }
}

// Note: FLAG_TYPES / SEVERITIES / STATUSES are also imported directly by
// FlagsPage.tsx, so their `.label` values stay as-is here; translated
// display text is looked up separately via these key maps.
const STATUS_KEY_MAP: Record<string, string> = { open: 'open', in_progress: 'inProgress', resolved: 'resolved' }

// ─── Flag form ────────────────────────────────────────────────────────

function FlagForm({ nodeId, initial, onSave, onCancel, isSaving }: {
  nodeId: number; initial?: any
  onSave: (data: Record<string, unknown>) => void
  onCancel: () => void; isSaving: boolean
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    flag_type:      initial?.flag_type      ?? 'metadata',
    severity:       initial?.severity       ?? 'medium',
    status:         initial?.status         ?? 'open',
    title:          initial?.title          ?? '',
    body:           initial?.body           ?? '',
    assigned_to_id: initial?.assigned_to_id ?? (null as number | null),
  })
  const [assigneeSearch, setAssigneeSearch] = useState(initial?.assigned_to ?? '')
  const [assigneeOpen, setAssigneeOpen] = useState(false)
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const { data: members = [] } = useQuery({
    queryKey: ['institution-members'],
    queryFn: () => institutionApi.listMembers().then(r => r.data.data),
  })

  const filteredMembers = (members as any[]).filter((m: any) =>
    !assigneeSearch ||
    m.username.toLowerCase().includes(assigneeSearch.toLowerCase()) ||
    (m.email ?? '').toLowerCase().includes(assigneeSearch.toLowerCase())
  )

  return (
    <div className={styles.form}>
      <div className={styles.formRow}>
        <div className="form-group" style={{ flex: 1 }}>
          <label>{t('flags.form.type')}</label>
          <select value={form.flag_type} onChange={set('flag_type')}>
            {FLAG_TYPES.map(ft => <option key={ft.value} value={ft.value}>{t(`flags.types.${ft.value}`)}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ width: 130 }}>
          <label>{t('flags.severity')}</label>
          <select value={form.severity} onChange={set('severity')}>
            {SEVERITIES.map(s => <option key={s.value} value={s.value}>{t(`flags.severityLevels.${s.value}`)}</option>)}
          </select>
        </div>
        {initial && (
          <div className="form-group" style={{ width: 140 }}>
            <label>{t('flags.status')}</label>
            <select value={form.status} onChange={set('status')}>
              {STATUSES.map(s => <option key={s.value} value={s.value}>{t(`flags.${STATUS_KEY_MAP[s.value]}`)}</option>)}
            </select>
          </div>
        )}
      </div>
      <div className="form-group">
        <label>{t('flags.form.title')}</label>
        <input value={form.title} onChange={set('title')}
          placeholder={t('flags.form.titlePlaceholder')} autoFocus={!initial} />
      </div>
      <div className="form-group" style={{ position: 'relative' }}>
        <label>{t('flags.form.assignTo')}</label>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <input
            value={assigneeSearch}
            onChange={e => {
              setAssigneeSearch(e.target.value)
              setAssigneeOpen(true)
              if (!e.target.value) setForm(p => ({ ...p, assigned_to_id: null }))
            }}
            onFocus={() => setAssigneeOpen(true)}
            onBlur={() => setTimeout(() => setAssigneeOpen(false), 150)}
            placeholder={t('flags.form.searchMembersPlaceholder')}
            style={{ flex: 1 }}
          />
          {form.assigned_to_id && (
            <button type="button" className="btn btn-ghost btn-sm btn-icon"
              onClick={() => { setAssigneeSearch(''); setForm(p => ({ ...p, assigned_to_id: null })) }}
              title={t('flags.form.clearAssignee')}>
              <X size={12} />
            </button>
          )}
        </div>
        {assigneeOpen && filteredMembers.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, marginTop: 2,
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden',
          }}>
            <button type="button"
              style={{ display: 'block', width: '100%', padding: '7px var(--space-3)', background: 'none',
                border: 'none', borderBottom: '1px solid var(--color-border)', cursor: 'pointer',
                textAlign: 'left', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)',
                color: 'var(--color-ink-faint)', fontStyle: 'italic' }}
              onMouseDown={() => { setAssigneeSearch(''); setForm(p => ({ ...p, assigned_to_id: null })) }}>
              {t('flags.unassigned')}
            </button>
            {filteredMembers.map((m: any) => (
              <button type="button" key={m.id}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '7px var(--space-3)', background: 'none',
                  border: 'none', borderBottom: '1px solid var(--color-border)', cursor: 'pointer',
                  textAlign: 'left', fontFamily: 'var(--font-sans)', transition: 'background 0.06s',
                  backgroundColor: form.assigned_to_id === m.id ? 'var(--color-accent-bg)' : 'transparent' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-subtle)')}
                onMouseLeave={e => (e.currentTarget.style.background = form.assigned_to_id === m.id ? 'var(--color-accent-bg)' : 'transparent')}
                onMouseDown={() => {
                  setForm(p => ({ ...p, assigned_to_id: m.id }))
                  setAssigneeSearch(m.username)
                  setAssigneeOpen(false)
                }}>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-ink)' }}>
                  {m.username}
                </span>
                {m.email && (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)' }}>
                    {m.email}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {form.assigned_to_id && (
          <span className="form-hint" style={{ color: 'var(--color-accent)' }}>
            <User size={11} style={{ display: 'inline', verticalAlign: 'middle' }} /> {t('flags.form.assignedTo', { name: assigneeSearch })}
          </span>
        )}
      </div>
      <div className="form-group">
        <label>{t('flags.form.notes')}</label>
        <textarea value={form.body} onChange={set('body')} rows={3}
          placeholder={t('flags.form.notesPlaceholder')} />
      </div>
      <div className={styles.formActions}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn btn-primary btn-sm"
          disabled={!form.title.trim() || isSaving}
          onClick={() => onSave({
            ...form,
            assigned_to_id: form.assigned_to_id ? parseInt(String(form.assigned_to_id)) : null,
          })}>
          {isSaving ? <Spinner size={13} /> : <Check size={13} />}
          {initial ? t('resources.form.saveChanges') : t('flags.form.createFlag')}
        </button>
      </div>
    </div>
  )
}

// ─── Flag card ────────────────────────────────────────────────────────

function FlagCard({ flag, nodeId, onChanged }: {
  flag: any; nodeId: number; onChanged: () => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const queryClient = useQueryClient()

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      flagsApi.updateFlag(nodeId, flag.id, data),
    onSuccess: () => { setEditing(false); onChanged() },
  })

  const deleteMutation = useMutation({
    mutationFn: () => flagsApi.deleteFlag(nodeId, flag.id),
    onSuccess: onChanged,
  })

  const quickStatus = (status: string) =>
    updateMutation.mutate({ status })

  const ft = getFlagType(flag.flag_type)
  const sv = getSeverity(flag.severity)
  const isResolved = flag.status === 'resolved'

  if (editing) return (
    <div className={styles.flagCard} style={{ opacity: isResolved ? 0.7 : 1 }}>
      <FlagForm nodeId={nodeId} initial={flag}
        onSave={data => updateMutation.mutate(data)}
        onCancel={() => setEditing(false)} isSaving={updateMutation.isPending} />
    </div>
  )

  return (
    <div className={`${styles.flagCard} ${isResolved ? styles.flagCardResolved : ''}`}>
      <div className={styles.flagHeader}>
        <div className={styles.flagBadges}>
          <span className={styles.flagType} style={{ '--flag-color': ft.color } as any}>
            <Flag size={11} /> {t(`flags.types.${flag.flag_type}`, { defaultValue: ft.label })}
          </span>
          <span className={styles.flagSeverity} style={{ color: sv.color }}>
            {t(`flags.severityLevels.${flag.severity}`, { defaultValue: sv.label })}
          </span>
          <StatusDropdown flag={flag} onUpdate={s => quickStatus(s)} />
        </div>
        <div className={styles.flagActions}>
          {!isResolved && (
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(true)} title={t('common.edit')}>
              <Pencil size={12} />
            </button>
          )}
          <button className="btn btn-ghost btn-sm btn-icon"
            onClick={() => { if (confirm(t('flags.card.deleteConfirm'))) deleteMutation.mutate() }}
            title={t('common.delete')}>
            <X size={12} />
          </button>
        </div>
      </div>
      <div className={styles.flagTitle}>{flag.title}</div>
      {flag.body && <div className={styles.flagBody}>{flag.body}</div>}
      <div className={styles.flagMeta}>
        {flag.assigned_to && (
          <span className={styles.flagAssigned}><User size={11} /> {flag.assigned_to}</span>
        )}
        <span>{flag.created_by} · {new Date(flag.created_at).toLocaleDateString('sv-SE')}</span>
        {flag.resolved_at && (
          <span>· {t('flags.card.resolvedBy', { date: new Date(flag.resolved_at).toLocaleDateString('sv-SE'), name: flag.resolved_by })}</span>
        )}
      </div>
    </div>
  )
}

function StatusDropdown({ flag, onUpdate }: { flag: any; onUpdate: (s: string) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const current = STATUSES.find(s => s.value === flag.status)

  return (
    <div style={{ position: 'relative' }}>
      <button className={styles.statusBtn}
        data-status={flag.status}
        onClick={() => setOpen(v => !v)}>
        {current ? t(`flags.${STATUS_KEY_MAP[current.value]}`) : ''} <ChevronDown size={10} />
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} />
          <div className={styles.statusMenu}>
            {STATUSES.map(s => (
              <button key={s.value} className={styles.statusOption}
                data-active={s.value === flag.status}
                onClick={() => { onUpdate(s.value); setOpen(false) }}>
                {t(`flags.${STATUS_KEY_MAP[s.value]}`)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────

export default function FlagsTab({ nodeId }: { nodeId: number }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [showResolved, setShowResolved] = useState(false)

  const queryKey = ['node-flags', nodeId]
  const { data: flags, isLoading } = useQuery({
    queryKey,
    queryFn: () => flagsApi.getNodeFlags(nodeId).then(r => r.data.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => flagsApi.createFlag(nodeId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      queryClient.invalidateQueries({ queryKey: ['node', nodeId] })
      setAdding(false)
    },
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey })
    queryClient.invalidateQueries({ queryKey: ['node', nodeId] })
  }

  if (isLoading) return <div style={{ padding: 'var(--space-4)' }}><Spinner size={16} /></div>

  const open = (flags ?? []).filter((f: any) => f.status !== 'resolved')
  const resolved = (flags ?? []).filter((f: any) => f.status === 'resolved')

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>
          <Flag size={14} />
          {t('flags.title')}
          {open.length > 0 && <span className={styles.openCount}>{open.length}</span>}
        </div>
        {!adding && (
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
            <Plus size={13} /> {t('flags.panel.addFlag')}
          </button>
        )}
      </div>

      {adding && (
        <FlagForm nodeId={nodeId}
          onSave={data => createMutation.mutate(data)}
          onCancel={() => setAdding(false)}
          isSaving={createMutation.isPending} />
      )}

      {open.length === 0 && !adding && (
        <p className={styles.empty}>{t('flags.noFlags')}</p>
      )}

      {open.map((flag: any) => (
        <FlagCard key={flag.id} flag={flag} nodeId={nodeId} onChanged={refresh} />
      ))}

      {resolved.length > 0 && (
        <button className={styles.showResolved} onClick={() => setShowResolved(v => !v)}>
          {showResolved ? '▾' : '▸'} {t('flags.panel.resolvedCount', { count: resolved.length })}
        </button>
      )}

      {showResolved && resolved.map((flag: any) => (
        <FlagCard key={flag.id} flag={flag} nodeId={nodeId} onChanged={refresh} />
      ))}
    </div>
  )
}