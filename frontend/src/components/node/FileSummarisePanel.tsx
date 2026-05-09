import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Sparkles, Check, X, Bot } from 'lucide-react'
import { aiApi } from '@/api'
import { Spinner } from '@/components/ui'
import styles from './FileSummarisePanel.module.css'

type NoteType = 'scope_and_content' | 'arrangement' | 'general'

const NOTE_LABELS: Record<NoteType, string> = {
  scope_and_content: 'Scope & content',
  arrangement: 'Arrangement',
  general: 'General note',
}

interface Props {
  nodeId: number
  filename: string
  onSaveNote: (content: string, noteType: string) => void
  isSavingNote: boolean
}

export default function FileSummarisePanel({
  nodeId,
  filename,
  onSaveNote,
  isSavingNote,
}: Props) {
  const [noteType, setNoteType] = useState<NoteType>('scope_and_content')
  const [draft, setDraft] = useState<string | null>(null)

  const summariseMutation = useMutation({
    mutationFn: () => aiApi.draftNodeNote(nodeId, noteType),
    onSuccess: (res) => setDraft(res.data.data.draft),
  })

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.typeRow}>
          {(Object.keys(NOTE_LABELS) as NoteType[]).map((t) => (
            <button
              key={t}
              className={`${styles.typeBtn} ${noteType === t ? styles.typeBtnActive : ''}`}
              onClick={() => {
                setNoteType(t)
                setDraft(null)
              }}
            >
              {NOTE_LABELS[t]}
            </button>
          ))}
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => summariseMutation.mutate()}
          disabled={summariseMutation.isPending}
          title={`Summarise ${filename}`}
        >
          {summariseMutation.isPending ? (
            <>
              <Spinner size={12} /> Summarising...
            </>
          ) : (
            <>
              <Sparkles size={12} /> Summarise
            </>
          )}
        </button>
      </div>

      {summariseMutation.isError && (
        <div className={styles.error}>
          {(summariseMutation.error as any)?.response?.data?.message ??
            'Summarisation failed'}
        </div>
      )}

      {draft !== null && (
        <div className={styles.draftWrap}>
          <div className={styles.draftHeader}>
            <Bot size={12} />
            <span>AI draft - edit before saving</span>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              style={{ marginLeft: 'auto' }}
              onClick={() => setDraft(null)}
            >
              <X size={11} />
            </button>
          </div>
          <textarea
            className={styles.draftTextarea}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
          />
          <div className={styles.draftActions}>
            <button className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
              Discard
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                onSaveNote(draft, noteType)
                setDraft(null)
              }}
              disabled={isSavingNote || !draft.trim()}
            >
              {isSavingNote ? <Spinner size={12} /> : <Check size={12} />}
              Save as {NOTE_LABELS[noteType].toLowerCase()}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}