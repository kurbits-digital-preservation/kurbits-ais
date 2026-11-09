import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Copy, Check, ExternalLink, AlertTriangle, Plus, RefreshCw, Minus } from 'lucide-react'
import { agentsApi } from '@/api'
import { Spinner } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import styles from './WikidataExportDialog.module.css'

const QUICKSTATEMENTS_URL = 'https://quickstatements.toolforge.org/#/batch'

const ACTION_ICONS = {
  create: Plus,
  update: RefreshCw,
  skip: Minus,
} as const

export default function WikidataExportDialog({
  agentIds,
  onClose,
}: {
  agentIds: number[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [createMissing, setCreateMissing] = useState(false)
  const [includeAliases, setIncludeAliases] = useState(false)
  const [includeArchivesAt, setIncludeArchivesAt] = useState(true)
  const [includeRelations, setIncludeRelations] = useState(true)
  const [copied, setCopied] = useState(false)

  const { data, isFetching, error } = useQuery({
    queryKey: ['quickstatements', agentIds, createMissing, includeAliases, includeArchivesAt, includeRelations],
    queryFn: () => agentsApi.quickStatements({
      agent_ids: agentIds,
      create_missing: createMissing,
      include_aliases: includeAliases,
      include_archives_at: includeArchivesAt,
      include_relations: includeRelations,
    }),
    staleTime: 0,
  })

  const copy = async () => {
    if (!data?.commands) return
    await navigator.clipboard.writeText(data.commands)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const errorMessage = (error as any)?.response?.data?.message

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className={styles.header}>
          <h2 className={styles.title}>{t('agents.wikidata.title')}</h2>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label={t('common.cancel')}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          <p className={styles.intro}>{t('agents.wikidata.intro')}</p>

          <div className={styles.options}>
            <label className={styles.option}>
              <input type="checkbox" checked={createMissing} onChange={e => setCreateMissing(e.target.checked)} />
              {t('agents.wikidata.createMissing')}
            </label>
            <label className={styles.option}>
              <input type="checkbox" checked={includeArchivesAt} onChange={e => setIncludeArchivesAt(e.target.checked)} />
              {t('agents.wikidata.includeArchivesAt')}
            </label>
            <label className={styles.option}>
              <input type="checkbox" checked={includeRelations} onChange={e => setIncludeRelations(e.target.checked)} />
              {t('agents.wikidata.includeRelations')}
            </label>
            <label className={styles.option}>
              <input type="checkbox" checked={includeAliases} onChange={e => setIncludeAliases(e.target.checked)} />
              {t('agents.wikidata.includeAliases')}
            </label>
          </div>

          {data && !data.settings.has_institution_qid && includeArchivesAt && (
            <div className={styles.notice}>
              <AlertTriangle size={13} /> {t('agents.wikidata.missingInstitutionQid')}
            </div>
          )}
          {data && !data.settings.has_reference_template && (
            <div className={styles.notice}>
              <AlertTriangle size={13} /> {t('agents.wikidata.missingReferenceTemplate')}
            </div>
          )}
          {data && !data.settings.has_relation_properties && includeRelations && (
            <div className={styles.notice}>
              <AlertTriangle size={13} /> {t('agents.wikidata.missingRelationProperties')}
            </div>
          )}

          {errorMessage && <div className={styles.error}>{errorMessage}</div>}

          {isFetching && !data ? (
            <Spinner />
          ) : data && (
            <>
              <ul className={styles.summary}>
                {data.agents.map(agent => {
                  const Icon = ACTION_ICONS[agent.action]
                  return (
                    <li key={agent.id} className={styles.summaryRow}>
                      <span className={`${styles.action} ${styles[`action_${agent.action}`]}`}>
                        <Icon size={11} /> {t(`agents.wikidata.action.${agent.action}`)}
                      </span>
                      <span className={styles.agentName}>{agent.name}</span>
                      {agent.qid && <span className={styles.qid}>{agent.qid}</span>}
                      {agent.statements > 0 && (
                        <span className={styles.count}>
                          {t('agents.wikidata.statements', { count: agent.statements })}
                        </span>
                      )}
                      {agent.warnings.map((w, i) => (
                        <span key={i} className={styles.warning}><AlertTriangle size={10} /> {w}</span>
                      ))}
                    </li>
                  )
                })}
              </ul>

              {data.commands ? (
                <textarea
                  className={styles.commands}
                  value={data.commands}
                  readOnly
                  rows={Math.min(16, data.commands.split('\n').length + 1)}
                  spellCheck={false}
                  onFocus={e => e.currentTarget.select()}
                />
              ) : (
                <p className={styles.empty}>{t('agents.wikidata.noCommands')}</p>
              )}
            </>
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.footHint}>{t('agents.wikidata.howTo')}</span>
          <div className={styles.footerActions}>
            <button className="btn btn-secondary btn-sm" onClick={copy} disabled={!data?.commands}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? t('agents.wikidata.copied') : t('agents.wikidata.copy')}
            </button>
            <a
              className="btn btn-primary btn-sm"
              href={QUICKSTATEMENTS_URL}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={13} /> {t('agents.wikidata.openQuickStatements')}
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}