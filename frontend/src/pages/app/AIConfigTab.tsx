import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Save, Zap, CheckCircle, XCircle, Eye, EyeOff,
  AlertCircle, ChevronDown, ChevronUp, RotateCcw, Info,
} from 'lucide-react'
import { aiApi } from '@/api'
import { Spinner } from '@/components/ui'
import styles from './AIConfigTab.module.css'

// ─── Provider definitions ─────────────────────────────────────────────

const PROVIDERS = [
  {
    value: 'anthropic',
    label: 'Anthropic (Claude)',
    requiresKey: true,
    requiresUrl: false,
    defaultModel: 'claude-sonnet-4-20250514',
    modelPlaceholder: 'e.g. claude-sonnet-4-20250514',
    hint: 'Get your API key from console.anthropic.com',
  },
  {
    value: 'openai',
    label: 'OpenAI',
    requiresKey: true,
    requiresUrl: false,
    defaultModel: 'gpt-4o',
    modelPlaceholder: 'e.g. gpt-4o, gpt-4-turbo',
    hint: 'Get your API key from platform.openai.com',
  },
  {
    value: 'ollama',
    label: 'Ollama (local)',
    requiresKey: false,
    requiresUrl: true,
    defaultModel: 'llama3',
    modelPlaceholder: 'e.g. llama3, mistral, phi3',
    hint: 'Run Ollama locally or on your own server. No data leaves your infrastructure.',
  },
  {
    value: 'azure_openai',
    label: 'Azure OpenAI',
    requiresKey: true,
    requiresUrl: true,
    defaultModel: 'gpt-4o',
    modelPlaceholder: 'Deployment name e.g. gpt-4o',
    hint: 'Use your Azure OpenAI endpoint for EU data residency compliance.',
  },
]

// ─── Tab: Provider ────────────────────────────────────────────────────

