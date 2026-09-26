import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Fingerprint, Plus, Trash2, Star, ExternalLink } from 'lucide-react'
import { agentsApi, identifierSchemesApi } from '@/api'
import { Spinner } from '@/components/ui'
import styles from './AgentIdentifiersTab.module.css'

export default function AgentIdentifiersTab({ agentId }: { agentId: number }) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [schemeId, setSchemeId] = useState('')
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const { data: identifiers, isLoading } = useQuery({
    queryKey: ['agent-identifiers', agentId],
    queryFn: () => agentsApi.getIdentifiers(agentId).then(r => r.data.data),
  })

  // Same scheme list as resources — ARK/DOI/ORCID/VIAF/etc. are one shared
  // vocabulary across entity types.
  const { data: schemes } = useQuery({
    queryKey: ['identifier-schemes'],
    queryFn: () => identifierSchemesApi.list().then(r => r.data.data),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['agent-identifiers', agentId] })
    queryClient.invalidateQueries({ queryKey: ['agent', agentId] })
  }

  const addMutation = useMutation({
    mutationFn: () => agentsApi.addIdentifier(agentId, {
      scheme_id: parseInt(schemeId),
      value: value.trim(),
      note: note.trim() || undefined,
    }),
    onSuccess: () => { invalidate(); resetForm() },
    onError: (err: any) => setErrorMsg(err?.response?.data?.message ?? 'Could not add identifier'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => agentsApi.deleteIdentifier(agentId, id),
    onSuccess: invalidate,
  })

  const primaryMutation = useMutation({
    mutationFn: (id: number) => agentsApi.updateIdentifier(agentId, id, { is_primary: true }),
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
        <span className={styles.title}><Fingerprint size={14} /> Identifiers</span>
        {!adding && (
          <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>
            <Plus size={13} /> Add identifier
          </button>
        )}
      </div>

      {adding && (
        <div className={styles.addForm}>
          <div className="form-group">
            <label>Scheme</label>
            <select value={schemeId} onChange={e => { setSchemeId(e.target.value); setErrorMsg('') }} autoFocus>
              <option value="">Select scheme…</option>
              {(schemes ?? []).map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {(schemes ?? []).length === 0 && (
              <span className="form-hint">
                No schemes configured yet — add them under Administration → Identifier schemes.
              </span>
            )}
          </div>

          <div className="form-group">
            <label>Value</label>
            <input
              value={value}
              onChange={e => { setValue(e.target.value); setErrorMsg('') }}
              placeholder={selectedScheme ? `Enter ${selectedScheme.name} value` : 'Identifier value'}
            />
          </div>

          <div className="form-group">
            <label>Note</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional" />
          </div>

          {errorMsg && <div className={styles.errorBanner}>{errorMsg}</div>}

          <div className={styles.formActions}>
            <button className="btn btn-ghost btn-sm" onClick={resetForm}>Cancel</button>
            <button
              className="btn btn-primary btn-sm"
              disabled={!schemeId || !value.trim() || addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending ? <Spinner size={13} /> : <Plus size={13} />} Add
            </button>
          </div>
        </div>
      )}

      {(!identifiers || identifiers.length === 0) && !adding && (
        <p className={styles.empty}>No identifiers yet.</p>
      )}

      <div className={styles.list}>
        {(identifiers ?? []).map((ident: any) => (
          <div key={ident.id} className={styles.item}>
            <div className={styles.itemMain}>
              <div className={styles.itemTop}>
                <span className={styles.schemeName}>{ident.scheme_name}</span>
                {ident.is_primary && (
                  <span className={styles.primaryBadge}><Star size={9} /> Primary</span>
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
                  title="Make primary for this scheme">
                  <Star size={13} />
                </button>
              )}
              <button className="btn btn-ghost btn-sm btn-icon"
                onClick={() => { if (confirm('Delete this identifier?')) deleteMutation.mutate(ident.id) }}
                title="Delete">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
