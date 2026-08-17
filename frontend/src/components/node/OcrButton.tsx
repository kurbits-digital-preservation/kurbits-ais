import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ScanText, FileText, Mic, CheckCircle, AlertCircle,
  Loader, ChevronDown,
} from 'lucide-react'
import { nodesApi, aiApi } from '@/api'
import { useTaskPoller } from '@/hooks/useTaskPoller'
import styles from './OcrButton.module.css'

// ─── MIME type detection ──────────────────────────────────────────────

const OCR_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/tiff', 'image/bmp', 'image/webp',
  'application/pdf',
])

const WHISPER_MIMES = new Set([
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/flac',
  'audio/ogg', 'audio/aac', 'audio/webm',
  'video/mp4', 'video/quicktime', 'video/x-msvideo',
  'video/x-matroska', 'video/webm', 'video/ogg',
])

const AUDIO_EXTS = new Set(['mp3', 'mp4', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma', 'aiff'])
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'ogv', 'wmv', 'flv', 'm4v'])
const OCR_EXTS   = new Set(['jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'webp', 'pdf'])

function getExt(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? ''
}

function detectIsOcr(mimeType: string, filename: string): boolean {
  if (OCR_MIMES.has(mimeType)) return true
  if (mimeType && mimeType !== 'application/octet-stream') return false
  return OCR_EXTS.has(getExt(filename))
}

function detectIsWhisper(mimeType: string, filename: string): boolean {
  if (WHISPER_MIMES.has(mimeType)) return true
  if (mimeType && mimeType !== 'application/octet-stream') return false
  const e = getExt(filename)
  return AUDIO_EXTS.has(e) || VIDEO_EXTS.has(e)
}

// ─── Constants ────────────────────────────────────────────────────────

const FALLBACK_MODELS = [
  'tiny', 'base', 'small', 'medium', 'large',
  'KBLab/kb-whisper-tiny',
  'KBLab/kb-whisper-small',
  'KBLab/kb-whisper-medium',
  'KBLab/kb-whisper-large',
]

const METHOD_LABELS: Record<string, string> = {
  native_pdf: 'Text extracted',
  ocr_pdf:    'OCR (PDF)',
  ocr_image:  'OCR',
  whisper:    'Transcribed',
}

// ─── Portal dropdown ──────────────────────────────────────────────────

interface DropdownProps {
  triggerRef: React.RefObject<HTMLButtonElement | null>
  open: boolean
  onClose: () => void
  children: React.ReactNode
}

function PortalDropdown({ triggerRef, open, onClose, children }: DropdownProps) {
  const [pos, setPos] = useState({ top: 0, right: 0 })

  useEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({
      top:   rect.bottom + 4,
      right: window.innerWidth - rect.right,
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const scrollHandler = () => onClose()
    document.addEventListener('mousedown', handler)
    window.addEventListener('scroll', scrollHandler, true)
    window.addEventListener('resize', scrollHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('scroll', scrollHandler, true)
      window.removeEventListener('resize', scrollHandler)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      style={{
        position:  'fixed',
        top:       pos.top,
        right:     pos.right,
        zIndex:    9999,
        background:    'var(--color-surface)',
        border:        '1px solid var(--color-border)',
        borderRadius:  'var(--radius-lg)',
        boxShadow:     'var(--shadow-xl)',
        minWidth:      240,
        maxWidth:      320,
        overflow:      'hidden',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  )
}

// ─── Props ────────────────────────────────────────────────────────────

interface Props {
  nodeId: number
  attachmentId: number
  mimeType: string
  filename: string
  hasText: boolean
  extractionMethod?: string | null
}

// ─── Component ────────────────────────────────────────────────────────

export default function OcrButton({
  nodeId, attachmentId, mimeType, filename, hasText, extractionMethod,
}: Props) {
  const queryClient  = useQueryClient()
  const triggerRef   = useRef<HTMLButtonElement | null>(null)
  const [taskId, setTaskId]         = useState<string | null>(null)
  const [showMenu, setShowMenu]     = useState(false)
  const [selectedModel, setSelectedModel] = useState('')

  const isOcr     = detectIsOcr(mimeType, filename)
  const isWhisper = detectIsWhisper(mimeType, filename)
  const isPdf     = mimeType === 'application/pdf' || getExt(filename) === 'pdf'

  const { data: whisperModelsData } = useQuery({
    queryKey: ['whisper-models'],
    queryFn:  () => aiApi.getWhisperModels().then(r => r.data.data),
    staleTime: 300_000,
    enabled:   isWhisper,
    retry:     false,
  })

  const availableModels: string[] = whisperModelsData?.models ?? FALLBACK_MODELS
  const defaultModel: string      = whisperModelsData?.default ?? 'medium'
  const activeModel               = selectedModel || defaultModel

  const task = useTaskPoller(taskId, () => {
    queryClient.invalidateQueries({ queryKey: ['node', nodeId] })
    queryClient.invalidateQueries({ queryKey: ['representations', nodeId] })
    setShowMenu(false)
  })

  const ocrMutation = useMutation({
    mutationFn: (forceOcr: boolean = false) =>
      nodesApi.ocr(nodeId, attachmentId, forceOcr),
    onSuccess: (res) => { setTaskId(res.data.data.task_id); setShowMenu(false) },
  })

  const whisperMutation = useMutation({
    mutationFn: (model: string) =>
      nodesApi.transcribe(nodeId, attachmentId, model),
    onSuccess: (res) => { setTaskId(res.data.data.task_id); setShowMenu(false) },
  })

  if (!isOcr && !isWhisper) return null

  const isRunning = task?.status === 'pending' || task?.status === 'running'
  const isDone    = task?.status === 'done'
  const isError   = task?.status === 'error'
  const isPending = ocrMutation.isPending || whisperMutation.isPending
  const method    = task?.result?.method ?? extractionMethod

  // ── Menu content ──────────────────────────────────────────────────
  const rerunMenuContent = (
    <>
      {isOcr && isPdf && (
        <button className={styles.menuItem}
          onClick={() => { ocrMutation.mutate(false); setShowMenu(false) }}>
          <FileText size={12} /> Smart extract (native to OCR)
        </button>
      )}
      {isOcr && (
        <button className={styles.menuItem}
          onClick={() => { ocrMutation.mutate(true); setShowMenu(false) }}>
          <ScanText size={12} /> Force OCR
        </button>
      )}
      {isWhisper && (
        <>
          <div className={styles.menuSectionLabel}>Transcribe (Whisper)</div>
          {availableModels.map(m => (
            <button
              key={m}
              className={`${styles.menuItem} ${activeModel === m ? styles.menuItemActive : ''}`}
              onClick={() => { setSelectedModel(m); whisperMutation.mutate(m); setShowMenu(false) }}
            >
              <Mic size={12} />
              <span className={styles.modelName}>{m}</span>
              {m === defaultModel && <span className={styles.menuItemHint}>default</span>}
            </button>
          ))}
        </>
      )}
    </>
  )

  const whisperMenuContent = (
    <>
      <div className={styles.menuSectionLabel}>
        Whisper model
        {whisperModelsData && (
          <span style={{ fontWeight: 400, marginLeft: 4 }}>
            ({availableModels.length} available)
          </span>
        )}
      </div>
      {availableModels.map(m => (
        <button
          key={m}
          className={`${styles.menuItem} ${activeModel === m ? styles.menuItemActive : ''}`}
          onClick={() => { setSelectedModel(m); whisperMutation.mutate(m); setShowMenu(false) }}
        >
          <Mic size={12} />
          <span className={styles.modelName}>{m}</span>
          {m === defaultModel && <span className={styles.menuItemHint}>default</span>}
        </button>
      ))}
    </>
  )

  // ── Running ───────────────────────────────────────────────────────
  if (isRunning) {
    const label = task?.task_type === 'whisper' ? 'Transcribing...' : 'Extracting...'
    return (
      <span className={styles.running}>
        <Loader size={12} className={styles.spin} />
        {task?.progress ? `${task.progress}%` : label}
      </span>
    )
  }

  // ── Has text — badge + re-run ─────────────────────────────────────
  if (hasText) {
    return (
      <div className={styles.wrap}>
        <div className={styles.hasTextGroup}>
          <span className={styles.methodBadge}>
            <CheckCircle size={11} />
            {METHOD_LABELS[method ?? ''] ?? 'Text extracted'}
          </span>
          <div style={{ position: 'relative' }}>
            <button
              ref={triggerRef}
              className="btn btn-ghost btn-sm"
              onClick={() => setShowMenu(v => !v)}
            >
              Re-run <ChevronDown size={11} />
            </button>
            <PortalDropdown
              triggerRef={triggerRef}
              open={showMenu}
              onClose={() => setShowMenu(false)}
            >
              {rerunMenuContent}
            </PortalDropdown>
          </div>
        </div>
        {isDone && (
          <span title={`${task?.result?.chars_extracted ?? 0} chars via ${task?.result?.method}`}>
            <CheckCircle size={13} style={{ color: 'var(--color-success)' }} />
          </span>
        )}
        {isError && (
          <span title={task?.error_message ?? 'Failed'}>
            <AlertCircle size={13} style={{ color: 'var(--color-error)' }} />
          </span>
        )}
      </div>
    )
  }

  // ── No text — Whisper ─────────────────────────────────────────────
  if (isWhisper) {
    return (
      <div className={styles.wrap}>
        <div style={{ position: 'relative' }}>
          <button
            ref={triggerRef}
            className="btn btn-ghost btn-sm"
            onClick={() => setShowMenu(v => !v)}
            disabled={isPending}
            title="Transcribe with Whisper"
          >
            <Mic size={12} /> Transcribe <ChevronDown size={11} />
          </button>
          <PortalDropdown
            triggerRef={triggerRef}
            open={showMenu}
            onClose={() => setShowMenu(false)}
          >
            {whisperMenuContent}
          </PortalDropdown>
        </div>
        {isError && (
          <span title={task?.error_message ?? 'Transcription failed'}>
            <AlertCircle size={13} style={{ color: 'var(--color-error)' }} />
          </span>
        )}
      </div>
    )
  }

  // ── No text — OCR ─────────────────────────────────────────────────
  return (
    <div className={styles.wrap}>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => ocrMutation.mutate(false)}
        disabled={isPending}
        title={isPdf ? 'Extract text (native or OCR)' : 'Extract text with OCR'}
      >
        {isPdf
          ? <><FileText size={12} /> Extract text</>
          : <><ScanText size={12} /> OCR</>}
      </button>
      {isDone && (
        <span title={`${task?.result?.chars_extracted ?? 0} chars`}>
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