function ProviderTab({ config }: { config: any }) {
  const queryClient = useQueryClient()

  const [form, setForm] = useState({
    provider:   config?.provider ?? '',
    model:      config?.model ?? '',
    base_url:   config?.base_url ?? '',
    api_key:    '',
    is_enabled: config?.is_enabled ?? true,
    language:   config?.language ?? 'en',
    options:    config?.options ?? {} as Record<string, string>,
  })

  const [showKey, setShowKey]       = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [saved, setSaved]           = useState(false)

  const selectedProvider = PROVIDERS.find(p => p.value === form.provider)

  const set = (field: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))

  const handleProviderChange = (value: string) => {
    const p = PROVIDERS.find(p => p.value === value)
    setForm(f => ({
      ...f,
      provider: value,
      model:    p?.defaultModel ?? '',
      base_url: value === 'ollama' ? 'http://localhost:11434' : '',
    }))
    setTestResult(null)
  }

  const saveMutation = useMutation({
    mutationFn: () => aiApi.saveConfig({
      provider:   form.provider,
      model:      form.model,
      base_url:   form.base_url || undefined,
      api_key:    form.api_key || undefined,
      is_enabled: form.is_enabled,
      language:   form.language,
      options:    form.options,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-config'] })
      queryClient.invalidateQueries({ queryKey: ['ai-status'] })
      setTestResult(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      setForm(f => ({ ...f, api_key: '' }))
    },
  })

  const testMutation = useMutation({
    mutationFn: () => aiApi.testConfig(),
    onSuccess:  (res) => setTestResult(res.data.data),
    onError:    (err: any) => setTestResult({
      ok:      false,
      message: err.response?.data?.message ?? 'Connection failed',
    }),
  })

  return (
    <div className={styles.tabContent}>

      {/* Status */}
      {config && (
        <div className={`${styles.statusBanner} ${config.is_enabled ? styles.statusEnabled : styles.statusDisabled}`}>
          {config.is_enabled
            ? <>Active — <strong>{config.provider}</strong> / <code>{config.model}</code></>
            : 'AI features are disabled for this institution'}
        </div>
      )}

      {/* GDPR warning */}
      {form.provider && form.provider !== 'ollama' && (
        <div className={styles.gdprNotice}>
          <AlertCircle size={13} />
          Prompts sent to this provider include record content. Ensure compliance with your
          data protection obligations. For GDPR-sensitive deployments, use Ollama.
        </div>
      )}

      {/* Provider cards */}
      <div className={styles.fieldSection}>
        <div className={styles.fieldSectionTitle}>Provider</div>
        <div className={styles.providerGrid}>
          {PROVIDERS.map(p => (
            <button
              key={p.value}
              className={`${styles.providerCard} ${form.provider === p.value ? styles.providerCardActive : ''}`}
              onClick={() => handleProviderChange(p.value)}
            >
              <span className={styles.providerLabel}>{p.label}</span>
              {p.value === 'ollama' && <span className={styles.providerBadge}>Local / GDPR</span>}
              {p.value === 'azure_openai' && <span className={styles.providerBadge}>EU residency</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Config fields */}
      {form.provider && (
        <>
          <div className={styles.fieldSection}>
            <div className={styles.fieldSectionTitle}>Configuration</div>
            {selectedProvider?.hint && (
              <p className={styles.fieldHint}>{selectedProvider.hint}</p>
            )}
            <div className={styles.fieldGrid}>
              <div className="form-group">
                <label>Model *</label>
                <input value={form.model} onChange={set('model')}
                  placeholder={selectedProvider?.modelPlaceholder} />
              </div>

              {selectedProvider?.requiresUrl && (
                <div className="form-group">
                  <label>{form.provider === 'azure_openai' ? 'Azure endpoint *' : 'Base URL'}</label>
                  <input value={form.base_url} onChange={set('base_url')}
                    placeholder={form.provider === 'azure_openai'
                      ? 'https://<resource>.openai.azure.com/'
                      : 'http://localhost:11434'} />
                </div>
              )}

              {selectedProvider?.requiresKey && (
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>API key {config?.has_api_key ? '(leave blank to keep existing)' : '*'}</label>
                  <div className={styles.keyRow}>
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={form.api_key}
                      onChange={set('api_key')}
                      placeholder={config?.has_api_key ? '••••••••••••••••' : 'sk-...'}
                      autoComplete="off"
                    />
                    <button className="btn btn-ghost btn-sm btn-icon" type="button"
                      onClick={() => setShowKey(v => !v)}>
                      {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              )}

              {form.provider === 'azure_openai' && (
                <div className="form-group">
                  <label>API version</label>
                  <input
                    value={form.options.api_version ?? '2024-02-01'}
                    onChange={e => setForm(f => ({
                      ...f, options: { ...f.options, api_version: e.target.value }
                    }))}
                    placeholder="2024-02-01"
                  />
                </div>
              )}

              <div className="form-group">
                <label>Preferred language</label>
                <select value={form.language} onChange={set('language')}>
                  {[
                    ['en', 'English'], ['sv', 'Swedish'], ['de', 'German'],
                    ['fr', 'French'], ['nl', 'Dutch'], ['no', 'Norwegian'],
                    ['da', 'Danish'], ['fi', 'Finnish'],
                  ].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <span className="form-hint">Used when fetching from Wikidata and Wikipedia.</span>
              </div>
            </div>
          </div>

          <div className={styles.fieldSection}>
            <div className={styles.fieldSectionTitle}>Status</div>
            <label className={styles.toggle}>
              <input type="checkbox" checked={form.is_enabled}
                onChange={e => setForm(f => ({ ...f, is_enabled: e.target.checked }))} />
              Enable AI features for this institution
            </label>
          </div>

          {testResult && (
            <div className={`${styles.testResult} ${testResult.ok ? styles.testOk : styles.testFail}`}>
              {testResult.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
              {testResult.message}
            </div>
          )}

          <div className={styles.actions}>
            <button className="btn btn-secondary"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending || !form.model}>
              {testMutation.isPending ? <Spinner size={14} /> : <Zap size={14} />}
              Test connection
            </button>
            <button className="btn btn-primary"
              onClick={() => saveMutation.mutate()}
              disabled={
                saveMutation.isPending || !form.provider || !form.model ||
                (selectedProvider?.requiresKey && !config?.has_api_key && !form.api_key) ||
                (form.provider === 'azure_openai' && !form.base_url)
              }>
              {saveMutation.isPending ? <Spinner size={14} /> : <Save size={14} />}
              {saved ? 'Saved!' : 'Save configuration'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Tab: Tasks ───────────────────────────────────────────────────────

function TaskEditor({ task, institutionModel }: { task: any; institutionModel: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen]             = useState(false)
  const [promptValue, setPromptValue] = useState<string>(task.custom_system_prompt ?? '')
  const [modelValue, setModelValue]   = useState<string>(task.custom_model ?? '')
  const [showDefault, setShowDefault] = useState(false)

  const isCustomised = !!task.custom_system_prompt || !!task.custom_model

  const saveMutation = useMutation({
    mutationFn: () => aiApi.updateTask(task.key, {
      system_prompt: promptValue.trim() || undefined,
      model:         modelValue.trim() || undefined,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-tasks'] }),
  })

  const resetMutation = useMutation({
    mutationFn: () => aiApi.resetTask(task.key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-tasks'] })
      setPromptValue('')
      setModelValue('')
    },
  })

  return (
    <div className={styles.taskEditor}>
      <button className={styles.taskHeader} onClick={() => setOpen(v => !v)}>
        <div className={styles.taskHeaderLeft}>
          <span className={styles.taskName}>{task.name}</span>
          <span className={styles.taskDesc}>{task.description}</span>
        </div>
        <div className={styles.taskHeaderRight}>
          {isCustomised && <span className={styles.customBadge}>Customised</span>}
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {open && (
        <div className={styles.taskBody}>
          <div className="form-group">
            <label>
              Model override
              <span className={styles.inlineHint}>
                Leave blank to use institution default ({institutionModel || 'not set'})
              </span>
            </label>
            <input value={modelValue} onChange={e => setModelValue(e.target.value)}
              placeholder={`Default: ${institutionModel || 'institution model'}`} />
          </div>

          <div className="form-group">
            <label>
              System prompt
              <span className={styles.inlineHint}>
                {task.prompt_hint || 'Leave blank to use the default prompt'}
              </span>
            </label>
            <textarea
              value={promptValue}
              onChange={e => setPromptValue(e.target.value)}
              rows={7}
              placeholder="Leave blank to use default prompt..."
              style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}
            />
          </div>

          <button className={styles.showDefaultBtn} onClick={() => setShowDefault(v => !v)}>
            <Info size={12} /> {showDefault ? 'Hide' : 'Show'} default prompt
          </button>

          {showDefault && (
            <pre className={styles.defaultPrompt}>{task.default_system_prompt}</pre>
          )}

          <div className={styles.taskActions}>
            {isCustomised && (
              <button className="btn btn-ghost btn-sm"
                onClick={() => { if (confirm('Reset to defaults?')) resetMutation.mutate() }}
                disabled={resetMutation.isPending}>
                {resetMutation.isPending ? <Spinner size={12} /> : <RotateCcw size={12} />}
                Reset to default
              </button>
            )}
            <button className="btn btn-primary btn-sm"
              onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Spinner size={12} /> : <Save size={12} />}
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function TasksTab({ config }: { config: any }) {
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['ai-tasks'],
    queryFn: () => aiApi.listTasks().then(r => r.data.data),
    enabled: !!config,
  })

  if (!config) return (
    <div className={styles.tabContent}>
      <p className={styles.emptyNotice}>Save a provider configuration first to manage tasks.</p>
    </div>
  )

  if (isLoading) return <div className={styles.tabContent}><Spinner /></div>

  return (
    <div className={styles.tabContent}>
      <p className={styles.intro}>
        Each AI task uses the institution's default model and a built-in system prompt.
        Override either per task to tune quality, speed, or language.
      </p>
      <div className={styles.taskList}>
        {(tasks as any[]).map((task: any) => (
          <TaskEditor key={task.key} task={task} institutionModel={config?.model ?? ''} />
        ))}
      </div>
    </div>
  )
}

// ─── Tab: Whisper ─────────────────────────────────────────────────────

function WhisperTab({ config }: { config: any }) {
  const queryClient     = useQueryClient()
  const whisperCfg      = (config?.task_configs ?? {})['whisper'] ?? {}

  const [serviceUrl, setServiceUrl] = useState(whisperCfg.service_url ?? '')
  const [apiKey, setApiKey]         = useState('')
  const [model, setModel]           = useState(whisperCfg.model ?? '')
  const [showKey, setShowKey]       = useState(false)
  const [models, setModels]         = useState<string[]>([])
  const [fetchError, setFetchError] = useState('')
  const [saved, setSaved]           = useState(false)

  const hasKey = !!whisperCfg.api_key

  const saveMutation = useMutation({
    mutationFn: () => aiApi.saveWhisperConfig({
      service_url: serviceUrl.trim() || undefined,
      api_key:     apiKey.trim() || undefined,
      model:       model.trim() || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-config'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      setApiKey('')
    },
  })

  const fetchModelsMutation = useMutation({
    mutationFn: () => aiApi.getWhisperModels(),
    onSuccess: (res) => {
      const d = res.data.data
      setModels(d.models)
      setFetchError('')
      if (!model && d.default) setModel(d.default)
    },
    onError: (err: any) => {
      setFetchError(err?.response?.data?.message ?? 'Could not reach Whisper service')
    },
  })

  if (!config) return (
    <div className={styles.tabContent}>
      <p className={styles.emptyNotice}>Save a provider configuration first to configure Whisper.</p>
    </div>
  )

  return (
    <div className={styles.tabContent}>
      <p className={styles.intro}>
        Connect to a dedicated Whisper transcription service for audio and video files.
        Run it on a separate machine — ideally with a GPU — for best performance.
        The service URL and API key are stored per institution.
      </p>

      <div className={styles.fieldSection}>
        <div className={styles.fieldSectionTitle}>Service connection</div>

        <div className={styles.fieldGrid}>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>Service URL</label>
            <input value={serviceUrl} onChange={e => setServiceUrl(e.target.value)}
              placeholder="http://whisper-service:8000" />
            <span className="form-hint">
              The URL of your Whisper microservice. Use the Docker service name when running
              on the same host, or a full URL for a remote machine.
            </span>
          </div>

          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>API key {hasKey ? '(leave blank to keep existing)' : ''}</label>
            <div className={styles.keyRow}>
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={hasKey ? '••••••••••••••••' : 'Shared secret'}
                autoComplete="off"
              />
              <button className="btn btn-ghost btn-sm btn-icon" type="button"
                onClick={() => setShowKey(v => !v)}>
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.fieldSection}>
        <div className={styles.fieldSectionTitle}>Default model</div>
        <p className={styles.fieldHint}>
          Archivists can override the model per job. This sets the default shown in the dropdown.
        </p>

        <div className={styles.modelRow}>
          {models.length > 0 ? (
            <select value={model} onChange={e => setModel(e.target.value)}
              style={{ flex: 1 }}>
              <option value="">Select model...</option>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input value={model} onChange={e => setModel(e.target.value)}
              placeholder="e.g. KBLab/kb-whisper-medium"
              style={{ flex: 1 }} />
          )}
          <button className="btn btn-secondary"
            onClick={() => fetchModelsMutation.mutate()}
            disabled={!serviceUrl.trim() || fetchModelsMutation.isPending}
            title="Fetch available models from the Whisper service">
            {fetchModelsMutation.isPending ? <Spinner size={14} /> : <Zap size={14} />}
            Fetch models
          </button>
        </div>

        {fetchError && (
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)', marginTop: 'var(--space-1)' }}>
            {fetchError}
          </p>
        )}
        {models.length > 0 && !fetchError && (
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', marginTop: 'var(--space-1)' }}>
            <CheckCircle size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
            {models.length} model{models.length !== 1 ? 's' : ''} available from service
          </p>
        )}
      </div>

      <div className={styles.actions}>
        <button className="btn btn-primary"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}>
          {saveMutation.isPending ? <Spinner size={14} /> : <Save size={14} />}
          {saved ? 'Saved!' : 'Save Whisper config'}
        </button>
      </div>
    </div>
  )
}

// ─── Main tab ─────────────────────────────────────────────────────────

type AITab = 'provider' | 'tasks' | 'whisper'

const AI_TABS: { key: AITab; label: string }[] = [
  { key: 'provider', label: 'Provider' },
  { key: 'tasks',    label: 'Task prompts' },
  { key: 'whisper',  label: 'Whisper' },
]

export default function AIConfigTab() {
  const [activeTab, setActiveTab] = useState<AITab>('provider')

  const { data: config, isLoading } = useQuery({
    queryKey: ['ai-config'],
    queryFn: () => aiApi.getConfig().then(r => r.data.data),
  })

  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-8)' }}>
      <Spinner />
    </div>
  )

  return (
    <div className={styles.wrap}>
      {/* Tab bar — same pattern as VocabulariesTab */}
      <div className={styles.tabBar}>
        {AI_TABS.map(t => (
          <button
            key={t.key}
            className={`${styles.tabBtn} ${activeTab === t.key ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'provider' && <ProviderTab config={config} />}
      {activeTab === 'tasks'    && <TasksTab config={config} />}
      {activeTab === 'whisper'  && <WhisperTab config={config} />}
    </div>
  )
}