import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users, Settings, Shield, Pencil, Trash2, BookOpen, Layers,
  X, Save, Plus, ChevronDown, Check, AlertCircle,
  UserPlus, Building2,Link
} from 'lucide-react'
import { institutionApi } from '@/api'
import { useAuthStore } from '@/store/auth'
import { Spinner, Tabs } from '@/components/ui'
import styles from './InstitutionAdminPage.module.css'
import VocabulariesTab from './VocabulariesTab'
import HierarchyTab from './HierarchyTab'
import MetadataTemplatesPage from './MetadataTemplatesPage'
import IntegrationsTab from './IntegrationsTab'
import AIConfigTab from './AIConfigTab'
import { Bot } from 'lucide-react'
// ─── Constants ────────────────────────────────────────────────────────

const ROLES = [
  { value: 'institution_admin', label: 'Admin',     desc: 'Full institution management' },
  { value: 'archivist',         label: 'Archivist', desc: 'Create and edit descriptions' },
  { value: 'read_only',         label: 'Read only', desc: 'View internal records only' },
]

const ROLE_LABELS: Record<string, string> = {
  institution_admin: 'Admin',
  archivist:         'Archivist',
  read_only:         'Read only',
  system_admin:      'System admin',
}

// ─── Role picker dropdown ─────────────────────────────────────────────

