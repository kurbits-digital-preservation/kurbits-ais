import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, X, Save, AlertCircle } from 'lucide-react'
import { integrationsApi, institutionApi } from '@/api'
import type { ExternalIntegration } from '@/types'
import { Spinner } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import styles from './IntegrationsTab.module.css'

// ─── Built-in authority sources ───────────────────────────────────────
// Brand/service names (Wikidata, VIAF, ORCID) are proper nouns, not translated.

const BUILTINS = [
  { key: 'wikidata', label: 'Wikidata',  colour: '#006699' },
  { key: 'viaf',     label: 'VIAF',      colour: '#8B4513' },
  { key: 'orcid',    label: 'ORCID',     colour: '#A6CE39' },
]

// ─── Entity type options ──────────────────────────────────────────────
// 'agent'    → appears in authority lookup on agents page
// 'metadata' → appears in vocabulary search on metadata fields

const ENTITY_TYPE_VALUES = ['agent', 'metadata']

// ─── Empty form ───────────────────────────────────────────────────────

const EMPTY: Omit<ExternalIntegration, 'id'> = {
  name:          '',
  entity_type:   'agent',
  base_url:      '',
  search_path:   'search?query={query}',
  headers:       {},
  result_path:   '',
  field_mappings: {},
  is_active:     true,
}

// ─── Integration form ─────────────────────────────────────────────────

