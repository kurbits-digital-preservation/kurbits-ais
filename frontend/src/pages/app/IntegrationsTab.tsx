import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, X, Save, AlertCircle, Lock } from 'lucide-react'
import { integrationsApi, institutionApi, sourcesApi } from '@/api'
import type { ExternalIntegration, SourceConfigField, SourcePluginInfo } from '@/types'
import { Spinner } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import styles from './IntegrationsTab.module.css'

// ─── Built-in authority sources ───────────────────────────────────────

const BUILTINS = [
  { key: 'wikidata', label: 'Wikidata',  colour: '#006699' },
  { key: 'viaf',     label: 'VIAF',      colour: '#8B4513' },
  { key: 'orcid',    label: 'ORCID',     colour: '#A6CE39' },
]

// ─── Lookup integration types ─────────────────────────────────────────

const LOOKUP_TYPE_VALUES = ['agent', 'metadata']
const SOURCE_TYPE = 'source'

const EMPTY_LOOKUP: Omit<ExternalIntegration, 'id'> = {
  name:           '',
  entity_type:    'agent',
  base_url:       '',
  search_path:    'search?query={query}',
  headers:        {},
  result_path:    '',
  field_mappings: {},
  is_active:      true,
}

// ─── Lookup integration form ──────────────────────────────────────────

