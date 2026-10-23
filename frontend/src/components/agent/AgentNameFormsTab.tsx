import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Pencil, Check, X, Signature } from 'lucide-react'
import { agentsApi, vocabApi } from '@/api'
import { Spinner } from '@/components/ui'
import type { AgentNameForm, AgentNameFormType } from '@/types'
import styles from './AgentNameFormsTab.module.css'

interface FormState {
  type_id: string
  name: string
  date_from: string
  date_to: string
}

const EMPTY_FORM: FormState = { type_id: '', name: '', date_from: '', date_to: '' }

function formatDates(from: string | null, to: string | null): string | null {
  if (!from && !to) return null
  return `${from ?? '…'}–${to ?? '…'}`
}

// ─── Shared editor (add + edit) ───────────────────────────────────────

function NameFormEditor({ initial, types, onSave, onCancel, isSaving, errorMsg, saveLabel }: {
  initial: FormState
  types: AgentNameFormType[]
  onSave: (form: FormState) => void
  onCancel: () => void
  isSaving: boolean
  errorMsg: string
  saveLabel: string
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<FormState>(initial)
  const set = (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }))

  const canSave = !!form.type_id && !!form.name.trim() && !isSaving

  return (
    <div className={styles.editor}>
      <div className={styles.editorGrid}>
        <div className="form-group">
          <label>{t('agents.nameForms.type')}</label>
          <select value={form.type_id} onChange={set('type_id')} autoFocus>
            <option value="">{t('agents.nameForms.selectType')}</option>
            {types.map(nt => (
              <option key={nt.id} value={nt.id}>{nt.name}</option>
            ))}
          </select>
          {types.length === 0 && (
            <span className="form-hint">{t('agents.nameForms.noTypesHint')}</span>
          )}
        </div>
        <div className="form-group">
          <label>{t('agents.nameForms.name')}</label>
          <input
            value={form.name}
            onChange={set('name')}
            onKeyDown={e => { if (e.key === 'Enter' && canSave) onSave(form) }}
          />
        </div>
        <div className="form-group">
          <label>{t('agents.nameForms.dateFrom')}</label>
          <input value={form.date_from} onChange={set('date_from')} placeholder={t('agents.form.dateFromPlaceholder')} />
        </div>
        <div className="form-group">
          <label>{t('agents.nameForms.dateTo')}</label>
          <input value={form.date_to} onChange={set('date_to')} placeholder={t('agents.form.dateToPlaceholder')} />
        </div>
      </div>

      {errorMsg && <div className={styles.errorBanner}>{errorMsg}</div>}

      <div className={styles.editorActions}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>
          <X size={13} /> {t('common.cancel')}
        </button>
        <button className="btn btn-primary btn-sm" disabled={!canSave} onClick={() => onSave(form)}>
          {isSaving ? <Spinner size={13} /> : <Check size={13} />} {saveLabel}
        </button>
      </div>
    </div>
  )
}

// ─── Tab ──────────────────────────────────────────────────────────────

export default function AgentNameFormsTab({ agentId }: { agentId: number }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const { data: forms = [], isLoading } = useQuery({
    queryKey: ['agent-name-forms', agentId],
    queryFn: () => agentsApi.getNameForms(agentId).then(r => r.data.data),
  })

  const { data: types = [] } = useQuery({
    queryKey: ['vocab-agent-name-form-types'],
    queryFn: () => vocabApi.listAgentNameFormTypes().then(r => r.data.data),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['agent-name-forms', agentId] })
    queryClient.invalidateQueries({ queryKey: ['agent', agentId] })
    queryClient.invalidateQueries({ queryKey: ['agents'] })
  }

  const toPayload = (form: FormState) => ({
    type_id: parseInt(form.type_id),
    name: form.name.trim(),
    date_from: form.date_from.trim() || null,
    date_to: form.date_to.trim() || null,
  })

  const onError = (err: any) =>
    setErrorMsg(err?.response?.data?.message ?? t('agents.nameForms.saveFailed'))

  const addMutation = useMutation({
    mutationFn: (form: FormState) => agentsApi.addNameForm(agentId, toPayload(form)),
    onSuccess: () => { invalidate(); setAdding(false); setErrorMsg('') },
    onError,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, form }: { id: number; form: FormState }) =>
      agentsApi.updateNameForm(agentId, id, toPayload(form)),
    onSuccess: () => { invalidate(); setEditingId(null); setErrorMsg('') },
    onError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => agentsApi.deleteNameForm(agentId, id),
    onSuccess: invalidate,
  })

  const startAdd = () => { setEditingId(null); setErrorMsg(''); setAdding(true) }
  const startEdit = (id: number) => { setAdding(false); setErrorMsg(''); setEditingId(id) }

  if (isLoading) return <div className={styles.tab}><Spinner /></div>

  return (
    <div className={styles.tab}>
      <div className={styles.header}>
        <span className={styles.title}><Signature size={14} /> {t('agents.nameForms.title')}</span>
        {!adding && (
          <button className="btn btn-secondary btn-sm" onClick={startAdd}>
            <Plus size={13} /> {t('agents.nameForms.add')}
          </button>
        )}
      </div>

      {adding && (
        <NameFormEditor
          initial={EMPTY_FORM}
          types={types}
          onSave={form => addMutation.mutate(form)}
          onCancel={() => { setAdding(false); setErrorMsg('') }}
          isSaving={addMutation.isPending}
          errorMsg={errorMsg}
          saveLabel={t('common.add')}
        />
      )}

      {forms.length === 0 && !adding && (
        <p className={styles.empty}>{t('agents.nameForms.noneYet')}</p>
      )}

      <div className={styles.list}>
        {forms.map((nf: AgentNameForm) => editingId === nf.id ? (
          <NameFormEditor
            key={nf.id}
            initial={{
              type_id: String(nf.type_id),
              name: nf.name,
              date_from: nf.date_from ?? '',
              date_to: nf.date_to ?? '',
            }}
            types={types}
            onSave={form => updateMutation.mutate({ id: nf.id, form })}
            onCancel={() => { setEditingId(null); setErrorMsg('') }}
            isSaving={updateMutation.isPending}
            errorMsg={errorMsg}
            saveLabel={t('common.save')}
          />
        ) : (
          <div key={nf.id} className={styles.item}>
            <div className={styles.itemMain}>
              <span className={styles.typeName}>{nf.type_name}</span>
              <span className={styles.itemName}>{nf.name}</span>
              {formatDates(nf.date_from, nf.date_to) && (
                <span className={styles.itemDates}>{formatDates(nf.date_from, nf.date_to)}</span>
              )}
            </div>
            <div className={styles.itemActions}>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => startEdit(nf.id)} title={t('common.edit')}>
                <Pencil size={13} />
              </button>
              <button
                className="btn btn-ghost btn-sm btn-icon"
                title={t('common.delete')}
                disabled={deleteMutation.isPending}
                onClick={() => { if (confirm(t('agents.nameForms.deleteConfirm', { name: nf.name }))) deleteMutation.mutate(nf.id) }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
