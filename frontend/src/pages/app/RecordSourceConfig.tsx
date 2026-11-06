import { Fragment, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X, Save, ArrowLeft, AlertCircle, Sparkles } from 'lucide-react'
import { hierarchyApi, integrationsApi, sourcesApi, identifierSchemesApi } from '@/api'
import type {
  ExternalIntegration, LevelSource, SourceKeyInfo, SourceMapping, SourceNodeTarget,
} from '@/types'
import { Spinner } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import styles from './RecordSourceConfig.module.css'

const IDENTIFIER_TARGET = 'identifier'

interface SavedField {
  name: string
  label: string
  type: string
}

// ─── Helpers ──────────────────────────────────────────────────────────

function targetKey(m: SourceMapping): string {
  return m.target === IDENTIFIER_TARGET ? `identifier:${(m.scheme ?? '').trim().toLowerCase()}` : m.target
}

function isComplete(m: SourceMapping): boolean {
  if (!m.target || m.sources.length === 0) return false
  if (m.target === IDENTIFIER_TARGET && !(m.scheme ?? '').trim()) return false
  return true
}

// ─── Ordered source keys (first non-empty wins) ───────────────────────

export function SourceKeyChain({
  value, keys, onChange,
}: {
  value: string[]
  keys: SourceKeyInfo[]
  onChange: (v: string[]) => void
}) {
  const { t } = useTranslation()
  const labelFor = (k: string) => keys.find(x => x.key === k)?.label ?? k

  const grouped = useMemo(() => {
    const out: Record<string, SourceKeyInfo[]> = {}
    for (const k of keys) {
      if (value.includes(k.key)) continue
      const g = k.group ?? ''
      ;(out[g] ??= []).push(k)
    }
    return out
  }, [keys, value])

  const moveEarlier = (i: number) => {
    if (i === 0) return
    const next = [...value]
    ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
    onChange(next)
  }

  const hasAvailable = Object.values(grouped).some(items => items.length > 0)

  return (
    <div className={styles.chain}>
      {value.map((k, i) => (
        <Fragment key={k}>
          {i > 0 && <span className={styles.chainSep}>{t('admin.hierarchy.recordSources.or')}</span>}
          <span className={styles.chip} title={k}>
            {i > 0 && (
              <button
                type="button"
                className={styles.chipBtn}
                onClick={() => moveEarlier(i)}
                title={t('admin.hierarchy.recordSources.moveEarlier')}
              >
                <ArrowLeft size={10} />
              </button>
            )}
            {labelFor(k)}
            <button type="button" className={styles.chipBtn} onClick={() => onChange(value.filter(x => x !== k))}>
              <X size={10} />
            </button>
          </span>
        </Fragment>
      ))}
      {hasAvailable && (
        <select
          className={styles.addKey}
          value=""
          onChange={e => e.target.value && onChange([...value, e.target.value])}
        >
          <option value="">
            {value.length ? t('admin.hierarchy.recordSources.addFallback') : t('admin.hierarchy.recordSources.addSourceKey')}
          </option>
          {Object.entries(grouped).map(([group, items]) =>
            group ? (
              <optgroup key={group} label={group}>
                {items.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
              </optgroup>
            ) : (
              items.map(k => <option key={k.key} value={k.key}>{k.label}</option>)
            )
          )}
        </select>
      )}
    </div>
  )
}

// ─── One source entry ─────────────────────────────────────────────────

function SourceEntryEditor({
  entry, levelId, integrations, usedIntegrationIds, coreTargets, levelFields, schemeNames, onChange, onRemove,
}: {
  entry: LevelSource
  levelId: number
  integrations: ExternalIntegration[]
  usedIntegrationIds: number[]
  coreTargets: SourceNodeTarget[]
  levelFields: SavedField[]
  schemeNames: string[]
  onChange: (entry: LevelSource) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['source-keys', entry.integration_id],
    queryFn: () => sourcesApi.sourceKeys(entry.integration_id),
    enabled: !!entry.integration_id,
    staleTime: 300_000,
  })

  const suggestMutation = useMutation({
    mutationFn: () => sourcesApi.suggestedMappings(entry.integration_id, levelId),
    onSuccess: mappings => onChange({ ...entry, mappings }),
  })

  const usedTargets = entry.mappings.map(targetKey)
  const datalistId = `source-schemes-${entry.integration_id || 'new'}`

  const updateMapping = (index: number, patch: Partial<SourceMapping>) =>
    onChange({ ...entry, mappings: entry.mappings.map((m, i) => (i === index ? { ...m, ...patch } : m)) })

  const removeMapping = (index: number) =>
    onChange({ ...entry, mappings: entry.mappings.filter((_, i) => i !== index) })

  const addMapping = () =>
    onChange({ ...entry, mappings: [...entry.mappings, { target: '', sources: [] }] })

  const useSuggested = () => {
    if (entry.mappings.length && !confirm(t('admin.hierarchy.recordSources.replaceMappingsConfirm'))) return
    suggestMutation.mutate()
  }

  const targetTaken = (target: string, current: string) => target !== current && usedTargets.includes(target)

  return (
    <div className={styles.entry}>
      <div className={styles.entryHeader}>
        <select
          className={styles.sourceSelect}
          value={entry.integration_id || ''}
          onChange={e => onChange({ ...entry, integration_id: Number(e.target.value), mappings: [] })}
        >
          <option value="">{t('admin.hierarchy.recordSources.selectSource')}</option>
          {integrations
            .filter(i => i.id === entry.integration_id || !usedIntegrationIds.includes(i.id))
            .map(i => <option key={i.id} value={i.id}>{i.name} ({i.plugin_label})</option>)}
        </select>

        <select
          value={entry.fill_mode}
          onChange={e => onChange({ ...entry, fill_mode: e.target.value as LevelSource['fill_mode'] })}
        >
          <option value="empty_only">{t('admin.hierarchy.recordSources.fillEmptyOnly')}</option>
          <option value="overwrite">{t('admin.hierarchy.recordSources.fillOverwrite')}</option>
        </select>

        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          onClick={onRemove}
          title={t('admin.hierarchy.recordSources.removeSource')}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {!!entry.integration_id && (isLoading ? (
        <Spinner size={14} />
      ) : (
        <>
          <div className={styles.mappings}>
            {entry.mappings.length === 0 && (
              <div className={styles.empty}>{t('admin.hierarchy.recordSources.noMappings')}</div>
            )}

            {entry.mappings.map((m, i) => (
              <div key={i} className={`${styles.mappingRow} ${!isComplete(m) ? styles.mappingIncomplete : ''}`}>
                <div className={styles.targetCell}>
                  <select
                    className={styles.targetSelect}
                    value={m.target}
                    onChange={e => updateMapping(i, {
                      target: e.target.value,
                      scheme: e.target.value === IDENTIFIER_TARGET ? (m.scheme ?? '') : undefined,
                    })}
                  >
                    <option value="">{t('admin.hierarchy.recordSources.selectTarget')}</option>
                    <optgroup label={t('admin.hierarchy.recordSources.coreFields')}>
                      {coreTargets.map(ct => (
                        <option key={ct.target} value={ct.target} disabled={targetTaken(ct.target, m.target)}>
                          {ct.label}
                        </option>
                      ))}
                    </optgroup>
                    {levelFields.length > 0 && (
                      <optgroup label={t('admin.hierarchy.recordSources.levelFields')}>
                        {levelFields.map(f => {
                          const target = `meta.${f.name}`
                          return (
                            <option key={target} value={target} disabled={targetTaken(target, m.target)}>
                              {f.label || f.name}
                            </option>
                          )
                        })}
                      </optgroup>
                    )}
                    <optgroup label={t('admin.hierarchy.recordSources.identifierGroup')}>
                      <option value={IDENTIFIER_TARGET}>{t('admin.hierarchy.recordSources.identifierTarget')}</option>
                    </optgroup>
                  </select>

                  {m.target === IDENTIFIER_TARGET && (
                    <input
                      className={styles.schemeInput}
                      list={datalistId}
                      value={m.scheme ?? ''}
                      onChange={e => updateMapping(i, { scheme: e.target.value })}
                      placeholder={t('admin.hierarchy.recordSources.schemePlaceholder')}
                    />
                  )}
                </div>

                <SourceKeyChain value={m.sources} keys={keys} onChange={sources => updateMapping(i, { sources })} />

                <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => removeMapping(i)}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>

          <datalist id={datalistId}>
            {schemeNames.map(n => <option key={n} value={n} />)}
          </datalist>

          <div className={styles.entryActions}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addMapping}>
              <Plus size={13} /> {t('admin.hierarchy.recordSources.addMapping')}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={useSuggested}
              disabled={suggestMutation.isPending}
            >
              {suggestMutation.isPending ? <Spinner size={13} /> : <Sparkles size={13} />}
              {t('admin.hierarchy.recordSources.useSuggested')}
            </button>
          </div>
        </>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────

export default function RecordSourceConfig({ typeId, level }: { typeId: number; level: any }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const initial: LevelSource[] = level.metadata_schema?.record_sources ?? []
  const [sources, setSources] = useState<LevelSource[]>(initial)
  const [dirty, setDirty] = useState(false)
  const levelFields: SavedField[] = level.metadata_schema?.fields ?? []

  const { data: allIntegrations = [] } = useQuery<ExternalIntegration[]>({
    queryKey: ['integrations-admin', 'source'],
    queryFn: () => integrationsApi.list('source'),
  })

  const { data: plugins = [] } = useQuery({
    queryKey: ['source-plugins'],
    queryFn: sourcesApi.plugins,
  })

  const { data: coreTargets = [] } = useQuery({
    queryKey: ['source-node-targets'],
    queryFn: sourcesApi.nodeTargets,
    staleTime: 300_000,
  })

  const { data: schemeNames = [] } = useQuery<string[]>({
    queryKey: ['identifier-scheme-names'],
    queryFn: () => identifierSchemesApi.list().then(r => (r.data.data as any[]).map(s => s.name)),
    staleTime: 60_000,
  })

  const nodePluginKeys = new Set(plugins.filter(p => p.enabled && p.supports.includes('node')).map(p => p.key))
  const integrations = allIntegrations.filter(i => i.plugin && nodePluginKeys.has(i.plugin))

  const update = (next: LevelSource[]) => { setSources(next); setDirty(true) }

  const saveMutation = useMutation({
    mutationFn: () => hierarchyApi.updateLevel(typeId, level.id, {
      metadata_schema: { record_sources: sources.filter(s => !!s.integration_id) },
    }),
    onSuccess: () => {
      setDirty(false)
      queryClient.invalidateQueries({ queryKey: ['hierarchy-levels', typeId] })
      queryClient.invalidateQueries({ queryKey: ['record-sources-for-level'] })
    },
  })

  const incomplete = sources.some(s => s.mappings.some(m => !isComplete(m)))
  const usedIds = sources.map(s => s.integration_id).filter(Boolean)
  const saveError = saveMutation.error as any

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionLabel}>{t('admin.hierarchy.recordSources.title')}</span>
        <span className={styles.sectionHint}>{t('admin.hierarchy.recordSources.hint')}</span>
      </div>

      {integrations.length === 0 ? (
        <p className={styles.empty}>{t('admin.hierarchy.recordSources.noIntegrations')}</p>
      ) : (
        <>
          {sources.map((entry, i) => (
            <SourceEntryEditor
              key={i}
              entry={entry}
              levelId={level.id}
              integrations={integrations}
              usedIntegrationIds={usedIds}
              coreTargets={coreTargets}
              levelFields={levelFields}
              schemeNames={schemeNames}
              onChange={next => update(sources.map((s, j) => (j === i ? next : s)))}
              onRemove={() => update(sources.filter((_, j) => j !== i))}
            />
          ))}

          {usedIds.length < integrations.length && (
            <div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => update([...sources, { integration_id: 0, fill_mode: 'empty_only', mappings: [] }])}
              >
                <Plus size={13} /> {t('admin.hierarchy.recordSources.addSource')}
              </button>
            </div>
          )}

          <p className={styles.footHint}>{t('admin.hierarchy.recordSources.unsavedFieldsHint')}</p>
        </>
      )}

      {dirty && incomplete && (
        <div className={styles.warning}>
          <AlertCircle size={13} /> {t('admin.hierarchy.recordSources.incomplete')}
        </div>
      )}

      {saveError && (
        <div className={styles.error}>
          <AlertCircle size={13} /> {saveError.response?.data?.message ?? t('resources.form.genericError')}
        </div>
      )}

      {dirty && (
        <div className={styles.saveBar}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => { setSources(initial); setDirty(false); saveMutation.reset() }}
          >
            {t('admin.hierarchy.reset')}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => saveMutation.mutate()}
            disabled={incomplete || saveMutation.isPending}
          >
            {saveMutation.isPending ? <Spinner size={13} /> : <Save size={13} />}
            {t('admin.hierarchy.recordSources.save')}
          </button>
        </div>
      )}
    </div>
  )
}