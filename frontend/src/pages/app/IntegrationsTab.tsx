import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, X, Save, AlertCircle } from 'lucide-react'
import { integrationsApi, institutionApi } from '@/api'
import type { ExternalIntegration } from '@/types'
import { Spinner } from '@/components/ui'
import styles from './IntegrationsTab.module.css'

// ─── Built-in authority sources ───────────────────────────────────────

const BUILTINS = [
  { key: 'wikidata', label: 'Wikidata',  colour: '#006699' },
  { key: 'viaf',     label: 'VIAF',      colour: '#8B4513' },
  { key: 'orcid',    label: 'ORCID',     colour: '#A6CE39' },
]

// ─── Entity type options ──────────────────────────────────────────────
// 'agent'    → appears in authority lookup on agents page
// 'metadata' → appears in vocabulary search on metadata fields

const ENTITY_TYPES = [
  { value: 'agent',    label: 'Agent authority lookup' },
  { value: 'metadata', label: 'Metadata vocabulary field' },
]

// ─── Field mapping help ───────────────────────────────────────────────

const MAPPING_HELP = `Map target fields to dot-paths in each result item.

Example for {"persons": [{"name_full": "...", "acc": "..."}]}:
{
  "name":        "name_full",
  "identifier":  "acc",
  "description": "aff_name_en"
}

Supported target fields:
  name, authorized_form, agent_type,
  date_from, date_to, description,
  identifier, website`

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
      setJsonError('Headers or field mappings contain invalid JSON')
    }
  }

  return (
    <div className={styles.formGrid}>
      <div className={styles.formGroup}>
        <label>Name *</label>
        <input value={form.name} onChange={set('name')} placeholder="LC Subject Headings" />
      </div>

      <div className={styles.formGroup}>
        <label>Used for *</label>
        <select value={form.entity_type} onChange={set('entity_type')}>
          {ENTITY_TYPES.map(et => (
            <option key={et.value} value={et.value}>{et.label}</option>
          ))}
        </select>
      </div>

      <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
        <label>Base URL *</label>
        <input value={form.base_url} onChange={set('base_url')} placeholder="https://api.example.com" />
      </div>

      <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
        <label>
          Search path * <span className={styles.hint}>use <code>{'{query}'}</code> as placeholder</span>
        </label>
        <input value={form.search_path} onChange={set('search_path')} placeholder="search?q={query}" />
      </div>

      <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
        <label>
          Result path <span className={styles.hint}>dot-path to the array, e.g. <code>persons</code> or <code>hits.hit</code> — leave empty if response is already an array</span>
        </label>
        <input value={form.result_path} onChange={set('result_path')} placeholder="e.g. persons" />
      </div>

      <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
        <label>
          Headers (JSON) <span className={styles.hint}>auth headers, API keys</span>
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
          Field mappings (JSON) <span className={styles.hint}>target field → source dot-path</span>
        </label>
        <textarea
          value={mappingsText}
          onChange={e => setMappingsText(e.target.value)}
          rows={6}
          className={styles.monoArea}
          placeholder={'{\n  "name": "name_full",\n  "identifier": "acc"\n}'}
          spellCheck={false}
        />
        <pre className={styles.mappingHelp}>{MAPPING_HELP}</pre>
      </div>

      {jsonError && (
        <div className={styles.jsonError} style={{ gridColumn: '1 / -1' }}>
          <AlertCircle size={13} /> {jsonError}
        </div>
      )}

      <div className={styles.formActions} style={{ gridColumn: '1 / -1' }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={isSaving}>
          <X size={14} /> Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={!form.name || !form.base_url || !form.search_path || isSaving}
        >
          {isSaving ? <Spinner size={14} /> : <Save size={14} />}
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ─── Built-in toggles ─────────────────────────────────────────────────

function BuiltinToggles() {
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
          <div className={styles.sectionTitle}>Built-in authority sources</div>
          <div className={styles.sectionDesc}>
            These are always available in the authority lookup. Disable any that are not relevant to your institution.
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
                  {isEnabled ? 'Enabled' : 'Disabled'}
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

  const entityLabel = (et: string) => ENTITY_TYPES.find(x => x.value === et)?.label ?? et

  return (
    <div className={styles.tab}>
      <p className={styles.intro}>
        Configure external APIs for authority lookups and vocabulary fields.
        Searches are proxied through the server so credentials stay private.
      </p>

      <BuiltinToggles />

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionTitle}>Custom integrations</div>
            <div className={styles.sectionDesc}>
              Custom APIs searched alongside the built-ins above, or used in vocabulary metadata fields.
            </div>
          </div>
          {!showForm && editing === null && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
              <Plus size={13} /> Add integration
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
            <div className={styles.empty}>No custom integrations configured yet.</div>
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
                      onClick={() => { if (confirm(`Delete "${intg.name}"?`)) deleteMutation.mutate(intg.id) }}
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