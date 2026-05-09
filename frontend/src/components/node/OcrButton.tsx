import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ScanText, FileText, CheckCircle, AlertCircle, Loader, ChevronDown } from 'lucide-react'
import { nodesApi } from '@/api'
import { useTaskPoller } from '@/hooks/useTaskPoller'
import styles from './OcrButton.module.css'

interface Props {
  nodeId: number
  attachmentId: number
  mimeType: string
  hasText: boolean
  extractionMethod?: string | null
}

const OCR_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/tiff', 'image/bmp', 'image/webp',
  'application/pdf',
])

const METHOD_LABELS: Record<string, string> = {
  native_pdf: 'Text extracted',
  ocr_pdf: 'OCR (PDF)',
  ocr_image: 'OCR',
}

export default function OcrButton({ nodeId, attachmentId, mimeType, hasText, extractionMethod }: Props) {
  const queryClient = useQueryClient()
  const [taskId, setTaskId] = useState<string | null>(null)
  const [showMenu, setShowMenu] = useState(false)
  const isPdf = mimeType === 'application/pdf'

  const task = useTaskPoller(taskId, () => {
    queryClient.invalidateQueries({ queryKey: ['node', nodeId] })
    setShowMenu(false)
  })

  const extractMutation = useMutation({
    mutationFn: (forceOcr: boolean = false) =>
      nodesApi.ocr(nodeId, attachmentId, forceOcr),
    onSuccess: (res) => setTaskId(res.data.data.task_id),
  })

  if (!OCR_MIMES.has(mimeType)) return null

  const isRunning = task?.status === 'pending' || task?.status === 'running'
  const isDone = task?.status === 'done'
  const isError = task?.status === 'error'
  const method = task?.result?.method ?? extractionMethod

  if (isRunning) {
    return (
      <span className={styles.running}>
        <Loader size={12} className={styles.spin} />
        {task?.progress ? `${task.progress}%` : 'Extracting...'}
      </span>
    )
  }

  return (
    <div className={styles.wrap}>
      {!hasText ? (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => extractMutation.mutate(false)}
          disabled={extractMutation.isPending}
          title={isPdf ? 'Extract text (native or OCR)' : 'Extract text with OCR'}
        >
          {isPdf
            ? <><FileText size={12} /> Extract text</>
            : <><ScanText size={12} /> OCR</>}
        </button>
      ) : (
        <div className={styles.hasTextGroup}>
          <span className={styles.methodBadge} title={`Extracted via ${method}`}>
            <CheckCircle size={11} />
            {METHOD_LABELS[method ?? ''] ?? 'Text extracted'}
          </span>
          <div className={styles.rerunWrap}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowMenu(v => !v)}
              title="Re-extract options"
            >
              Re-extract <ChevronDown size={11} />
            </button>
            {showMenu && (
              <div className={styles.menu}>
                {isPdf && (
                  <button
                    className={styles.menuItem}
                    onClick={() => { extractMutation.mutate(false); setShowMenu(false) }}
                  >
                    <FileText size={12} /> Smart extract (native then OCR)
                  </button>
                )}
                <button
                  className={styles.menuItem}
                  onClick={() => { extractMutation.mutate(true); setShowMenu(false) }}
                >
                  <ScanText size={12} /> Force OCR
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {isDone && !hasText && (
        <span title={`${task?.result?.chars_extracted ?? 0} chars extracted via ${task?.result?.method}`}>
          <CheckCircle size={13} style={{ color: 'var(--color-success)' }} />
        </span>
      )}
      {isError && (
        <span title={task?.error_message ?? 'Extraction failed'}>
          <AlertCircle size={13} style={{ color: 'var(--color-error)' }} />
        </span>
      )}
    </div>
  )
}