function LookupIntegrationForm({
  initial, onSave, onCancel, isSaving,
}: {
  initial: Omit<ExternalIntegration, 'id'>
  onSave: (data: Partial<Omit<ExternalIntegration, 'id'>>) => void
  onCancel: () => void
  isSaving: boolean
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState(initial)
  const [headersText, setHeadersText] = useState(JSON.stringify(initial.headers ?? {}, null, 2))
  const [mappingsText, setMappingsText] = useState(JSON.stringify(initial.field_mappings ?? {}, null, 2))
  const [jsonError, setJsonError] = useState('')

  const set = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSave = () => {
    try {
      const headers        = headersText.trim()  ? JSON.parse(headersText)  : {}
      const field_mappings = mappingsText.trim() ? JSON.parse(mappingsText) : {}
      setJsonError('')
      onSave({
        name: form.name,
        entity_type: form.entity_type,
        base_url: form.base_url,
        search_path: form.search_path,
        result_path: form.result_path,
        headers,
        field_mappings,
        is_active: form.is_active,
      })
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
          {LOOKUP_TYPE_VALUES.map(et => (
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

// ─── Plugin config field ──────────────────────────────────────────────

function ConfigFieldInput({
  field, value, isSet, onChange,
}: {
  field: SourceConfigField
  value: string
  isSet: boolean
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const fullWidth = field.type === 'json' || field.type === 'textarea' || field.type === 'url'
  const placeholder = field.secret && isSet
    ? t('admin.integrations.secretSet')
    : field.placeholder ?? (field.default != null ? String(field.default) : '')

  return (
    <div className={styles.formGroup} style={fullWidth ? { gridColumn: '1 / -1' } : undefined}>
      <label>
        {field.label}{field.required ? ' *' : ''}
        {field.secret && <Lock size={11} style={{ marginLeft: 4, verticalAlign: '-1px' }} />}
      </label>
      {field.type === 'json' || field.type === 'textarea' ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={field.type === 'json' ? 5 : 3}
          className={field.type === 'json' ? styles.monoArea : undefined}
          placeholder={placeholder}
          spellCheck={false}
        />
      ) : (
        <input
          type={field.secret ? 'password' : 'text'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
        />
      )}
      {field.help && <span className={styles.hint}>{field.help}</span>}
    </div>
  )
}

// ─── Source form ──────────────────────────────────────────────────────

function toFormValues(config: Record<string, unknown> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(config ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v, null, 2)])
  )
}

function SourceIntegrationForm({
  initial, plugins, onSave, onCancel, isSaving,
}: {
  initial?: ExternalIntegration
  plugins: SourcePluginInfo[]
  onSave: (data: Partial<Omit<ExternalIntegration, 'id'>>) => void
  onCancel: () => void
  isSaving: boolean
}) {
  const { t } = useTranslation()
  const isEdit = !!initial
  const selectablePlugins = plugins.filter(p => p.enabled || p.key === initial?.plugin)
  const [name, setName] = useState(initial?.name ?? '')
  const [pluginKey, setPluginKey] = useState(initial?.plugin ?? selectablePlugins[0]?.key ?? '')
  const [values, setValues] = useState<Record<string, string>>(() => toFormValues(initial?.config))
  const secretsSet = initial?.secrets_set ?? []

  const plugin = plugins.find(p => p.key === pluginKey)
  const schema = plugin?.config_schema ?? []

  const missingRequired = schema.some(f => {
    if (!f.required) return false
    const v = (values[f.key] ?? '').trim()
    if (v) return false
    if (f.secret) return !secretsSet.includes(f.key)
    return f.default == null || f.default === ''
  })

  const handleSave = () => {
    const config: Record<string, string> = {}
    for (const f of schema) {
      const v = values[f.key] ?? ''
      if (f.secret && !v.trim()) continue
      config[f.key] = v
    }
    onSave({ name, entity_type: SOURCE_TYPE, plugin: pluginKey, config, is_active: true })
  }

  return (
    <div className={styles.formGrid}>
      <div className={styles.formGroup}>
        <label>{t('agents.form.name')}</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="SweCRIS" />
      </div>

      <div className={styles.formGroup}>
        <label>{t('admin.integrations.plugin')}</label>
        <select value={pluginKey} onChange={e => setPluginKey(e.target.value)} disabled={isEdit}>
          {selectablePlugins.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>

      {plugin?.description && (
        <div className={styles.hint} style={{ gridColumn: '1 / -1' }}>{plugin.description}</div>
      )}

      {schema.map(field => (
        <ConfigFieldInput
          key={field.key}
          field={field}
          value={values[field.key] ?? ''}
          isSet={secretsSet.includes(field.key)}
          onChange={v => setValues(prev => ({ ...prev, [field.key]: v }))}
        />
      ))}

      <div className={styles.formActions} style={{ gridColumn: '1 / -1' }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={isSaving}>
          <X size={14} /> {t('common.cancel')}
        </button>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={!name.trim() || !plugin || missingRequired || isSaving}
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

// ─── Plugin toggles ───────────────────────────────────────────────────

function PluginToggles({ plugins }: { plugins: SourcePluginInfo[] }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      sourcesApi.setPluginEnabled(key, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['source-plugins'] })
      queryClient.invalidateQueries({ queryKey: ['record-sources-for-level'] })
    },
  })

  if (!plugins.length) return null

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>{t('admin.integrations.plugins')}</div>
          <div className={styles.sectionDesc}>{t('admin.integrations.pluginsDesc')}</div>
        </div>
      </div>
      <div className={styles.list}>
        {plugins.map(p => (
          <div key={p.key} className={styles.row}>
            <div className={styles.rowBody}>
              <span className={styles.rowName}>{p.label}</span>
              <span className={styles.rowBadge}>v{p.version}</span>
              <span className={styles.rowMeta}>{p.description}</span>
            </div>
            <div className={styles.rowActions}>
              <button
                className={`btn btn-sm ${p.enabled ? 'btn-ghost' : 'btn-secondary'}`}
                onClick={() => mutation.mutate({ key: p.key, enabled: !p.enabled })}
                disabled={mutation.isPending}
              >
                {p.enabled ? t('admin.integrations.enabled') : t('admin.integrations.disabled')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main tab ─────────────────────────────────────────────────────────

type FormMode = 'lookup' | 'source' | null

export default function IntegrationsTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState<FormMode>(null)
  const [editing, setEditing] = useState<number | null>(null)

  const { data: integrations = [], isLoading } = useQuery<ExternalIntegration[]>({
    queryKey: ['integrations-admin'],
    queryFn: () => integrationsApi.list(),
  })

  const { data: plugins = [] } = useQuery({
    queryKey: ['source-plugins'],
    queryFn: sourcesApi.plugins,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['integrations-admin'] })
    queryClient.invalidateQueries({ queryKey: ['integrations'] })
    queryClient.invalidateQueries({ queryKey: ['record-sources-for-level'] })
  }

  const createMutation = useMutation({
    mutationFn: integrationsApi.create,
    onSuccess: () => { invalidate(); setCreating(null) },
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Omit<ExternalIntegration, 'id'>> }) =>
      integrationsApi.update(id, data),
    onSuccess: () => { invalidate(); setEditing(null) },
  })
  const deleteMutation = useMutation({
    mutationFn: integrationsApi.delete,
    onSuccess: invalidate,
  })

  if (isLoading) return <div className={styles.tab}><Spinner /></div>

  const enabledPlugins = plugins.filter(p => p.enabled)
  const entityLabel = (et: string) =>
    [...LOOKUP_TYPE_VALUES, SOURCE_TYPE].includes(et) ? t(`admin.integrations.entityTypes.${et}`) : et
  const mutationError = (createMutation.error || updateMutation.error) as any
  const idle = creating === null && editing === null

  return (
    <div className={styles.tab}>
      <p className={styles.intro}>
        {t('admin.integrations.intro')}
      </p>

      <BuiltinToggles />
      <PluginToggles plugins={plugins} />

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionTitle}>{t('admin.integrations.customIntegrations')}</div>
            <div className={styles.sectionDesc}>
              {t('admin.integrations.customIntegrationsDesc')}
            </div>
          </div>
          {idle && (
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setCreating('lookup')}>
                <Plus size={13} /> {t('admin.integrations.addIntegration')}
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setCreating('source')}
                disabled={!enabledPlugins.length}
                title={!enabledPlugins.length ? t('admin.integrations.noEnabledPlugins') : undefined}
              >
                <Plus size={13} /> {t('admin.integrations.addSource')}
              </button>
            </div>
          )}
        </div>

        {mutationError && (
          <div className={styles.jsonError} style={{ margin: 'var(--space-3) var(--space-5)' }}>
            <AlertCircle size={13} /> {mutationError.response?.data?.message ?? t('resources.form.genericError')}
          </div>
        )}

        <div className={styles.list}>
          {creating === 'lookup' && (
            <div className={styles.form}>
              <LookupIntegrationForm
                initial={EMPTY_LOOKUP}
                onSave={data => createMutation.mutate(data)}
                onCancel={() => setCreating(null)}
                isSaving={createMutation.isPending}
              />
            </div>
          )}

          {creating === 'source' && (
            <div className={styles.form}>
              <SourceIntegrationForm
                plugins={plugins}
                onSave={data => createMutation.mutate(data)}
                onCancel={() => setCreating(null)}
                isSaving={createMutation.isPending}
              />
            </div>
          )}

          {integrations.length === 0 && creating === null && (
            <div className={styles.empty}>{t('admin.integrations.noneYet')}</div>
          )}

          {integrations.map(intg => (
            <div key={intg.id}>
              {editing === intg.id ? (
                <div className={styles.form}>
                  {intg.entity_type === SOURCE_TYPE ? (
                    <SourceIntegrationForm
                      initial={intg}
                      plugins={plugins}
                      onSave={data => updateMutation.mutate({ id: intg.id, data })}
                      onCancel={() => setEditing(null)}
                      isSaving={updateMutation.isPending}
                    />
                  ) : (
                    <LookupIntegrationForm
                      initial={intg}
                      onSave={data => updateMutation.mutate({ id: intg.id, data })}
                      onCancel={() => setEditing(null)}
                      isSaving={updateMutation.isPending}
                    />
                  )}
                </div>
              ) : (
                <div className={styles.row}>
                  <div className={styles.rowBody}>
                    <span className={styles.rowName}>{intg.name}</span>
                    <span className={styles.rowBadge}>{entityLabel(intg.entity_type)}</span>
                    {intg.entity_type === SOURCE_TYPE && (
                      <span className={styles.rowBadge}>
                        {intg.plugin_installed === false ? t('admin.integrations.pluginNotInstalled') : intg.plugin_label}
                      </span>
                    )}
                    {intg.entity_type !== SOURCE_TYPE && <span className={styles.rowMeta}>{intg.base_url}</span>}
                  </div>
                  <div className={styles.rowActions}>
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      onClick={() => setEditing(intg.id)}
                      disabled={!idle}
                    >
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