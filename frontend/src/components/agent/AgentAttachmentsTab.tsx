import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Paperclip, Download, Trash2, FileText } from 'lucide-react'
import { agentsApi } from '@/api'
import { Spinner } from '@/components/ui'
import styles from './AgentAttachmentsTab.module.css'

function fmtSize(bytes: number): string {
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export default function AgentAttachmentsTab({ agentId }: { agentId: number }) {
  const queryClient = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const { data: attachments, isLoading } = useQuery({
    queryKey: ['agent-attachments', agentId],
    queryFn: () => agentsApi.getAttachments(agentId).then(r => r.data.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: number) => agentsApi.deleteAttachment(agentId, attachmentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-attachments', agentId] }),
  })

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError('')
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      await agentsApi.uploadAttachment(agentId, formData)
      queryClient.invalidateQueries({ queryKey: ['agent-attachments', agentId] })
    } catch (err: any) {
      setUploadError(err?.response?.data?.message ?? 'Upload failed.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  if (isLoading) return <div className={styles.tab}><Spinner /></div>

  return (
    <div className={styles.tab}>
      <div className={styles.uploadRow}>
        <label className={`btn btn-secondary btn-sm ${uploading ? styles.uploadBtnLoading : ''}`}>
          <Paperclip size={13} /> {uploading ? 'Uploading…' : 'Upload file'}
          <input type="file" onChange={handleUpload} style={{ display: 'none' }} disabled={uploading} />
        </label>
        {uploadError && <span className={styles.uploadError}>{uploadError}</span>}
      </div>

      {(!attachments || attachments.length === 0) && (
        <p className={styles.empty}>No attachments yet.</p>
      )}

      <div className={styles.list}>
        {(attachments ?? []).map((att: any) => {
          const downloadUrl = agentsApi.getAttachmentDownloadUrl(agentId, att.id)
          return (
            <div key={att.id} className={styles.item}>
              <FileText size={14} className={styles.itemIcon} />
              <div className={styles.itemInfo}>
                <span className={styles.itemName}>{att.original_filename}</span>
                <div className={styles.itemMeta}>
                  <span>{fmtSize(att.file_size)}</span>
                  {att.mime_type && <span>{att.mime_type}</span>}
                  {att.description && <span>{att.description}</span>}
                </div>
              </div>
              <div className={styles.itemActions}>
                <a href={downloadUrl} target="_blank" rel="noreferrer"
                  className="btn btn-ghost btn-sm btn-icon" title="Download">
                  <Download size={12} />
                </a>
                <button className="btn btn-ghost btn-sm btn-icon"
                  onClick={() => { if (confirm('Delete this file?')) deleteMutation.mutate(att.id) }}
                  title="Delete">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
