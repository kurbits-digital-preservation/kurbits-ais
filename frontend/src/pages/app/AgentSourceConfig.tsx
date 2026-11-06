import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X, Save, AlertCircle, Sparkles } from 'lucide-react'
import { agentsApi, integrationsApi, sourcesApi, identifierSchemesApi, vocabApi } from '@/api'
import type {
  AgentSource, AgentSourceMapping, AgentType, AgentTypeSchemaInfo,
  ExternalIntegration, SourceNodeTarget,
} from '@/types'
import { Spinner } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import { SourceKeyChain } from './RecordSourceConfig'
import type { MetadataField } from './MetadataTemplatesPage'
import styles from './RecordSourceConfig.module.css'

const IDENTIFIER_TARGET = 'identifier'
const NAME_FORM_TARGET = 'name_form'

// ─── Helpers ──────────────────────────────────────────────────────────

function targetKey(m: AgentSourceMapping): string {
  if (m.target === IDENTIFIER_TARGET) return `identifier:${(m.scheme ?? '').trim().toLowerCase()}`
  if (m.target === NAME_FORM_TARGET) return `name_form:${(m.name_form_type ?? '').trim().toLowerCase()}`
  return m.target
}

function isComplete(m: AgentSourceMapping): boolean {
  if (!m.target || m.sources.length === 0) return false
  if (m.target === IDENTIFIER_TARGET && !(m.scheme ?? '').trim()) return false
  if (m.target === NAME_FORM_TARGET && !(m.name_form_type ?? '').trim()) return false
  return true
}

// ─── One source entry ─────────────────────────────────────────────────

