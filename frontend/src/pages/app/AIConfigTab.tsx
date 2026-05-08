import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Zap, CheckCircle, XCircle, Eye, EyeOff, Bot, AlertCircle } from 'lucide-react'
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
    value: 'ollama',
    label: 'Ollama (local)',
    requiresKey: false,
    requiresUrl: true,
    defaultModel: 'llama3',
    modelPlaceholder: 'e.g. llama3, mistral, phi3',
    hint: 'Run Ollama locally or on your own server. No data leaves your infrastructure.',
  },

]

// ─── Test result banner ───────────────────────────────────────────────

function TestResult({ result }: { result: { ok: boolean; message: string } | null }) {
  if (!result) return null
  return (
    <div className={`${styles.testResult} ${result.ok ? styles.testOk : styles.testFail}`}>
      {result.ok
        ? <CheckCircle size={14} />
        : <XCircle size={14} />}
      {result.message}
    </div>
  )
}

// ─── Main tab ─────────────────────────────────────────────────────────

export default function AIConfigTab() {
  const queryClient = useQueryClient()

  const { data: config, isLoading } = useQuery({
    queryKey: ['ai-config'],
    queryFn: () => aiApi.getConfig().then(r => r.data.data),
  })

  const [form, setForm] = useState<{
    provider: string
    model: string
    base_url: string
    api_key: string
    is_enabled: boolean
    options: Record<string, string>
  }>({
    provider: '',
    model: '',
    base_url: '',
    api_key: '',
    is_enabled: true,
    options: {},
  })

  const [initialised, setInitialised] = useState(false)
  if (!isLoading && !initialised) {
    setInitialised(true)
    if (config) {
      setForm({
        provider: config.provider ?? '',
        model: config.model ?? '',
        base_url: config.base_url ?? '',
        api_key: '',   // never pre-filled — write-only
        is_enabled: config.is_enabled ?? true,
        options: config.options ?? {},
      })
    }
  }

  const [showKey, setShowKey] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [saved, setSaved] = useState(false)

  const selectedProvider = PROVIDERS.find(p => p.value === form.provider)

  const set = (field: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))

  const saveMutation = useMutation({
    mutationFn: () => aiApi.saveConfig({
      provider: form.provider,
      model: form.model,
      base_url: form.base_url || undefined,
      api_key: form.api_key || undefined,
      is_enabled: form.is_enabled,
      options: form.options,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-config'] })
      setTestResult(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      setForm(f => ({ ...f, api_key: '' }))
    },
  })

  const testMutation = useMutation({
    mutationFn: () => aiApi.testConfig(),
    onSuccess: (res) => setTestResult(res.data.data),
    onError: (err: any) => setTestResult({
      ok: false,
      message: err.response?.data?.message ?? 'Connection failed',
    }),
  })

  const handleProviderChange = (value: string) => {
    const p = PROVIDERS.find(p => p.value === value)
    setForm(f => ({
      ...f,
      provider: value,
      model: p?.defaultModel ?? '',
      base_url: value === 'ollama' ? 'http://localhost:11434' : '',
    }))
    setTestResult(null)
  }

  if (isLoading) {
    return <div className={styles.loading}><Spinner /></div>
  }

  return (
    <div className={styles.tab}>

      {/* ── Status banner ── */}
      {config && (
        <div className={`${styles.statusBanner} ${config.is_enabled ? styles.statusEnabled : styles.statusDisabled}`}>
          <Bot size={14} />
          {config.is_enabled
            ? <>AI is active — <strong>{config.provider}</strong> / <code>{config.model}</code></>
            : 'AI features are disabled for this institution'}
        </div>
      )}

      {/* ── GDPR notice for non-local providers ── */}
      {form.provider && form.provider !== 'ollama' && (
        <div className={styles.gdprNotice}>
          <AlertCircle size={13} />
          Prompts sent to this provider will include record content. Ensure this is compliant
          with your data protection obligations. For GDPR-sensitive deployments, use Ollama.
        </div>
      )}

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Provider</h3>

        <div className={styles.providerGrid}>
          {PROVIDERS.map(p => (
            <button
              key={p.value}
              className={`${styles.providerCard} ${form.provider === p.value ? styles.providerCardActive : ''}`}
              onClick={() => handleProviderChange(p.value)}
            >
              <span className={styles.providerLabel}>{p.label}</span>
              {p.value === 'ollama' && (
                <span className={styles.providerBadge}>Local / GDPR</span>
              )}
              {p.value === 'azure_openai' && (
                <span className={styles.providerBadge}>EU residency</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {form.provider && (
        <>
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Configuration</h3>

            {selectedProvider?.hint && (
              <p className={styles.providerHint}>{selectedProvider.hint}</p>
            )}

            <div className={styles.fieldGrid}>

              <div className="form-group">
                <label>Model *</label>
                <input
                  value={form.model}
                  onChange={set('model')}
                  placeholder={selectedProvider?.modelPlaceholder}
                />
              </div>

              {(selectedProvider?.requiresUrl || form.provider === 'ollama') && (
                <div className="form-group">
                  <label>
                    {form.provider === 'azure_openai' ? 'Azure endpoint *' : 'Base URL'}
                  </label>
                  <input
                    value={form.base_url}
                    onChange={set('base_url')}
                    placeholder={
                      form.provider === 'azure_openai'
                        ? 'https://<resource>.openai.azure.com/'
                        : 'http://localhost:11434'
                    }
                  />
                </div>
              )}

              {selectedProvider?.requiresKey && (
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>
                    API key {config?.has_api_key ? '(leave blank to keep existing)' : '*'}
                  </label>
                  <div className={styles.keyRow}>
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={form.api_key}
                      onChange={set('api_key')}
                      placeholder={config?.has_api_key ? '••••••••••••••••' : 'sk-…'}
                      autoComplete="off"
                    />
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      onClick={() => setShowKey(v => !v)}
                      type="button"
                      title={showKey ? 'Hide' : 'Show'}
                    >
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

            </div>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Status</h3>
            <label className={styles.enabledToggle}>
              <input
                type="checkbox"
                checked={form.is_enabled}
                onChange={e => setForm(f => ({ ...f, is_enabled: e.target.checked }))}
              />
              Enable AI features for this institution
            </label>
          </div>

          <TestResult result={testResult} />

          <div className={styles.actions}>
            <button
              className="btn btn-secondary"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending || !form.model}
            >
              {testMutation.isPending ? <Spinner size={14} /> : <Zap size={14} />}
              Test connection
            </button>
            <button
              className="btn btn-primary"
              onClick={() => saveMutation.mutate()}
              disabled={
                saveMutation.isPending ||
                !form.provider ||
                !form.model ||
                (selectedProvider?.requiresKey && !config?.has_api_key && !form.api_key) ||
                (form.provider === 'azure_openai' && !form.base_url)
              }
            >
              {saveMutation.isPending ? <Spinner size={14} /> : <Save size={14} />}
              {saved ? 'Saved!' : 'Save configuration'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}