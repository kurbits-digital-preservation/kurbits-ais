import { FileText, Image, Film, Music, FileArchive, File as FileIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import styles from './FileResults.module.css'

interface FileMatch {
  id: number
  filename: string
  mime_type: string
  pronom_id?: string
  file_size: number
  image_width?: number
  image_height?: number
  has_checksum: boolean
}
interface FileGroup {
  node_id: number
  title: string
  ref_code: string
  level?: string
  match_count: number
  files: FileMatch[]
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return <Image size={13} />
  if (mime.startsWith('video/')) return <Film size={13} />
  if (mime.startsWith('audio/')) return <Music size={13} />
  if (mime.includes('zip') || mime.includes('tar')) return <FileArchive size={13} />
  if (mime === 'application/pdf' || mime.startsWith('text/')) return <FileText size={13} />
  return <FileIcon size={13} />
}

export default function FileResults({ groups }: { groups: FileGroup[] }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  if (!groups || groups.length === 0) return null

  return (
    <div className={styles.fileResults}>
      {groups.map(group => (
        <div key={group.node_id} className={styles.group}>
          <button
            className={styles.groupHeader}
            onClick={() => navigate('/app/resources', { state: { selectNodeId: group.node_id } })}
            title={t('search.fileResults.openResource')}
          >
            <div className={styles.groupHeaderInfo}>
              <span className={styles.groupTitle}>{group.title}</span>
              <div className={styles.groupMeta}>
                <span className="ref-code">{group.ref_code}</span>
                {group.level && <span className={styles.groupLevel}>{group.level}</span>}
              </div>
            </div>
            <span className={styles.groupCount}>
              {t('search.fileResults.filesCount', { count: group.match_count })}
            </span>
          </button>

          <div className={styles.fileList}>
            {group.files.map(f => (
              <button
                key={f.id}
                className={styles.fileRow}
                onClick={() => navigate('/app/resources', { state: { selectNodeId: group.node_id } })}
                title={t('search.fileResults.openInFilesTab')}
              >
                <span className={styles.fileIcon}>{fileIcon(f.mime_type)}</span>
                <span className={styles.fileName}>{f.filename}</span>
                <span className={styles.fileMeta}>
                  {f.mime_type}
                  {f.pronom_id && <span className={styles.filePronom}>{f.pronom_id}</span>}
                  {f.image_width && f.image_height && (
                    <span>{f.image_width}×{f.image_height}</span>
                  )}
                  <span>{fmtSize(f.file_size)}</span>
                  {f.has_checksum && <span className={styles.fileChecksum} title={t('search.fileResults.hasChecksum')}>✓</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
