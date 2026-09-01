import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ListChecks, Plus, Trash2 } from 'lucide-react'
import { classificationsApi } from '@/api'
import { Spinner } from '@/components/ui'
import styles from './RecordsVocabularyTab.module.css'

const FIELDS: { key: string; label: string; hint: string }[] = [
  { key: 'disposal', label: 'Disposal actions', hint: 'What happens to the records at end of retention.' },
  { key: 'security', label: 'Security classifications', hint: 'Access / confidentiality levels.' },
  { key: 'medium', label: 'Medium / format', hint: 'Physical or digital carrier types.' },
]

function VocabColumn({ field, label, hint, terms }: {
  field: string; label: string; hint: string; terms: any[]
}) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState('')

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['records-vocabulary-admin'] })

  const addMutation = useMutation({
    mutationFn: () => classificationsApi.addRecordsVocabTerm(field, value.trim()),
    onSuccess: () => { invalidate(); setValue('') },
    onError: (err: any) => alert(err?.response?.data?.message ?? 'Could not add'),
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
          placeholder="Add value…"
        />
        <button className="btn btn-secondary btn-sm btn-icon"
          disabled={!value.trim() || addMutation.isPending}
          onClick={() => addMutation.mutate()}>
          {addMutation.isPending ? <Spinner size={13} /> : <Plus size={13} />}
        </button>
      </div>

      <div className={styles.terms}>
        {terms.length === 0 && <p className={styles.empty}>No values yet.</p>}
        {terms.map(t => (
          <div key={t.id} className={styles.term}>
            <span>{t.value}</span>
            <button className="btn btn-ghost btn-sm btn-icon"
              onClick={() => { if (confirm(`Delete "${t.value}"?`)) deleteMutation.mutate(t.id) }}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function RecordsVocabularyTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['records-vocabulary-admin'],
    queryFn: () => classificationsApi.getRecordsVocabulary().then(r => r.data.data),
  })

  if (isLoading) return <div className={styles.tab}><Spinner /></div>

  return (
    <div className={styles.tab}>
      <div className={styles.header}>
        <h3 className={styles.heading}><ListChecks size={16} /> Records-management values</h3>
        <p className={styles.sub}>
          Dropdown values used when documenting records produced by a process.
        </p>
      </div>
      <div className={styles.columns}>
        {FIELDS.map(f => (
          <VocabColumn
            key={f.key}
            field={f.key}
            label={f.label}
            hint={f.hint}
            terms={(data?.[f.key] ?? [])}
          />
        ))}
      </div>
    </div>
  )
}