function AgentSourceEntryEditor({
  entry, agentType, integrations, usedIntegrationIds, targets, fields,
  schemeNames, nameFormTypes, onChange, onRemove,
}: {
  entry: AgentSource
  agentType: AgentType
  integrations: ExternalIntegration[]
  usedIntegrationIds: number[]
  targets: SourceNodeTarget[]
  fields: MetadataField[]
  schemeNames: string[]
  nameFormTypes: string[]
  onChange: (entry: AgentSource) => void
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
    mutationFn: () => sourcesApi.suggestedAgentMappings(entry.integration_id, agentType),
    onSuccess: mappings => onChange({ ...entry, mappings: mappings as AgentSourceMapping[] }),
  })

  const usedTargets = entry.mappings.map(targetKey)
  const schemeListId = `agent-source-schemes-${agentType}-${entry.integration_id || 'new'}`
  const nameFormListId = `agent-source-nameforms-${agentType}-${entry.integration_id || 'new'}`

  const updateMapping = (index: number, patch: Partial<AgentSourceMapping>) =>
    onChange({ ...entry, mappings: entry.mappings.map((m, i) => (i === index ? { ...m, ...patch } : m)) })

  const removeMapping = (index: number) =>
    onChange({ ...entry, mappings: entry.mappings.filter((_, i) => i !== index) })

  const addMapping = () =>
    onChange({ ...entry, mappings: [...entry.mappings, { target: '', sources: [] }] })

  const useSuggested = () => {
    if (entry.mappings.length && !confirm(t('admin.hierarchy.recordSources.replaceMappingsConfirm'))) return
    suggestMutation.mutate()
  }

  const changeTarget = (index: number, target: string) =>
    updateMapping(index, {
      target,
      scheme: target === IDENTIFIER_TARGET ? (entry.mappings[index].scheme ?? '') : undefined,
      name_form_type: target === NAME_FORM_TARGET ? (entry.mappings[index].name_form_type ?? '') : undefined,
    })

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
          onChange={e => onChange({ ...entry, fill_mode: e.target.value as AgentSource['fill_mode'] })}
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
                    onChange={e => changeTarget(i, e.target.value)}
                  >
                    <option value="">{t('admin.hierarchy.recordSources.selectTarget')}</option>
                    <optgroup label={t('admin.agentFields.agentFieldsGroup')}>
                      {targets.map(at => (
                        <option key={at.target} value={at.target} disabled={targetTaken(at.target, m.target)}>
                          {at.label}
                        </option>
                      ))}
                    </optgroup>
                    {fields.length > 0 && (
                      <optgroup label={t('admin.hierarchy.recordSources.levelFields')}>
                        {fields.map(f => {
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
                    <optgroup label={t('admin.agentFields.nameFormGroup')}>
                      <option value={NAME_FORM_TARGET}>{t('admin.agentFields.nameFormTarget')}</option>
                    </optgroup>
                  </select>

                  {m.target === IDENTIFIER_TARGET && (
                    <input
                      className={styles.schemeInput}
                      list={schemeListId}
                      value={m.scheme ?? ''}
                      onChange={e => updateMapping(i, { scheme: e.target.value })}
                      placeholder={t('admin.hierarchy.recordSources.schemePlaceholder')}
                    />
                  )}

                  {m.target === NAME_FORM_TARGET && (
                    <input
                      className={styles.schemeInput}
                      list={nameFormListId}
                      value={m.name_form_type ?? ''}
                      onChange={e => updateMapping(i, { name_form_type: e.target.value })}
                      placeholder={t('admin.agentFields.nameFormTypePlaceholder')}
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

          <datalist id={schemeListId}>
            {schemeNames.map(n => <option key={n} value={n} />)}
          </datalist>
          <datalist id={nameFormListId}>
            {nameFormTypes.map(n => <option key={n} value={n} />)}
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

export default function AgentSourceConfig({
  agentType, schema,
}: {
  agentType: AgentType
  schema: AgentTypeSchemaInfo
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const initial: AgentSource[] = schema.metadata_schema?.sources ?? []
  const [sources, setSources] = useState<AgentSource[]>(initial)
  const [dirty, setDirty] = useState(false)
  const fields = (schema.metadata_schema?.fields ?? []) as MetadataField[]

  const { data: allIntegrations = [] } = useQuery<ExternalIntegration[]>({
    queryKey: ['integrations-admin', 'source'],
    queryFn: () => integrationsApi.list('source'),
  })

  const { data: plugins = [] } = useQuery({
    queryKey: ['source-plugins'],
    queryFn: sourcesApi.plugins,
  })

  const { data: targets = [] } = useQuery({
    queryKey: ['source-agent-targets'],
    queryFn: sourcesApi.agentTargets,
    staleTime: 300_000,
  })

  const { data: schemeNames = [] } = useQuery<string[]>({
    queryKey: ['identifier-scheme-names'],
    queryFn: () => identifierSchemesApi.list().then(r => (r.data.data as any[]).map(s => s.name)),
    staleTime: 60_000,
  })

  const { data: nameFormTypes = [] } = useQuery<string[]>({
    queryKey: ['agent-name-form-type-names'],
    queryFn: () => vocabApi.listAgentNameFormTypes().then(r => (r.data.data ?? []).map(nft => nft.name)),
    staleTime: 60_000,
  })

  const pluginKeys = new Set(
    plugins
      .filter(p => p.enabled && p.supports.includes('agent')
        && (p.agent_types.length === 0 || p.agent_types.includes(agentType)))
      .map(p => p.key)
  )
  const integrations = allIntegrations.filter(i => i.plugin && pluginKeys.has(i.plugin))

  const update = (next: AgentSource[]) => { setSources(next); setDirty(true) }

  const saveMutation = useMutation({
    mutationFn: () => agentsApi.updateTypeSchema(agentType, {
      sources: sources.filter(s => !!s.integration_id),
    }),
    onSuccess: () => {
      setDirty(false)
      queryClient.invalidateQueries({ queryKey: ['agent-type-schemas'] })
      queryClient.invalidateQueries({ queryKey: ['agent-type-schema', agentType] })
      queryClient.invalidateQueries({ queryKey: ['agent-sources-for-type', agentType] })
    },
  })

  const incomplete = sources.some(s => s.mappings.some(m => !isComplete(m)))
  const usedIds = sources.map(s => s.integration_id).filter(Boolean)
  const saveError = saveMutation.error as any

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionLabel}>{t('admin.agentFields.sourcesTitle')}</span>
        <span className={styles.sectionHint}>{t('admin.agentFields.sourcesHint')}</span>
      </div>

      {integrations.length === 0 ? (
        <p className={styles.empty}>{t('admin.agentFields.noSourceIntegrations')}</p>
      ) : (
        <>
          {sources.map((entry, i) => (
            <AgentSourceEntryEditor
              key={i}
              entry={entry}
              agentType={agentType}
              integrations={integrations}
              usedIntegrationIds={usedIds}
              targets={targets}
              fields={fields}
              schemeNames={schemeNames}
              nameFormTypes={nameFormTypes}
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
          <AlertCircle size={13} /> {t('admin.agentFields.incomplete')}
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
            {t('admin.agentFields.saveSources')}
          </button>
        </div>
      )}
    </div>
  )
}