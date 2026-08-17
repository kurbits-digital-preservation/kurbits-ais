import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Trash2,
  Upload,
  Download,
  Sparkles,
  Edit2,
  X,
  Save,
  AlertCircle,
  Layers,
  FileText,
} from 'lucide-react'
import { representationsApi, nodesApi } from '@/api'
import { Spinner } from '@/components/ui'
import type { NodeDetail, NodeRepresentation, RepresentationFile } from '@/types'
import styles from './RepresentationsTab.module.css'
import OcrButton from '@/components/node/OcrButton'
import FileSummarisePanel from '@/components/node/FileSummarisePanel'

// ─── Helpers ──────────────────────────────────────────────────────────

function fmtSize(bytes: number): string {
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

function TechRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'contents' }}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

// ─── File card ────────────────────────────────────────────────────────

function FileCard({
  nodeId,
  file,
  onDeleted,
}: {
  nodeId: number
  file: RepresentationFile
  onDeleted: () => void
}) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [showSummarise, setShowSummarise] = useState(false)

  const downloadUrl = representationsApi.getDownloadUrl(nodeId, file.id)
  const thumbUrl = representationsApi.getThumbnailUrl(nodeId, file.id)
  const textUrl = nodesApi.getTextUrl(nodeId, file.id)
  const hasText = !!(file as any).extracted_text

  const deleteMutation = useMutation({
    mutationFn: () => representationsApi.deleteFile(nodeId, file.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['representations', nodeId] })
      onDeleted()
    },
  })

  const reextractMutation = useMutation({
    mutationFn: () => nodesApi.reextractMetadata(nodeId, file.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['representations', nodeId] }),
  })

  const saveNoteMutation = useMutation({
    mutationFn: ({
      content,
      noteType,
    }: {
      content: string
      noteType: string
    }) =>
      nodesApi.addNote(nodeId, {
        content,
        note_type: noteType,
        is_public: false,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node', nodeId] })
      setShowSummarise(false)
    },
  })

  return (
    <div className={styles.fileCard}>
      {file.has_thumbnail && (
        <div className={styles.fileThumb}>
          <img
            src={thumbUrl}
            alt=""
            className={styles.fileThumbImg}
            onClick={() => window.open(downloadUrl, '_blank')}
          />
        </div>
      )}

      <div className={styles.fileRow}>
        <div className={styles.fileInfo}>
          <span className={styles.fileName}>{file.original_filename}</span>
          <div className={styles.fileMeta}>
            <span>{fmtSize(file.file_size)}</span>
            {file.mime_type && <span>{file.mime_type}</span>}
            {file.pronom_id && (
              <a
                href={'https://www.nationalarchives.gov.uk/pronom/' + file.pronom_id}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: 'var(--color-accent)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                }}
              >
                {file.pronom_id}
              </a>
            )}
            {file.image_width && file.image_height && (
              <span>
                {file.image_width} x {file.image_height}px
                {file.image_dpi_x ? ' · ' + Math.round(file.image_dpi_x) + ' DPI' : ''}
              </span>
            )}
            {file.checksum_sha256 && (
              <span
                title={'SHA-256: ' + file.checksum_sha256}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 10, cursor: 'help' }}
              >
                {file.checksum_sha256.slice(0, 8) + '...'}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-1)', flexShrink: 0, alignItems: 'center' }}>
          {/* OCR / extract text */}
          <OcrButton
            nodeId={nodeId}
            attachmentId={file.id}
            mimeType={file.mime_type}
            filename={file.original_filename}
            hasText={hasText}
          />

          {/* Summarise toggle */}
          {hasText && (
            <button
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => setShowSummarise((v) => !v)}
              title="Summarise extracted text into a note"
              style={{ color: showSummarise ? 'var(--color-accent)' : undefined }}
            >
              <Sparkles size={12} />
            </button>
          )}

          {/* Tech metadata toggle */}
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => setExpanded((v) => !v)}
            title="Technical metadata"
          >
            <AlertCircle size={12} />
          </button>

          {/* Download file */}
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-sm btn-icon"
            title="Download file"
          >
            <Download size={12} />
          </a>

          {/* Download raw text — only when extracted text exists */}
          {hasText && (
            <a
              href={textUrl}
              download={file.original_filename.replace(/\.[^.]+$/, '') + '_text.txt'}
              className="btn btn-ghost btn-sm btn-icon"
              title="Download extracted text as .txt"
            >
              <FileText size={12} />
            </a>
          )}

          {/* Delete */}
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => {
              if (confirm('Delete this file?')) deleteMutation.mutate()
            }}
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Summarise panel */}
      {showSummarise && (
        <FileSummarisePanel
          nodeId={nodeId}
          filename={file.original_filename}
          onSaveNote={(content, noteType) =>
            saveNoteMutation.mutate({ content, noteType })
          }
          isSavingNote={saveNoteMutation.isPending}
        />
      )}

      {/* Tech metadata panel */}
      {expanded && (
        <div className={styles.fileTechPanel}>
          <div className={styles.fileTechGrid}>
            {file.checksum_md5 && (
              <TechRow label="MD5">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                  {file.checksum_md5}
                </span>
              </TechRow>
            )}
            {file.checksum_sha256 && (
              <TechRow label="SHA-256">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', wordBreak: 'break-all' }}>
                  {file.checksum_sha256}
                </span>
              </TechRow>
            )}
            {file.pronom_id && (
              <TechRow label="PRONOM">
                <a
                  href={'https://www.nationalarchives.gov.uk/pronom/' + file.pronom_id}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: 'var(--color-accent)' }}
                >
                  {file.pronom_id}
                </a>
              </TechRow>
            )}
            {file.image_width && (
              <TechRow label="Dimensions">
                {file.image_width} x {file.image_height} px
              </TechRow>
            )}
            {file.image_dpi_x && (
              <TechRow label="Resolution">
                {Math.round(file.image_dpi_x)} x{' '}
                {Math.round(file.image_dpi_y ?? file.image_dpi_x)} DPI
              </TechRow>
            )}
            {file.image_mode && (
              <TechRow label="Colour mode">{file.image_mode}</TechRow>
            )}
            {file.image_bit_depth && (
              <TechRow label="Bit depth">{file.image_bit_depth}-bit</TechRow>
            )}
            {file.duration_seconds && (
              <TechRow label="Duration">
                {new Date(file.duration_seconds * 1000).toISOString().slice(11, 19)}
              </TechRow>
            )}
            {file.av_codec && <TechRow label="Codec">{file.av_codec}</TechRow>}
            {file.av_bitrate && (
              <TechRow label="Bitrate">
                {Math.round(file.av_bitrate / 1000)} kbps
              </TechRow>
            )}
            {(file as any).extracted_text_at && (
              <TechRow label="Text extracted">
                {new Date((file as any).extracted_text_at).toLocaleString()}
              </TechRow>
            )}
            {file.tech_extracted_at && (
              <TechRow label="Tech extracted">
                {new Date(file.tech_extracted_at).toLocaleString()}
              </TechRow>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
            <button
              className="btn btn-ghost btn-sm"
              disabled={reextractMutation.isPending}
              onClick={() => reextractMutation.mutate()}
            >
              {reextractMutation.isPending ? <Spinner size={12} /> : <AlertCircle size={12} />}
              Re-extract metadata
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Representation card ──────────────────────────────────────────────

function RepresentationCard({
  nodeId,
  rep,
  repTypes,
  onChanged,
}: {
  nodeId: number
  rep: NodeRepresentation
  repTypes: { id: number; name: string }[]
  onChanged: () => void
}) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editLabel, setEditLabel] = useState(rep.label ?? '')
  const [editNote, setEditNote] = useState(rep.note ?? '')
  const [editTypeId, setEditTypeId] = useState(rep.rep_type_id)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const deleteMutation = useMutation({
    mutationFn: () => representationsApi.delete(nodeId, rep.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['representations', nodeId] })
      onChanged()
    },
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      representationsApi.update(nodeId, rep.id, {
        rep_type_id: editTypeId,
        label: editLabel || undefined,
        note: editNote || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['representations', nodeId] })
      setEditing(false)
    },
  })

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      await representationsApi.uploadFile(nodeId, rep.id, fd)
      queryClient.invalidateQueries({ queryKey: ['representations', nodeId] })
    } catch (err: any) {
      setUploadError(err?.response?.data?.message ?? 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className={styles.repCard}>
      <div className={styles.repHeader} onClick={() => setExpanded((v) => !v)}>
        {editing ? (
          <div className={styles.repEditForm} onClick={(e) => e.stopPropagation()}>
            <select
              value={editTypeId}
              onChange={(e) => setEditTypeId(Number(e.target.value))}
              style={{ fontSize: 'var(--text-sm)' }}
            >
              {repTypes.map((rt) => (
                <option key={rt.id} value={rt.id}>{rt.name}</option>
              ))}
            </select>
            <input
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              placeholder="Label (optional)"
              style={{ fontSize: 'var(--text-sm)', flex: 1 }}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? <Spinner size={12} /> : <Save size={12} />}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className={styles.repTitle}>
            <span className={styles.repTypeName}>{rep.rep_type_name}</span>
            {rep.label && <span className={styles.repLabel}>{rep.label}</span>}
            <span className={styles.repFileCount}>
              {rep.files.length} file{rep.files.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {!editing && (
          <div className={styles.repActions} onClick={(e) => e.stopPropagation()}>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => setEditing(true)}
              title="Edit"
            >
              <Edit2 size={12} />
            </button>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => {
                if (confirm('Delete this representation and all its files?'))
                  deleteMutation.mutate()
              }}
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div className={styles.repBody}>
          {rep.note && <p className={styles.repNote}>{rep.note}</p>}

          {rep.files.map((file) => (
            <FileCard key={file.id} nodeId={nodeId} file={file} onDeleted={onChanged} />
          ))}

          {rep.files.length === 0 && (
            <p className={styles.repEmpty}>No files yet - upload one below.</p>
          )}

          <div className={styles.uploadRow}>
            <label className="btn btn-secondary btn-sm">
              <Upload size={12} /> {uploading ? 'Uploading...' : 'Upload file'}
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleUpload}
                style={{ display: 'none' }}
                disabled={uploading}
              />
            </label>
            {uploading && <Spinner size={13} />}
            {uploadError && <span className={styles.uploadError}>{uploadError}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── New representation form ──────────────────────────────────────────

function NewRepresentationForm({
  nodeId,
  repTypes,
  onCreated,
  onCancel,
}: {
  nodeId: number
  repTypes: { id: number; name: string }[]
  onCreated: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const [repTypeId, setRepTypeId] = useState<number>(repTypes[0]?.id ?? 0)
  const [label, setLabel] = useState('')
  const [note, setNote] = useState('')

  const createMutation = useMutation({
    mutationFn: () =>
      representationsApi.create(nodeId, {
        rep_type_id: repTypeId,
        label: label.trim() || undefined,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['representations', nodeId] })
      onCreated()
    },
  })

  if (repTypes.length === 0) {
    return (
      <div className={styles.noTypesWarning}>
        <AlertCircle size={14} />
        No representation types configured. Add some under Administration, Vocabularies, Objects.
      </div>
    )
  }

  return (
    <div className={styles.newRepForm}>
      <div className="form-group">
        <label>Type *</label>
        <select value={repTypeId} onChange={(e) => setRepTypeId(Number(e.target.value))}>
          {repTypes.map((rt) => (
            <option key={rt.id} value={rt.id}>{rt.name}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>
          Label{' '}
          <span style={{ fontWeight: 400, color: 'var(--color-ink-faint)' }}>(optional)</span>
        </label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Recto, Side A, 2024 scan"
        />
      </div>
      <div className="form-group">
        <label>
          Note{' '}
          <span style={{ fontWeight: 400, color: 'var(--color-ink-faint)' }}>(optional)</span>
        </label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </div>
      <div className={styles.newRepActions}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button
          className="btn btn-primary btn-sm"
          disabled={!repTypeId || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending ? <Spinner size={13} /> : <Plus size={13} />}
          Create representation
        </button>
      </div>
    </div>
  )
}

// ─── Tab root ─────────────────────────────────────────────────────────

export default function RepresentationsTab({ node }: { node: NodeDetail }) {
  const [adding, setAdding] = useState(false)
  const queryClient = useQueryClient()

  const { data: representations, isLoading: repsLoading } = useQuery({
    queryKey: ['representations', node.id],
    queryFn: () =>
      representationsApi.list(node.id).then((r) => r.data.data as NodeRepresentation[]),
  })

  const { data: repTypes, isLoading: typesLoading } = useQuery({
    queryKey: ['representation-types'],
    queryFn: () =>
      representationsApi.listTypes().then((r) => r.data.data as { id: number; name: string }[]),
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['representations', node.id] })

  if (repsLoading || typesLoading) {
    return <div style={{ padding: 'var(--space-4)' }}><Spinner /></div>
  }

  return (
    <div className={styles.tab}>
      <div className={styles.tabHeader}>
        <button className="btn btn-secondary btn-sm" onClick={() => setAdding((v) => !v)}>
          <Plus size={13} /> Add representation
        </button>
      </div>

      {adding && (
        <NewRepresentationForm
          nodeId={node.id}
          repTypes={repTypes ?? []}
          onCreated={() => { setAdding(false); invalidate() }}
          onCancel={() => setAdding(false)}
        />
      )}

      {!representations?.length && !adding && (
        <div className={styles.emptyState}>
          <Layers size={28} className={styles.emptyIcon} />
          <p>No representations yet.</p>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)' }}>
            A representation groups files (preservation master, access copy etc.) for this object.
          </p>
        </div>
      )}

      {representations?.map((rep) => (
        <RepresentationCard
          key={rep.id}
          nodeId={node.id}
          rep={rep}
          repTypes={repTypes ?? []}
          onChanged={invalidate}
        />
      ))}
    </div>
  )
}