function RolePicker({
  currentRole,
  userId,
  institutionId,
  disabled,
}: {
  currentRole: string
  userId: number
  institutionId: number
  disabled?: boolean
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const mutation = useMutation({
    mutationFn: (role: string) =>
      institutionApi.updateMemberRole(institutionId, userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['institution-members'] })
      setOpen(false)
    },
  })

  if (disabled) {
    return (
      <span className={styles.roleStatic}>
        {ROLE_LABELS[currentRole] ?? currentRole}
      </span>
    )
  }

  return (
    <div className={styles.rolePicker}>
      <button
        className={styles.rolePickerBtn}
        onClick={() => setOpen(v => !v)}
      >
        {ROLE_LABELS[currentRole] ?? currentRole}
        <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <div className={styles.rolePickerBackdrop} onClick={() => setOpen(false)} />
          <div className={styles.rolePickerMenu}>
            {ROLES.map(role => (
              <button
                key={role.value}
                className={styles.rolePickerOption}
                onClick={() => mutation.mutate(role.value)}
                disabled={mutation.isPending}
              >
                <div className={styles.rolePickerOptionMain}>
                  <span className={styles.rolePickerOptionLabel}>{role.label}</span>
                  <span className={styles.rolePickerOptionDesc}>{role.desc}</span>
                </div>
                {currentRole === role.value && <Check size={13} className={styles.roleCheckmark} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Members tab ──────────────────────────────────────────────────────

function MembersTab({ institution }: { institution: any }) {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const [inviting, setInviting] = useState(false)
  const [form, setForm] = useState({
    username: '', email: '', password: '', role: 'archivist'
  })
  const [formError, setFormError] = useState('')

  const { data: members, isLoading } = useQuery({
    queryKey: ['institution-members'],
    queryFn: () => institutionApi.listMembers().then(r => r.data.data),
  })

  const inviteMutation = useMutation({
    mutationFn: () => institutionApi.inviteUser(form as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['institution-members'] })
      setInviting(false)
      setForm({ username: '', email: '', password: '', role: 'archivist' })
      setFormError('')
    },
    onError: (err: any) => {
      setFormError(err.response?.data?.message ?? 'Failed to create user')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (userId: number) => institutionApi.removeMember(institution.id, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['institution-members'] }),
  })

  if (isLoading) return <div className={styles.loading}><Spinner /></div>

  return (
    <div className={styles.tabContent}>
      <div className={styles.membersHeader}>
        <p className={styles.memberCount}>
          {members?.length ?? 0} member{members?.length !== 1 ? 's' : ''}
        </p>
        <button className="btn btn-primary btn-sm" onClick={() => setInviting(v => !v)}>
          <UserPlus size={14} /> Add user
        </button>
      </div>

      {inviting && (
        <div className={styles.inviteForm}>
          <div className={styles.inviteFormTitle}>
            <UserPlus size={15} /> Create new user
          </div>
          {formError && (
            <div className={styles.formError}>
              <AlertCircle size={14} /> {formError}
            </div>
          )}
          <div className={styles.inviteGrid}>
            <div className="form-group">
              <label>Username *</label>
              <input
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="e.g. jsmith"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Email *</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="user@institution.org"
              />
            </div>
            <div className="form-group">
              <label>Password *</label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Temporary password"
              />
            </div>
            <div className="form-group">
              <label>Role *</label>
              <select
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              >
                {ROLES.map(r => (
                  <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>
                ))}
              </select>
            </div>
          </div>
          <div className={styles.inviteFormActions}>
            <button className="btn btn-ghost btn-sm" onClick={() => {
              setInviting(false); setFormError('')
            }}>
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={!form.username || !form.email || !form.password || inviteMutation.isPending}
              onClick={() => inviteMutation.mutate()}
            >
              {inviteMutation.isPending ? <Spinner size={13} /> : <UserPlus size={13} />}
              Create user
            </button>
          </div>
        </div>
      )}

      <div className={styles.memberList}>
        {members?.map((member: any) => {
          const isSelf = member.id === user?.id
          const isSystemAdmin = member.is_system_admin

          return (
            <div key={member.id} className={styles.memberRow}>
              <div className={styles.memberAvatar}>
                {member.username[0].toUpperCase()}
              </div>
              <div className={styles.memberInfo}>
                <div className={styles.memberName}>
                  {member.username}
                  {isSelf && <span className={styles.youBadge}>you</span>}
                  {!member.is_active && <span className={styles.inactiveBadge}>inactive</span>}
                </div>
                <span className={styles.memberEmail}>{member.email}</span>
                {member.last_login && (
                  <span className={styles.memberLastLogin}>
                    Last login: {new Date(member.last_login).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className={styles.memberActions}>
                <RolePicker
                  currentRole={isSystemAdmin ? 'system_admin' : member.role}
                  userId={member.id}
                  institutionId={institution.id}
                  disabled={isSelf || isSystemAdmin}
                />
                {!isSelf && !isSystemAdmin && (
                  <button
                    className="btn btn-ghost btn-sm btn-icon"
                    title="Remove from institution"
                    onClick={() => {
                      if (confirm(`Remove ${member.username} from ${institution.name}?`)) {
                        removeMutation.mutate(member.id)
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Settings tab ─────────────────────────────────────────────────────

function SettingsTab({ institution }: { institution: any }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name:             institution.name,
    country_code:     institution.country_code,
    institution_code: institution.institution_code,
    description:      institution.description ?? '',
    website:          institution.website ?? '',
  })
  const [saved, setSaved] = useState(false)

  const set = (field: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))

  const mutation = useMutation({
    mutationFn: () => institutionApi.updateCurrent(form as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['institution-current'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  return (
    <div className={styles.tabContent}>
      <div className={styles.settingsSection}>
        <h3 className={styles.settingsSectionTitle}>Institution details</h3>

        <div className={styles.settingsGrid}>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>Institution name</label>
            <input value={form.name} onChange={set('name')} />
          </div>

          <div className="form-group">
            <label>Country code</label>
            <input
              value={form.country_code}
              onChange={set('country_code')}
              placeholder="e.g. SE, GB, US"
              maxLength={10}
            />
            <span className="form-hint">
              Used in reference codes — e.g. <strong>{form.country_code.toUpperCase() || 'SE'}-{form.institution_code.toUpperCase() || 'DEMO'}/A1</strong>
            </span>
          </div>

          <div className="form-group">
            <label>Institution code</label>
            <input
              value={form.institution_code}
              onChange={set('institution_code')}
              placeholder="e.g. GCA, PRO, NAL"
              maxLength={50}
            />
          </div>

          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>Description</label>
            <textarea
              value={form.description}
              onChange={set('description')}
              rows={3}
              placeholder="Brief description of the institution…"
            />
          </div>

          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>Website</label>
            <input
              type="url"
              value={form.website}
              onChange={set('website')}
              placeholder="https://…"
            />
          </div>
        </div>

        <div className={styles.settingsActions}>
          <button
            className="btn btn-primary"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? <Spinner size={14} /> : <Save size={14} />}
            {saved ? 'Saved!' : 'Save changes'}
          </button>
        </div>
      </div>

      <div className={styles.settingsSection}>
        <h3 className={styles.settingsSectionTitle}>Roles reference</h3>
        <div className={styles.rolesTable}>
          {ROLES.map(role => (
            <div key={role.value} className={styles.roleRow}>
              <span className={styles.roleLabel}>{role.label}</span>
              <span className={styles.roleDesc}>{role.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────


// ─── Templates tab ───────────────────────────────────────────────────

function TemplatesTab() {
  return <MetadataTemplatesPage />
}

export default function InstitutionAdminPage() {
  const { user } = useAuthStore()
  const [tab, setTab] = useState('members')

  const { data: institution, isLoading } = useQuery({
    queryKey: ['institution-current'],
    queryFn: () => institutionApi.getCurrent().then(r => r.data.data),
  })

  const isAdmin = user?.active_institution
    ? ['institution_admin', 'system_admin'].includes(
        user.active_institution.role ?? ''
      ) || user.is_system_admin
    : false

  if (isLoading) {
    return <div className={styles.loading}><Spinner /></div>
  }

  if (!institution) {
    return (
      <div className={styles.noAccess}>
        <AlertCircle size={28} />
        <p>No active institution selected.</p>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className={styles.noAccess}>
        <Shield size={28} />
        <p>Institution admin access required.</p>
      </div>
    )
  }

  const tabs = [
    { key: 'members',     icon: <Users size={14} />,    label: `Members (${institution.member_count})` },
    { key: 'settings',    icon: <Settings size={14} />, label: 'Settings' },
    { key: 'vocabularies', icon: <BookOpen size={14} />, label: 'Vocabularies' },
    { key: 'hierarchies',  icon: <Layers size={14} />,   label: 'Hierarchies' },
    { key: 'templates',    icon: <Layers size={14} />,   label: 'Field templates' },
    { key: 'integrations', icon: <Link size={14} />, label: 'Integrations' },
    { key: 'ai', icon: <Bot size={14} />, label: 'AI' },
  ]

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.institutionIcon}>
            <Building2 size={20} />
          </div>
          <div>
            <h1 className={styles.institutionName}>{institution.name}</h1>
            <span className={styles.refPrefix}>{institution.ref_prefix}</span>
          </div>
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className={styles.body}>
        {tab === 'members'      && <MembersTab institution={institution} />}
        {tab === 'settings'     && <SettingsTab institution={institution} />}
        {tab === 'vocabularies' && <VocabulariesTab />}
        {tab === 'hierarchies'  && <HierarchyTab />}
        {tab === 'templates'    && <TemplatesTab />}
        {tab === 'integrations' && <IntegrationsTab />}
        {tab === 'ai' && <AIConfigTab />}
      </div>
    </div>
  )
}