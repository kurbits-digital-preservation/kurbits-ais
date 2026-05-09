import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Sparkles, X, Bot, Copy, Check } from 'lucide-react'
import { aiApi } from '@/api'
import { Spinner } from '@/components/ui'
import styles from './AttachmentSummarisePanel.module.css'

type NoteType = 'scope_and_content' | 'arrangement' | 'general'

const NOTE_LABELS: Record<NoteType, string> = {
  scope_and_content: 'Scope & content',
  arrangement: 'Arrangement',
  general: 'General note',
}

interface Props {
  nodeId: number
  filename: string
  onClose: () => void
}

export default function AttachmentSummarisePanel({ nodeId, filename, onClose }: Props) {
  const [noteType, setNoteType] = useState<NoteType>('scope_and_content')
  const [draft, setDraft] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const summariseMutation = useMutation({
    mutationFn: () => aiApi.draftNodeNote(nodeId, noteType),
    onSuccess: (res) => setDraft(res.data.data.draft),
  })

  const handleCopy = () => {
    if (!draft) return
    navigator.clipboard.writeText(draft).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <Bot size={13} className={styles.headerIcon} />
        <span className={styles.headerTitle}>Summarise: {filename}</span>
        <button
          className="btn btn-ghost btn-sm btn-icon"
          onClick={onClose}
          style={{ marginLeft: 'auto' }}
        >
          <X size={12} />
        </button>
      </div>

      <div className={styles.body}>
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
          <button
            className="btn btn-primary btn-sm"
            onClick={() => summariseMutation.mutate()}
            disabled={summariseMutation.isPending}
            style={{ marginLeft: 'auto' }}
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
          <>
            <textarea
              className={styles.draftTextarea}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={6}
            />
            <div className={styles.draftHint}>
              Edit above then copy into the description or scope note fields.
            </div>
            <div className={styles.draftActions}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleCopy}
              >
                {copied ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy text</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}