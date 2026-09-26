import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Fingerprint, Plus, Trash2, Star, ExternalLink, Zap, X } from 'lucide-react'
import { nodesApi, identifierSchemesApi } from '@/api'
import { Spinner } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import styles from './NodeIdentifiersTab.module.css'

export default function NodeIdentifiersTab({ nodeId }: { nodeId: number }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [schemeId, setSchemeId] = useState('')
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const { data: identifiers, isLoading } = useQuery({
    queryKey: ['node-identifiers', nodeId],
    queryFn: () => nodesApi.getIdentifiers(nodeId).then(r => r.data.data),
  })

  const { data: schemes } = useQuery({
    queryKey: ['identifier-schemes'],
    queryFn: () => identifierSchemesApi.list().then(r => r.data.data),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['node-identifiers', nodeId] })
    queryClient.invalidateQueries({ queryKey: ['node', nodeId] })
  }

  const addMutation = useMutation({
    mutationFn: () => nodesApi.addIdentifier(nodeId, {
      scheme_id: parseInt(schemeId),
      value: value.trim(),
      note: note.trim() || undefined,
    }),
    onSuccess: () => { invalidate(); resetForm() },
    onError: (err: any) => setErrorMsg(err?.response?.data?.message ?? t('identifiers.couldNotAdd')),
  })

  const generateMutation = useMutation({
    mutationFn: () => nodesApi.generateIdentifier(nodeId, parseInt(schemeId)),
    onSuccess: () => { invalidate(); resetForm() },
    onError: (err: any) => setErrorMsg(err?.response?.data?.message ?? t('identifiers.generationFailed')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => nodesApi.deleteIdentifier(nodeId, id),
    onSuccess: invalidate,
  })

  const primaryMutation = useMutation({
    mutationFn: (id: number) => nodesApi.updateIdentifier(nodeId, id, { is_primary: true }),
    onSuccess: invalidate,
  })

  const resetForm = () => {
    setAdding(false); setSchemeId(''); setValue(''); setNote(''); setErrorMsg('')
  }

  const selectedScheme = (schemes ?? []).find((s: any) => String(s.id) === schemeId)

  if (isLoading) return <div className={styles.tab}><Spinner /></div>

  return (
    <div className={styles.tab}>
      <div className={styles.header}>
        <span className={styles.title}><Fingerprint size={14} /> {t('resources.tabs.identifiers')}</span>
        {!adding && (
          <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>
            <Plus size={13} /> {t('identifiers.addIdentifier')}
          </button>
        )}
      </div>

      {adding && (
        <div className={styles.addForm}>
          <div className="form-group">
            <label>{t('identifiers.scheme')}</label>
            <select value={schemeId} onChange={e => { setSchemeId(e.target.value); setErrorMsg('') }} autoFocus>
              <option value="">{t('identifiers.selectScheme')}</option>
              {(schemes ?? []).map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {(schemes ?? []).length === 0 && (
              <span className="form-hint">
                {t('identifiers.noSchemesConfigured')}
              </span>
            )}
          </div>

          <div className="form-group">
            <label>{t('identifiers.value')}</label>
            <div className={styles.valueRow}>
              <input
                value={value}
                onChange={e => { setValue(e.target.value); setErrorMsg('') }}
                placeholder={selectedScheme ? t('identifiers.enterValuePlaceholder', { scheme: selectedScheme.name }) : t('identifiers.valuePlaceholder')}
                style={{ flex: 1 }}
              />
              {selectedScheme?.has_generator && (
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={generateMutation.isPending}
                  onClick={() => generateMutation.mutate()}
                  title={t('identifiers.generateTitle', { scheme: selectedScheme.name })}
                >
                  {generateMutation.isPending ? <Spinner size={13} /> : <Zap size={13} />}
                  {t('identifiers.generate')}
                </button>
              )}
            </div>
          </div>

          <div className="form-group">
            <label>{t('identifiers.note')}</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder={t('identifiers.notePlaceholder')} />
          </div>

          {errorMsg && <div className={styles.errorBanner}>{errorMsg}</div>}

          <div className={styles.formActions}>
            <button className="btn btn-ghost btn-sm" onClick={resetForm}>{t('common.cancel')}</button>
            <button
              className="btn btn-primary btn-sm"
              disabled={!schemeId || !value.trim() || addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending ? <Spinner size={13} /> : <Plus size={13} />} {t('common.add')}
            </button>
          </div>
        </div>
      )}

      {(!identifiers || identifiers.length === 0) && !adding && (
        <p className={styles.empty}>{t('identifiers.noneYet')}</p>
      )}

      <div className={styles.list}>
        {(identifiers ?? []).map((ident: any) => (
          <div key={ident.id} className={styles.item}>
            <div className={styles.itemMain}>
              <div className={styles.itemTop}>
                <span className={styles.schemeName}>{ident.scheme_name}</span>
                {ident.is_primary && (
                  <span className={styles.primaryBadge}><Star size={9} /> {t('identifiers.primary')}</span>
                )}
              </div>
              <div className={styles.itemValue}>
                {ident.resolve_url ? (
                  <a href={ident.resolve_url} target="_blank" rel="noreferrer" className={styles.valueLink}>
                    {ident.value} <ExternalLink size={11} />
                  </a>
                ) : (
                  <span className="ref-code">{ident.value}</span>
                )}
              </div>
              {ident.note && <span className={styles.itemNote}>{ident.note}</span>}
            </div>
            <div className={styles.itemActions}>
              {!ident.is_primary && (
                <button className="btn btn-ghost btn-sm btn-icon"
                  onClick={() => primaryMutation.mutate(ident.id)}
                  title={t('identifiers.makePrimary')}>
                  <Star size={13} />
                </button>
              )}
              <button className="btn btn-ghost btn-sm btn-icon"
                onClick={() => { if (confirm(t('identifiers.deleteConfirm'))) deleteMutation.mutate(ident.id) }}
                title={t('common.delete')}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