function IntegrationForm({
  initial, onSave, onCancel, isSaving,
}: {
  initial: Omit<ExternalIntegration, 'id'>
  onSave: (data: Omit<ExternalIntegration, 'id'>) => void
  onCancel: () => void
  isSaving: boolean
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState(initial)
  const [headersText, setHeadersText] = useState(
    JSON.stringify(initial.headers ?? {}, null, 2)
  )
  const [mappingsText, setMappingsText] = useState(
    JSON.stringify(initial.field_mappings ?? {}, null, 2)
  )
  const [jsonError, setJsonError] = useState('')

  const set = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSave = () => {
    try {
      const headers        = headersText.trim()  ? JSON.parse(headersText)  : {}
      const field_mappings = mappingsText.trim() ? JSON.parse(mappingsText) : {}
      setJsonError('')
      onSave({ ...form, headers, field_mappings })
    } catch {
      setJsonError(t('admin.integrations.jsonInvalid'))
    }
  }

  return (
    <div className={styles.formGrid}>
      <div className={styles.formGroup}>
        <label>{t('agents.form.name')}</label>
        <input value={form.name} onChange={set('name')} placeholder="LC Subject Headings" />
      </div>

      <div className={styles.formGroup}>
        <label>{t('admin.integrations.usedFor')}</label>
        <select value={form.entity_type} onChange={set('entity_type')}>
          {ENTITY_TYPE_VALUES.map(et => (
            <option key={et} value={et}>{t(`admin.integrations.entityTypes.${et}`)}</option>
          ))}
        </select>
      </div>

      <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
        <label>{t('admin.integrations.baseUrl')}</label>
        <input value={form.base_url} onChange={set('base_url')} placeholder="https://api.example.com" />
      </div>

      <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
        <label>
          {t('admin.integrations.searchPath')} <span className={styles.hint}>{t('admin.integrations.searchPathHint')}</span>
        </label>
        <input value={form.search_path} onChange={set('search_path')} placeholder="search?q={query}" />
      </div>

      <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
        <label>
          {t('admin.integrations.resultPath')} <span className={styles.hint}>{t('admin.integrations.resultPathHint')}</span>
        </label>
        <input value={form.result_path} onChange={set('result_path')} placeholder="e.g. persons" />
      </div>

      <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
        <label>
          {t('admin.identifierSchemes.headersJson')} <span className={styles.hint}>{t('admin.integrations.headersHint')}</span>
        </label>
        <textarea
          value={headersText}
          onChange={e => setHeadersText(e.target.value)}
          rows={3}
          className={styles.monoArea}
          placeholder={'{\n  "Authorization": "Bearer secret"\n}'}
          spellCheck={false}
        />
      </div>

      <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
        <label>
          {t('admin.integrations.fieldMappingsJson')} <span className={styles.hint}>{t('admin.integrations.fieldMappingsHint')}</span>
        </label>
        <textarea
          value={mappingsText}
          onChange={e => setMappingsText(e.target.value)}
          rows={6}
          className={styles.monoArea}
          placeholder={'{\n  "name": "name_full",\n  "identifier": "acc"\n}'}
          spellCheck={false}
        />
        <pre className={styles.mappingHelp}>{t('admin.integrations.mappingHelp')}</pre>
      </div>

      {jsonError && (
        <div className={styles.jsonError} style={{ gridColumn: '1 / -1' }}>
          <AlertCircle size={13} /> {jsonError}
        </div>
      )}

      <div className={styles.formActions} style={{ gridColumn: '1 / -1' }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={isSaving}>
          <X size={14} /> {t('common.cancel')}
        </button>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={!form.name || !form.base_url || !form.search_path || isSaving}
        >
          {isSaving ? <Spinner size={14} /> : <Save size={14} />}
          {isSaving ? t('resources.form.saving') : t('common.save')}
        </button>
      </div>
    </div>
  )
}

// ─── Built-in toggles ─────────────────────────────────────────────────

function BuiltinToggles() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data: institution } = useQuery({
    queryKey: ['institution-current'],
    queryFn: () => institutionApi.getCurrent().then(r => r.data.data),
  })

  const disabled: string[] = institution?.settings?.disabled_builtins ?? []

  const mutation = useMutation({
    mutationFn: (disabled_builtins: string[]) =>
      institutionApi.updateCurrent({ settings: { disabled_builtins } } as any),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['institution-current'] }),
  })

  const toggle = (key: string) => {
    const next = disabled.includes(key)
      ? disabled.filter(k => k !== key)
      : [...disabled, key]
    mutation.mutate(next)
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>{t('admin.integrations.builtinSources')}</div>
          <div className={styles.sectionDesc}>
            {t('admin.integrations.builtinSourcesDesc')}
          </div>
        </div>
      </div>
      <div className={styles.list}>
        {BUILTINS.map(b => {
          const isEnabled = !disabled.includes(b.key)
          return (
            <div key={b.key} className={styles.row}>
              <div className={styles.rowBody}>
                <span
                  className={styles.rowBadge}
                  style={{ background: isEnabled ? b.colour : undefined, color: isEnabled ? '#fff' : undefined }}
                >
                  {b.label}
                </span>
                <span className={styles.rowName}>{b.label}</span>
              </div>
              <div className={styles.rowActions}>
                <button
                  className={`btn btn-sm ${isEnabled ? 'btn-ghost' : 'btn-secondary'}`}
                  onClick={() => toggle(b.key)}
                  disabled={mutation.isPending}
                >
                  {isEnabled ? t('admin.integrations.enabled') : t('admin.integrations.disabled')}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main tab ─────────────────────────────────────────────────────────

export default function IntegrationsTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)

  const { data: integrations = [], isLoading } = useQuery<ExternalIntegration[]>({
    queryKey: ['integrations-admin'],
    queryFn: () => integrationsApi.list(),
  })

  const createMutation = useMutation({
    mutationFn: integrationsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations-admin'] })
      queryClient.invalidateQueries({ queryKey: ['integrations'] })
      setShowForm(false)
    },
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Omit<ExternalIntegration, 'id'>> }) =>
      integrationsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations-admin'] })
      queryClient.invalidateQueries({ queryKey: ['integrations'] })
      setEditing(null)
    },
  })
  const deleteMutation = useMutation({
    mutationFn: integrationsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations-admin'] })
      queryClient.invalidateQueries({ queryKey: ['integrations'] })
    },
  })

  if (isLoading) return <div className={styles.tab}><Spinner /></div>

  const entityLabel = (et: string) => ENTITY_TYPE_VALUES.includes(et) ? t(`admin.integrations.entityTypes.${et}`) : et

  return (
    <div className={styles.tab}>
      <p className={styles.intro}>
        {t('admin.integrations.intro')}
      </p>

      <BuiltinToggles />

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionTitle}>{t('admin.integrations.customIntegrations')}</div>
            <div className={styles.sectionDesc}>
              {t('admin.integrations.customIntegrationsDesc')}
            </div>
          </div>
          {!showForm && editing === null && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
              <Plus size={13} /> {t('admin.integrations.addIntegration')}
            </button>
          )}
        </div>

        <div className={styles.list}>
          {showForm && (
            <div className={styles.form}>
              <IntegrationForm
                initial={EMPTY}
                onSave={data => createMutation.mutate(data)}
                onCancel={() => setShowForm(false)}
                isSaving={createMutation.isPending}
              />
            </div>
          )}

          {integrations.length === 0 && !showForm && (
            <div className={styles.empty}>{t('admin.integrations.noneYet')}</div>
          )}

          {integrations.map(intg => (
            <div key={intg.id}>
              {editing === intg.id ? (
                <div className={styles.form}>
                  <IntegrationForm
                    initial={intg}
                    onSave={data => updateMutation.mutate({ id: intg.id, data })}
                    onCancel={() => setEditing(null)}
                    isSaving={updateMutation.isPending}
                  />
                </div>
              ) : (
                <div className={styles.row}>
                  <div className={styles.rowBody}>
                    <span className={styles.rowName}>{intg.name}</span>
                    <span className={styles.rowBadge}>{entityLabel(intg.entity_type)}</span>
                    <span className={styles.rowMeta}>{intg.base_url}</span>
                  </div>
                  <div className={styles.rowActions}>
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(intg.id)}>
                      <Pencil size={13} />
                    </button>
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      onClick={() => { if (confirm(t('admin.integrations.deleteConfirm', { name: intg.name }))) deleteMutation.mutate(intg.id) }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}