import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Zap, CheckCircle, Eye, EyeOff } from 'lucide-react'
import { whisperApi } from '@/api'
import { Spinner } from '@/components/ui'
import styles from './WhisperConfigTab.module.css'

// ─── Form ─────────────────────────────────────────────────────────────

function WhisperForm({ config }: { config: any }) {
  const queryClient = useQueryClient()

  const [serviceUrl, setServiceUrl] = useState(config?.service_url ?? '')
  const [apiKey, setApiKey]         = useState('')
  const [model, setModel]           = useState(config?.model ?? '')
  const [showKey, setShowKey]       = useState(false)
  const [models, setModels]         = useState<string[]>([])
  const [fetchError, setFetchError] = useState('')
  const [saved, setSaved]           = useState(false)

  const hasKey = config?.has_api_key ?? false

  const saveMutation = useMutation({
    mutationFn: () => whisperApi.saveConfig({
      service_url: serviceUrl.trim(),
      api_key:     apiKey.trim() || undefined,
      model:       model.trim() || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whisper-config'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      setApiKey('')
    },
  })

  const fetchModelsMutation = useMutation({
    mutationFn: () => whisperApi.getModels(),
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
          disabled={saveMutation.isPending || !serviceUrl.trim()}>
          {saveMutation.isPending ? <Spinner size={14} /> : <Save size={14} />}
          {saved ? 'Saved!' : 'Save Whisper config'}
        </button>
      </div>
    </div>
  )
}

// ─── Tab ──────────────────────────────────────────────────────────────

export default function WhisperConfigTab() {
  const { data: config, isLoading } = useQuery({
    queryKey: ['whisper-config'],
    queryFn: () => whisperApi.getConfig().then(r => r.data.data),
  })

  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-8)' }}>
      <Spinner />
    </div>
  )

  return (
    <div className={styles.wrap}>
      <WhisperForm config={config} />
    </div>
  )
}
