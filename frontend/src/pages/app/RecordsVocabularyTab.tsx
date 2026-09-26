import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ListChecks, Plus, Trash2 } from 'lucide-react'
import { classificationsApi } from '@/api'
import { Spinner } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import styles from './RecordsVocabularyTab.module.css'

const FIELD_KEYS = ['disposal', 'security', 'medium']

function VocabColumn({ field, label, hint, terms }: {
  field: string; label: string; hint: string; terms: any[]
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [value, setValue] = useState('')

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['records-vocabulary-admin'] })

  const addMutation = useMutation({
    mutationFn: () => classificationsApi.addRecordsVocabTerm(field, value.trim()),
    onSuccess: () => { invalidate(); setValue('') },
    onError: (err: any) => alert(err?.response?.data?.message ?? t('admin.recordsVocab.couldNotAdd')),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => classificationsApi.deleteRecordsVocabTerm(id),
    onSuccess: invalidate,
  })

  return (
    <div className={styles.column}>
      <div className={styles.columnHead}>
        <h4 className={styles.columnTitle}>{label}</h4>
        <p className={styles.columnHint}>{hint}</p>
      </div>

      <div className={styles.addRow}>
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && value.trim()) addMutation.mutate() }}
          placeholder={t('admin.recordsVocab.addValuePlaceholder')}
        />
        <button className="btn btn-secondary btn-sm btn-icon"
          disabled={!value.trim() || addMutation.isPending}
          onClick={() => addMutation.mutate()}>
          {addMutation.isPending ? <Spinner size={13} /> : <Plus size={13} />}
        </button>
      </div>

      <div className={styles.terms}>
        {terms.length === 0 && <p className={styles.empty}>{t('admin.recordsVocab.noValuesYet')}</p>}
        {terms.map(term => (
          <div key={term.id} className={styles.term}>
            <span>{term.value}</span>
            <button className="btn btn-ghost btn-sm btn-icon"
              onClick={() => { if (confirm(t('admin.recordsVocab.deleteConfirm', { value: term.value }))) deleteMutation.mutate(term.id) }}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function RecordsVocabularyTab() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['records-vocabulary-admin'],
    queryFn: () => classificationsApi.getRecordsVocabulary().then(r => r.data.data),
  })

  if (isLoading) return <div className={styles.tab}><Spinner /></div>

  return (
    <div className={styles.tab}>
      <div className={styles.header}>
        <h3 className={styles.heading}><ListChecks size={16} /> {t('admin.recordsVocab.heading')}</h3>
        <p className={styles.sub}>
          {t('admin.recordsVocab.subheading')}
        </p>
      </div>
      <div className={styles.columns}>
        {FIELD_KEYS.map(key => (
          <VocabColumn
            key={key}
            field={key}
            label={t(`admin.recordsVocab.fields.${key}.label`)}
            hint={t(`admin.recordsVocab.fields.${key}.hint`)}
            terms={(data?.[key] ?? [])}
          />
        ))}
      </div>
    </div>
  )
}
