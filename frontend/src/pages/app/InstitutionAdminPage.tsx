import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users, Settings, Shield, Pencil, Trash2, BookOpen, Layers,
  X, Save, Plus, ChevronDown, Check, AlertCircle,
  UserPlus, Building2, Link, Mic, Fingerprint, ListChecks, Printer
} from 'lucide-react'
import { institutionApi, portalApi } from '@/api'
import { useAuthStore } from '@/store/auth'
import { Spinner, Tabs } from '@/components/ui'
import styles from './InstitutionAdminPage.module.css'
import VocabulariesTab from './VocabulariesTab'
import HierarchyTab from './HierarchyTab'
import MetadataTemplatesPage from './MetadataTemplatesPage'
import IntegrationsTab from './IntegrationsTab'
import WhisperConfigTab from './WhisperConfigTab'
import IdentifierSchemesTab from './IdentifierSchemesTab'
import RecordsVocabularyTab from './RecordsVocabularyTab'
import LabelDesigner from './LabelDesigner'
import { Zap, RefreshCw, Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'

// ─── Constants ────────────────────────────────────────────────────────

const ROLE_VALUES = ['institution_admin', 'archivist', 'read_only']
const ROLE_KEY_MAP: Record<string, string> = {
  institution_admin: 'admin', archivist: 'archivist', read_only: 'readOnly', system_admin: 'systemAdmin',
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
  const { t } = useTranslation()
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
        {ROLE_KEY_MAP[currentRole] ? t(`admin.roles.${ROLE_KEY_MAP[currentRole]}`) : currentRole}
      </span>
    )
  }

  return (
    <div className={styles.rolePicker}>
      <button
        className={styles.rolePickerBtn}
        onClick={() => setOpen(v => !v)}
      >
        {ROLE_KEY_MAP[currentRole] ? t(`admin.roles.${ROLE_KEY_MAP[currentRole]}`) : currentRole}
        <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <div className={styles.rolePickerBackdrop} onClick={() => setOpen(false)} />
          <div className={styles.rolePickerMenu}>
            {ROLE_VALUES.map(roleValue => (
              <button
                key={roleValue}
                className={styles.rolePickerOption}
                onClick={() => mutation.mutate(roleValue)}
                disabled={mutation.isPending}
              >
                <div className={styles.rolePickerOptionMain}>
                  <span className={styles.rolePickerOptionLabel}>{t(`admin.roles.${ROLE_KEY_MAP[roleValue]}`)}</span>
                  <span className={styles.rolePickerOptionDesc}>{t(`admin.roles.${ROLE_KEY_MAP[roleValue]}Desc`)}</span>
                </div>
                {currentRole === roleValue && <Check size={13} className={styles.roleCheckmark} />}
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
  const { t } = useTranslation()
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
      setFormError(err.response?.data?.message ?? t('admin.members.createFailed'))
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
          {t('admin.members.countLabel', { count: members?.length ?? 0 })}
        </p>
        <button className="btn btn-primary btn-sm" onClick={() => setInviting(v => !v)}>
          <UserPlus size={14} /> {t('admin.members.addUser')}
        </button>
      </div>

      {inviting && (
        <div className={styles.inviteForm}>
          <div className={styles.inviteFormTitle}>
            <UserPlus size={15} /> {t('admin.members.createNewUser')}
          </div>
          {formError && (
            <div className={styles.formError}>
              <AlertCircle size={14} /> {formError}
            </div>
          )}
          <div className={styles.inviteGrid}>
            <div className="form-group">
              <label>{t('admin.members.username')}</label>
              <input
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder={t('admin.members.usernamePlaceholder')}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>{t('admin.members.email')}</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder={t('admin.members.emailPlaceholder')}
              />
            </div>
            <div className="form-group">
              <label>{t('admin.members.password')}</label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder={t('admin.members.passwordPlaceholder')}
              />
            </div>
            <div className="form-group">
              <label>{t('admin.members.role')}</label>
              <select
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              >
                {ROLE_VALUES.map(r => (
                  <option key={r} value={r}>{t(`admin.roles.${ROLE_KEY_MAP[r]}`)} — {t(`admin.roles.${ROLE_KEY_MAP[r]}Desc`)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className={styles.inviteFormActions}>
            <button className="btn btn-ghost btn-sm" onClick={() => {
              setInviting(false); setFormError('')
            }}>
              {t('common.cancel')}
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={!form.username || !form.email || !form.password || inviteMutation.isPending}
              onClick={() => inviteMutation.mutate()}
            >
              {inviteMutation.isPending ? <Spinner size={13} /> : <UserPlus size={13} />}
              {t('admin.members.createUser')}
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
                  {isSelf && <span className={styles.youBadge}>{t('admin.members.you')}</span>}
                  {!member.is_active && <span className={styles.inactiveBadge}>{t('admin.members.inactive')}</span>}
                </div>
                <span className={styles.memberEmail}>{member.email}</span>
                {member.last_login && (
                  <span className={styles.memberLastLogin}>
                    {t('admin.members.lastLogin', { date: new Date(member.last_login).toLocaleDateString() })}
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
                    title={t('admin.members.removeFromInstitution')}
                    onClick={() => {
                      if (confirm(t('admin.members.removeConfirm', { username: member.username, institution: institution.name }))) {
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
  const { t } = useTranslation()
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
        <h3 className={styles.settingsSectionTitle}>{t('admin.settings.institutionDetails')}</h3>

        <div className={styles.settingsGrid}>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>{t('admin.settings.institutionName')}</label>
            <input value={form.name} onChange={set('name')} />
          </div>

          <div className="form-group">
            <label>{t('admin.settings.countryCode')}</label>
            <input
              value={form.country_code}
              onChange={set('country_code')}
              placeholder="e.g. SE, GB, US"
              maxLength={10}
            />
            <span className="form-hint">
              {t('admin.settings.refCodeHintPrefix')}{' '}
              <strong>{form.country_code.toUpperCase() || 'SE'}-{form.institution_code.toUpperCase() || 'DEMO'}/A1</strong>
            </span>
          </div>

          <div className="form-group">
            <label>{t('admin.settings.institutionCode')}</label>
            <input
              value={form.institution_code}
              onChange={set('institution_code')}
              placeholder="e.g. GCA, PRO, NAL"
              maxLength={50}
            />
          </div>

          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>{t('resources.form.fields.description')}</label>
            <textarea
              value={form.description}
              onChange={set('description')}
              rows={3}
              placeholder={t('admin.settings.descriptionPlaceholder')}
            />
          </div>

          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>{t('admin.settings.website')}</label>
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
            {saved ? t('admin.settings.saved') : t('resources.form.saveChanges')}
          </button>
        </div>
      </div>

      <div className={styles.settingsSection}>
        <h3 className={styles.settingsSectionTitle}>{t('admin.settings.rolesReference')}</h3>
        <div className={styles.rolesTable}>
          {ROLE_VALUES.map(roleValue => (
            <div key={roleValue} className={styles.roleRow}>
              <span className={styles.roleLabel}>{t(`admin.roles.${ROLE_KEY_MAP[roleValue]}`)}</span>
              <span className={styles.roleDesc}>{t(`admin.roles.${ROLE_KEY_MAP[roleValue]}Desc`)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────


// ─── Templates tab ───────────────────────────────────────────────────

// ─── Portal tab ───────────────────────────────────────────────────────

function PortalTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [testing, setTesting] = useState(false)

const { data: config, isLoading } = useQuery({
  queryKey: ['portal-config'],
  queryFn: () => portalApi.getConfig().then(r => r.data.data),
})

  const [form, setForm] = useState({
    enabled: false,
    webhook_url: '',
    webhook_secret: '',
  })

  useEffect(() => {
    if (config) {
      setForm(f => ({
        ...f,
        enabled: config.enabled ?? false,
        webhook_url: config.webhook_url ?? '',
      }))
    }
  }, [config])

  const saveMutation = useMutation({
    mutationFn: () => portalApi.saveConfig(form),
    onSuccess: () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      queryClient.invalidateQueries({ queryKey: ['portal-config'] })
    },
  })

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await portalApi.testWebhook()
      setTestResult(r.data.data)
    } catch {
      setTestResult({ ok: false, message: t('admin.portal.requestFailed') })
    } finally {
      setTesting(false)
    }
  }

  const handleBulkSync = async () => {
    setSyncing(true)
    try {
      const r = await portalApi.bulkSync()
      alert(t('admin.portal.syncQueued', { queued: r.data.data.queued, total: r.data.data.total }))
    } catch {
      alert(t('admin.portal.syncFailed'))
    } finally {
      setSyncing(false)
    }
  }

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  if (isLoading) return <div><Spinner size={18} /></div>

  return (
    <div className={styles.settingsSection}>
      <h3 className={styles.settingsSectionTitle}>{t('admin.portal.title')}</h3>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-muted)', marginBottom: 'var(--space-4)' }}>
        {t('admin.portal.desc')}
      </p>

      <div className={styles.settingsGrid}>
        <label htmlFor="portal-enabled" style={{
          gridColumn: '1 / -1',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          cursor: 'pointer',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-ink)',
        }}>
          <input
            type="checkbox"
            id="portal-enabled"
            checked={form.enabled}
            onChange={set('enabled')}
            style={{ width: 'auto', margin: 0, flexShrink: 0 }}
          />
          {t('admin.portal.enableLabel')}
        </label>

        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{t('admin.portal.webhookUrl')}</label>
          <input
            value={form.webhook_url}
            onChange={set('webhook_url')}
            placeholder="https://portal.example.com/webhook"
            disabled={!form.enabled}
          />
          <span className="form-hint">{t('admin.portal.webhookUrlHint')}</span>
        </div>

        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{t('admin.portal.webhookSecret')} {config?.has_secret && <span style={{ color: 'var(--color-success)', fontSize: 'var(--text-xs)' }}>{t('admin.portal.secretSaved')}</span>}</label>
          <input
            type="password"
            value={form.webhook_secret}
            onChange={set('webhook_secret')}
            placeholder={config?.has_secret ? t('admin.portal.secretPlaceholderExisting') : t('admin.portal.secretPlaceholderNew')}
            disabled={!form.enabled}
          />
          <span className="form-hint">{t('admin.portal.secretHint')}</span>
        </div>
      </div>

      <div className={styles.settingsActions} style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            className="btn btn-secondary"
            onClick={handleTest}
            disabled={!form.enabled || !form.webhook_url || testing}
          >
            {testing ? <Spinner size={13} /> : <Zap size={13} />}
            {t('admin.portal.testConnection')}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleBulkSync}
            disabled={!form.enabled || syncing}
          >
            {syncing ? <Spinner size={13} /> : <RefreshCw size={13} />}
            {t('admin.portal.bulkResync')}
          </button>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? <Spinner size={14} /> : <Save size={14} />}
          {saved ? t('admin.settings.saved') : t('common.save')}
        </button>
      </div>

      {testResult && (
        <div style={{
          marginTop: 'var(--space-3)',
          padding: 'var(--space-3)',
          borderRadius: 'var(--radius)',
          background: testResult.ok ? 'var(--color-success-subtle)' : 'var(--color-error-subtle)',
          color: testResult.ok ? 'var(--color-success)' : 'var(--color-error)',
          fontSize: 'var(--text-sm)',
        }}>
          {testResult.ok ? t('admin.portal.testSuccess') : `${t('admin.portal.testFailurePrefix')} ${testResult.message ?? t('admin.portal.connectionFailed')}`}
        </div>
      )}
    </div>
  )
}

function TemplatesTab() {
  return <MetadataTemplatesPage />
}

export default function InstitutionAdminPage() {
  const { t } = useTranslation()
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
        <p>{t('admin.page.noInstitution')}</p>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className={styles.noAccess}>
        <Shield size={28} />
        <p>{t('admin.page.accessRequired')}</p>
      </div>
    )
  }

  const tabs = [
    { key: 'members',     icon: <Users size={14} />,    label: t('admin.page.tabs.members', { count: institution.member_count }) },
    { key: 'settings',    icon: <Settings size={14} />, label: t('admin.page.tabs.settings') },
    { key: 'vocabularies', icon: <BookOpen size={14} />, label: t('admin.page.tabs.vocabularies') },
    { key: 'hierarchies',  icon: <Layers size={14} />,   label: t('admin.page.tabs.hierarchies') },
    { key: 'templates',    icon: <Layers size={14} />,   label: t('admin.page.tabs.fieldTemplates') },
    { key: 'integrations', icon: <Link size={14} />,     label: t('admin.page.tabs.integrations') },
    { key: 'ai',           icon: <Mic size={14} />,      label: t('admin.page.tabs.transcription') },
    { key: 'identifiers',  icon: <Fingerprint size={14} />, label: t('admin.page.tabs.identifierSchemes') },
    { key: 'records-vocab', icon: <ListChecks size={14} />, label: t('admin.page.tabs.recordsValues') },
    { key: 'labels',        icon: <Printer size={14} />,   label: t('admin.page.tabs.labelDesigner') },
    { key: 'portal', icon: <Globe size={14} />, label: t('admin.page.tabs.portal') },
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
        {tab === 'ai'           && (
          <div className={styles.tabContent}>
            <WhisperConfigTab />
          </div>
        )}
        {tab === 'identifiers'  && <IdentifierSchemesTab />}
        {tab === 'records-vocab' && <RecordsVocabularyTab />}
        {tab === 'labels' && <LabelDesigner />}
        {tab === 'portal' && <PortalTab />}
      </div>
    </div>
  )
}