import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Search, Loader, DownloadCloud, X, Check, AlertTriangle, ExternalLink, Fingerprint, Tag } from 'lucide-react'
import { sourcesApi } from '@/api'
import type {
  AgentSourceApplyResult, AgentSourceImport, AgentType, SourceHit, SourcePreview,
} from '@/types'
import { useTranslation } from 'react-i18next'
import styles from '@/components/node/RecordSourcePanel.module.css'

interface AgentSourcePanelProps {
  agentType: AgentType
  agentId?: number
  currentAgent: Record<string, unknown>
  currentMeta: Record<string, unknown>
  pendingImports: AgentSourceImport[]
  onApply: (result: AgentSourceApplyResult) => void
  onRemovePending: (integrationId: number, kind: 'identifier' | 'name_form', key: string) => void
}

export default function AgentSourcePanel({
  agentType, agentId, currentAgent, currentMeta, pendingImports, onApply, onRemovePending,
}: AgentSourcePanelProps) {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [debouncedQ, setDQ] = useState('')
  const [preview, setPreview] = useState<SourcePreview | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [appliedLabel, setAppliedLabel] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: sources = [] } = useQuery({
    queryKey: ['agent-sources-for-type', agentType],
    queryFn: () => sourcesApi.forAgentType(agentType),
    staleTime: 60_000,
  })

  const active = sources.find(s => s.integration_id === activeId) ?? sources[0]

  useEffect(() => {
    setActiveId(null)
    setQuery('')
    setDQ('')
    setPreview(null)
    setAppliedLabel(null)
  }, [agentType])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDQ(query.trim()), 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  const { data: hits = [], isFetching, error: searchError } = useQuery({
    queryKey: ['source-search', active?.integration_id, debouncedQ],
    queryFn: () => sourcesApi.search(active!.integration_id, debouncedQ),
    enabled: !!active && debouncedQ.length >= 2 && !preview,
    staleTime: 30_000,
    retry: false,
  })

  const previewMutation = useMutation({
    mutationFn: (hit: SourceHit) => sourcesApi.agentPreview({
      agent_type: agentType,
      integration_id: active!.integration_id,
      external_id: hit.external_id,
      agent_id: agentId ?? null,
      current: { agent: currentAgent, meta: currentMeta },
    }),
    onSuccess: data => {
      setPreview(data)
      setSelected(Object.fromEntries(data.rows.map(r => [r.key, r.selected])))
    },
  })

  if (!sources.length || !active) return null

  const closePreview = () => {
    setPreview(null)
    setSelected({})
    previewMutation.reset()
  }

  const selectableRows = preview?.rows.filter(r => r.selectable) ?? []
  const selectedCount = selectableRows.filter(r => selected[r.key]).length
  const allSelected = selectableRows.length > 0 && selectedCount === selectableRows.length

  const toggleAll = () =>
    setSelected(Object.fromEntries(selectableRows.map(r => [r.key, !allSelected])))

  const apply = () => {
    if (!preview) return
    const result: AgentSourceApplyResult = {
      agent: {},
      meta: {},
      sourceImport: {
        integration_id: preview.integration_id,
        integration_name: preview.integration_name,
        external_id: preview.external_id,
        token: preview.import_token,
        identifiers: [],
        name_forms: [],
      },
    }
    for (const row of selectableRows) {
      if (!selected[row.key]) continue
      if (row.kind === 'agent') result.agent[row.field] = String(row.value ?? '')
      else if (row.kind === 'meta') result.meta[row.field] = row.value
      else if (row.kind === 'identifier' && row.scheme) {
        result.sourceImport.identifiers.push({ scheme: row.scheme, value: String(row.value) })
      } else if (row.kind === 'name_form') {
        result.sourceImport.name_forms.push({
          type: row.name_form_type ?? row.field,
          names: Array.isArray(row.value) ? (row.value as string[]) : [],
        })
      }
    }
    onApply(result)
    setAppliedLabel(`${preview.label} (${preview.external_id})`)
    closePreview()
    setQuery('')
    setDQ('')
  }

  const errorMessage = (err: unknown) =>
    (err as any)?.response?.data?.message ?? t('resources.form.recordSource.previewError')

  const pendingIdentifiers = pendingImports.flatMap(imp =>
    imp.identifiers.map(i => ({ ...i, integration_id: imp.integration_id }))
  )
  const pendingNameForms = pendingImports.flatMap(imp =>
    imp.name_forms.map(nf => ({ ...nf, integration_id: imp.integration_id }))
  )

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.title}>
          <DownloadCloud size={14} /> {t('resources.form.recordSource.title')}
        </span>
        {sources.length > 1 ? (
          <select
            className={styles.sourceSelect}
            value={active.integration_id}
            onChange={e => { setActiveId(Number(e.target.value)); closePreview(); setQuery('') }}
          >
            {sources.map(s => <option key={s.integration_id} value={s.integration_id}>{s.name}</option>)}
          </select>
        ) : (
          <span className={styles.sourceBadge}>{active.name}</span>
        )}
      </div>

      {/* Search */}
      {!preview && (
        <>
          <div className={styles.inputRow}>
            {(isFetching || previewMutation.isPending)
              ? <Loader size={14} className={`${styles.inputIcon} ${styles.spinner}`} />
              : <Search size={14} className={styles.inputIcon} />}
            <input
              className={styles.input}
              value={query}
              onChange={e => { setQuery(e.target.value); setAppliedLabel(null) }}
              placeholder={active.search_hint || t('resources.form.recordSource.searchPlaceholder')}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          {searchError && <div className={styles.error}>{errorMessage(searchError)}</div>}
          {previewMutation.error && <div className={styles.error}>{errorMessage(previewMutation.error)}</div>}

          {debouncedQ.length >= 2 && !isFetching && !searchError && hits.length === 0 && (
            <div className={styles.empty}>{t('resources.form.recordSource.noResults')}</div>
          )}

          {hits.length > 0 && (
            <div className={styles.results}>
              {hits.map(hit => (
                <button
                  key={hit.external_id}
                  type="button"
                  className={styles.resultRow}
                  onClick={() => previewMutation.mutate(hit)}
                  disabled={previewMutation.isPending}
                >
                  <span className={styles.resultId}>{hit.external_id}</span>
                  <span className={styles.resultLabel}>{hit.label}</span>
                  {hit.description && <span className={styles.resultDesc}>{hit.description}</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Preview */}
      {preview && (
        <div className={styles.preview}>
          <div className={styles.previewHeader}>
            <div>
              <div className={styles.previewTitle}>{preview.label}</div>
              <div className={styles.previewId}>
                {preview.integration_name} · {preview.external_id}
                {preview.source_url && (
                  <a href={preview.source_url} target="_blank" rel="noreferrer" className={styles.previewLink}>
                    <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </div>
            {selectableRows.length > 0 && (
              <label className={styles.selectAll}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                {t('resources.form.recordSource.selectAll')}
              </label>
            )}
          </div>

          <div className={styles.table}>
            <div className={`${styles.tableRow} ${styles.tableHead}`}>
              <span />
              <span>{t('resources.form.recordSource.field')}</span>
              <span>{t('resources.form.recordSource.current')}</span>
              <span>{t('resources.form.recordSource.new')}</span>
            </div>

            {preview.rows.map(row => (
              <div key={row.key} className={`${styles.tableRow} ${!row.selectable ? styles.rowDisabled : ''}`}>
                <input
                  type="checkbox"
                  checked={row.selectable && !!selected[row.key]}
                  disabled={!row.selectable}
                  onChange={e => setSelected(s => ({ ...s, [row.key]: e.target.checked }))}
                />
                <span className={styles.cellLabel}>
                  {row.kind === 'identifier' && <Fingerprint size={11} />}
                  {row.kind === 'name_form' && <Tag size={11} />}
                  {row.label}
                </span>
                <span className={`${styles.cellValue} ${styles.cellCurrent}`} title={row.current}>
                  {row.current || <em>{t('resources.form.recordSource.empty')}</em>}
                </span>
                <span className={styles.cellValue} title={row.proposed}>
                  {row.proposed}
                  {row.status === 'unchanged' && (
                    <span className={styles.note}><Check size={10} /> {t('resources.form.recordSource.unchanged')}</span>
                  )}
                  {row.status === 'attached' && (
                    <span className={styles.note}><Check size={10} /> {t('resources.form.recordSource.alreadyAttached')}</span>
                  )}
                  {row.message && (
                    <span className={styles.warningNote}><AlertTriangle size={10} /> {row.message}</span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className={styles.actions}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={closePreview}>
              <X size={13} /> {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={apply} disabled={selectedCount === 0}>
              <Check size={13} /> {t('resources.form.recordSource.apply', { count: selectedCount })}
            </button>
          </div>
        </div>
      )}

      {appliedLabel && !preview && (
        <div className={styles.applied}>
          <Check size={12} /> {t('resources.form.recordSource.applied', { label: appliedLabel })}
        </div>
      )}

      {/* Identifiers and name forms created on save */}
      {(pendingIdentifiers.length > 0 || pendingNameForms.length > 0) && (
        <div className={styles.pending}>
          <span className={styles.pendingTitle}>{t('agents.form.source.pendingTitle')}</span>
          <div className={styles.pendingList}>
            {pendingIdentifiers.map(item => (
              <span key={`id:${item.integration_id}:${item.scheme}`} className={styles.pendingChip}>
                <Fingerprint size={10} /> {item.scheme}: {item.value}
                <button
                  type="button"
                  className={styles.chipBtn}
                  onClick={() => onRemovePending(item.integration_id, 'identifier', item.scheme)}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            {pendingNameForms.map(item => (
              <span
                key={`nf:${item.integration_id}:${item.type}`}
                className={styles.pendingChip}
                title={item.names.join('\n')}
              >
                <Tag size={10} /> {item.type}: {t('agents.form.source.nameCount', { count: item.names.length })}
                <button
                  type="button"
                  className={styles.chipBtn}
                  onClick={() => onRemovePending(item.integration_id, 'name_form', item.type)}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}