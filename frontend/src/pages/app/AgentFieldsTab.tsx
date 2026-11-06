import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, User, Building2, UsersRound, Bot, AlertCircle } from 'lucide-react'
import { agentsApi } from '@/api'
import type { AgentType, AgentTypeSchemaInfo } from '@/types'
import { Spinner } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import { MetadataSchemaEditor } from './HierarchyPage'
import type { MetadataField } from './MetadataTemplatesPage'
import styles from './AgentFieldsTab.module.css'

const AGENT_TYPES: AgentType[] = ['person', 'organization', 'family', 'software']

const AGENT_TYPE_ICONS: Record<AgentType, typeof User> = {
  person: User,
  organization: Building2,
  family: UsersRound,
  software: Bot,
}

// ─── Editor for one agent type ────────────────────────────────────────

function AgentTypeSchemaEditor({ schema }: { schema: AgentTypeSchemaInfo }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const initial = (schema.metadata_schema?.fields ?? []) as MetadataField[]
  const [fields, setFields] = useState<MetadataField[]>(initial)
  const [dirty, setDirty] = useState(false)

  const saveMutation = useMutation({
    mutationFn: () => agentsApi.updateTypeSchema(schema.agent_type, { fields }),
    onSuccess: () => {
      setDirty(false)
      queryClient.invalidateQueries({ queryKey: ['agent-type-schemas'] })
      queryClient.invalidateQueries({ queryKey: ['agent-type-schema', schema.agent_type] })
      queryClient.invalidateQueries({ queryKey: ['agent'] })
    },
  })

  const saveError = saveMutation.error as any

  return (
    <div className={styles.editor}>
      <MetadataSchemaEditor
        fields={fields}
        onChange={next => { setFields(next); setDirty(true) }}
        entityType="agent"
      />

      {saveError && (
        <div className={styles.error}>
          <AlertCircle size={13} /> {saveError.response?.data?.message ?? t('resources.form.genericError')}
        </div>
      )}

      {dirty && (
        <div className={styles.saveBar}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setFields(initial); setDirty(false); saveMutation.reset() }}
          >
            {t('admin.hierarchy.reset')}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? <Spinner size={13} /> : <Save size={13} />}
            {t('admin.agentFields.save')}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Tab ──────────────────────────────────────────────────────────────

export default function AgentFieldsTab() {
  const { t } = useTranslation()
  const [active, setActive] = useState<AgentType>('person')

  const { data: schemas = [], isLoading } = useQuery({
    queryKey: ['agent-type-schemas'],
    queryFn: agentsApi.getTypeSchemas,
  })

  if (isLoading) return <div className={styles.tab}><Spinner /></div>

  const current = schemas.find(s => s.agent_type === active)

  return (
    <div className={styles.tab}>
      <p className={styles.intro}>{t('admin.agentFields.intro')}</p>

      <div className={styles.typeSwitcher}>
        {AGENT_TYPES.map(at => {
          const Icon = AGENT_TYPE_ICONS[at]
          const count = schemas.find(s => s.agent_type === at)?.metadata_schema?.fields?.length ?? 0
          return (
            <button
              key={at}
              className={`${styles.typeButton} ${active === at ? styles.typeButtonActive : ''}`}
              onClick={() => setActive(at)}
            >
              <Icon size={14} />
              {t(`agents.types.${at}`)}
              {count > 0 && <span className={styles.count}>{count}</span>}
            </button>
          )
        })}
      </div>

      {current && <AgentTypeSchemaEditor key={active} schema={current} />}
    </div>
  )
}