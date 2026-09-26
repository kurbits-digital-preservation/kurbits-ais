import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Zap, CheckCircle, Eye, EyeOff } from 'lucide-react'
import { whisperApi } from '@/api'
import { Spinner } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import styles from './WhisperConfigTab.module.css'

// ─── Form ─────────────────────────────────────────────────────────────

function WhisperForm({ config }: { config: any }) {
  const { t } = useTranslation()
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
      setFetchError(err?.response?.data?.message ?? t('admin.whisper.couldNotReach'))
    },
  })

  return (
    <div className={styles.tabContent}>
      <p className={styles.intro}>
        {t('admin.whisper.intro')}
      </p>

      <div className={styles.fieldSection}>
        <div className={styles.fieldSectionTitle}>{t('admin.whisper.serviceConnection')}</div>

        <div className={styles.fieldGrid}>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>{t('admin.whisper.serviceUrl')}</label>
            <input value={serviceUrl} onChange={e => setServiceUrl(e.target.value)}
              placeholder="http://whisper-service:8000" />
            <span className="form-hint">
              {t('admin.whisper.serviceUrlHint')}
            </span>
          </div>

          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>{t('admin.whisper.apiKey')} {hasKey ? t('admin.whisper.apiKeyExistingHint') : ''}</label>
            <div className={styles.keyRow}>
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={hasKey ? '••••••••••••••••' : t('admin.whisper.apiKeyPlaceholderNew')}
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
        <div className={styles.fieldSectionTitle}>{t('admin.whisper.defaultModel')}</div>
        <p className={styles.fieldHint}>
          {t('admin.whisper.defaultModelHint')}
        </p>

        <div className={styles.modelRow}>
          {models.length > 0 ? (
            <select value={model} onChange={e => setModel(e.target.value)}
              style={{ flex: 1 }}>
              <option value="">{t('admin.whisper.selectModelEllipsis')}</option>
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
            title={t('admin.whisper.fetchModelsTitle')}>
            {fetchModelsMutation.isPending ? <Spinner size={14} /> : <Zap size={14} />}
            {t('admin.whisper.fetchModels')}
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
            {t('admin.whisper.modelsAvailable', { count: models.length })}
          </p>
        )}
      </div>

      <div className={styles.actions}>
        <button className="btn btn-primary"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !serviceUrl.trim()}>
          {saveMutation.isPending ? <Spinner size={14} /> : <Save size={14} />}
          {saved ? t('admin.settings.saved') : t('admin.whisper.saveConfig')}
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
