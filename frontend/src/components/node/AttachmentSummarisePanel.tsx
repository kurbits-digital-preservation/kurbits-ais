import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles, X, Bot, Copy, Check, Save, FileText, Tag } from 'lucide-react'
import { aiApi, nodesApi } from '@/api'
import { Spinner } from '@/components/ui'
import styles from './AttachmentSummarisePanel.module.css'

const CONFIDENCE_LABELS = {
  high:   { label: 'High confidence', color: 'var(--color-success)' },
  medium: { label: 'Medium confidence', color: 'var(--color-warning)' },
  low:    { label: 'Low confidence', color: 'var(--color-error)' },
}

interface AnalysisResult {
  document_type: string
  confidence: 'high' | 'medium' | 'low'
  summary: string
  key_entities: string[]
  date_hints: string | null
  formatted_note: string
  filename: string
}

interface Props {
  nodeId: number
  attachmentId: number
  filename: string
  onClose: () => void
}

export default function AttachmentSummarisePanel({
  nodeId, attachmentId, filename, onClose,
}: Props) {
  const queryClient = useQueryClient()
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)

  const analyseMutation = useMutation({
    mutationFn: () => aiApi.analyseAttachment(nodeId, attachmentId),
    onSuccess: (res) => setResult(res.data.data),
  })

  const saveNoteMutation = useMutation({
    mutationFn: () => nodesApi.addNote(nodeId, {
      content: result!.formatted_note,
      note_type: 'general',
      is_public: false,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node', nodeId] })
      setSaved(true)
    },
  })

  const handleCopy = () => {
    if (!result) return
    navigator.clipboard.writeText(result.formatted_note).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const conf = result ? CONFIDENCE_LABELS[result.confidence] : null

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <Bot size={13} className={styles.headerIcon} />
        <span className={styles.headerTitle}>
          <FileText size={11} /> {filename}
        </span>
        <button
          className="btn btn-ghost btn-sm btn-icon"
          onClick={onClose}
          style={{ marginLeft: 'auto' }}
        >
          <X size={12} />
        </button>
      </div>

      <div className={styles.body}>
        {!result ? (
          <div className={styles.idle}>
            <p className={styles.idleHint}>
              Detects document type and extracts key information from the text content of this file.
            </p>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => analyseMutation.mutate()}
              disabled={analyseMutation.isPending}
            >
              {analyseMutation.isPending
                ? <><Spinner size={13} /> Analysing...</>
                : <><Sparkles size={13} /> Analyse document</>}
            </button>
            {analyseMutation.isError && (
              <div className={styles.error}>
                {(analyseMutation.error as any)?.response?.data?.message ?? 'Analysis failed'}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Document type */}
            <div className={styles.docType}>
              <Tag size={12} />
              <span className={styles.docTypeLabel}>{result.document_type}</span>
              {conf && (
                <span className={styles.confidence} style={{ color: conf.color }}>
                  {conf.label}
                </span>
              )}
            </div>

            {/* Date hints */}
            {result.date_hints && (
              <div className={styles.dateHints}>
                <span className={styles.metaKey}>Dates:</span>
                <span>{result.date_hints}</span>
              </div>
            )}

            {/* Key entities */}
            {result.key_entities.length > 0 && (
              <div className={styles.entities}>
                <span className={styles.metaKey}>Entities:</span>
                <div className={styles.entityList}>
                  {result.key_entities.map((e, i) => (
                    <span key={i} className={styles.entityPill}>{e}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Summary */}
            <div className={styles.summary}>{result.summary}</div>

            {/* Actions */}
            <div className={styles.actions}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { setResult(null); setSaved(false) }}
              >
                Re-analyse
              </button>
              <button className="btn btn-ghost btn-sm" onClick={handleCopy}>
                {copied
                  ? <><Check size={12} /> Copied</>
                  : <><Copy size={12} /> Copy</>}
              </button>
              {!saved ? (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => saveNoteMutation.mutate()}
                  disabled={saveNoteMutation.isPending}
                >
                  {saveNoteMutation.isPending
                    ? <Spinner size={12} />
                    : <Save size={12} />}
                  Save as note
                </button>
              ) : (
                <span className={styles.savedConfirm}>
                  <Check size={12} /> Saved
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}