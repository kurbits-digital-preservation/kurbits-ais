import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Bot, Check, X, ChevronDown, Sparkles } from 'lucide-react'
import { aiApi } from '@/api'
import { Spinner } from '@/components/ui'
import styles from './DraftNodeNoteButton.module.css'

type NoteType = 'scope_and_content' | 'arrangement' | 'general'

const NOTE_LABELS: Record<NoteType, string> = {
  scope_and_content: 'Scope & content',
  arrangement: 'Arrangement',
  general: 'General note',
}

interface Props {
  nodeId: number
  hasAttachmentText: boolean
  onSave: (content: string, noteType: string) => void
  isSaving: boolean
}

export default function DraftNodeNoteButton({ nodeId, hasAttachmentText, onSave, isSaving }: Props) {
  const [open, setOpen] = useState(false)
  const [noteType, setNoteType] = useState<NoteType>('scope_and_content')
  const [draft, setDraft] = useState<{ text: string } | null>(null)

  const draftMutation = useMutation({
    mutationFn: () => aiApi.draftNodeNote(nodeId, noteType),
    onSuccess: (res) => setDraft({ text: res.data.data.draft }),
  })

  if (!hasAttachmentText) return null

  return (
    <div className={styles.wrap}>
      <button
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
        onClick={() => { setOpen(v => !v); setDraft(null) }}
        type="button"
      >
        <Bot size={13} />
        <span>Draft note from attachments</span>
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: '0.15s' }} />
      </button>

      {open && (
        <div className={styles.body}>
          {!draft ? (
            <>
              <div className={styles.typeRow}>
                <span className={styles.typeLabel}>Note type:</span>
                {(Object.keys(NOTE_LABELS) as NoteType[]).map(t => (
                  <button
                    key={t}
                    className={`${styles.typeBtn} ${noteType === t ? styles.typeBtnActive : ''}`}
                    onClick={() => setNoteType(t)}
                  >
                    {NOTE_LABELS[t]}
                  </button>
                ))}
              </div>
              <div className={styles.hint}>
                <Sparkles size={11} />
                Summarises text extracted from this node's attachments
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => draftMutation.mutate()}
                disabled={draftMutation.isPending}
              >
                {draftMutation.isPending
                  ? <><Spinner size={13} /> Drafting...</>
                  : <><Bot size={13} /> Generate draft</>}
              </button>
              {draftMutation.isError && (
                <span className={styles.error}>
                  {(draftMutation.error as any)?.response?.data?.message ?? 'Failed to draft'}
                </span>
              )}
            </>
          ) : (
            <>
              <textarea
                className={styles.draftTextarea}
                value={draft.text}
                onChange={e => setDraft({ text: e.target.value })}
                rows={6}
              />
              <div className={styles.actions}>
                <button className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
                  Back
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    onSave(draft.text, noteType)
                    setDraft(null)
                    setOpen(false)
                  }}
                  disabled={isSaving || !draft.text.trim()}
                >
                  {isSaving ? <Spinner size={13} /> : <Check size={13} />}
                  Save as {NOTE_LABELS[noteType].toLowerCase()}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}