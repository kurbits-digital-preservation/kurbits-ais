import { useState, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  X, Zap, Plus, Trash2, AlertCircle,
  CheckCircle, ClipboardPaste, ChevronDown
} from 'lucide-react'
import { nodesApi, hierarchyApi } from '@/api'
import { Spinner } from '@/components/ui'
import HierarchyLevelSelect from '@/components/ui/HierarchyLevelSelect'
import styles from './RapidEntryModal.module.css'

// ─── Types ────────────────────────────────────────────────────────────

interface EntryRow {
  id: string
  title: string
  local_ref: string
  date_start: string
  date_end: string
  description: string
  error?: string
}

function emptyRow(): EntryRow {
  return {
    id: Math.random().toString(36).slice(2),
    title: '', local_ref: '', date_start: '', date_end: '', description: '',
  }
}

// ─── Paste parser ─────────────────────────────────────────────────────
// Accepts tab-separated or comma-separated rows
// Columns: title, local_ref, date_start, date_end, description
// First row may be a header (detected by checking if first cell is text matching col names)

function parsePaste(text: string): EntryRow[] {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return []

  // Detect delimiter
  const delim = lines[0].includes('\t') ? '\t' : ','
  const rows = lines.map(l => l.split(delim).map(c => c.trim().replace(/^"|"$/g, '')))

  // Detect header row
  const HEADERS = ['title', 'local_ref', 'ref', 'date_start', 'date', 'date_end', 'description', 'desc']
  const firstRow = rows[0].map(c => c.toLowerCase())
  const hasHeader = firstRow.some(c => HEADERS.includes(c))

  const dataRows = hasHeader ? rows.slice(1) : rows

  return dataRows
    .filter(r => r.some(c => c))
    .map(r => ({
      id: Math.random().toString(36).slice(2),
      title:       r[0] ?? '',
      local_ref:   r[1] ?? '',
      date_start:  r[2] ?? '',
      date_end:    r[3] ?? '',
      description: r[4] ?? '',
    }))
}

// ─── Single row ───────────────────────────────────────────────────────

function EntryRowComponent({
  row, index, onChange, onDelete,
}: {
  row: EntryRow
  index: number
  onChange: (id: string, field: keyof EntryRow, value: string) => void
  onDelete: (id: string) => void
}) {
  const set = (field: keyof EntryRow) =>
    (e: React.ChangeEvent<HTMLInputElement>) => onChange(row.id, field, e.target.value)

  return (
    <tr className={`${styles.entryRow} ${row.error ? styles.entryRowError : ''}`}>
      <td className={styles.rowNum}>{index + 1}</td>
      <td>
        <input
          className={styles.cell}
          value={row.title}
          onChange={set('title')}
          placeholder="Title *"
        />
      </td>
      <td>
        <input
          className={`${styles.cell} ${styles.cellMono}`}
          value={row.local_ref}
          onChange={set('local_ref')}
          placeholder="Ref *"
        />
      </td>
      <td>
        <input
          className={styles.cell}
          type="date"
          value={row.date_start}
          onChange={set('date_start')}
        />
      </td>
      <td>
        <input
          className={styles.cell}
          type="date"
          value={row.date_end}
          onChange={set('date_end')}
        />
      </td>
      <td>
        <input
          className={styles.cell}
          value={row.description}
          onChange={set('description')}
          placeholder="Description"
        />
      </td>
      <td>
        {row.error ? (
          <span className={styles.rowErrorMsg} title={row.error}>
            <AlertCircle size={12} />
          </span>
        ) : (
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => onDelete(row.id)}
            tabIndex={-1}
          >
            <Trash2 size={12} />
          </button>
        )}
      </td>
    </tr>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────

interface RapidEntryModalProps {
  parentId?: number | null
  onClose: () => void
  onCreated: (count: number) => void
}

export default function RapidEntryModal({
  parentId,
  onClose,
  onCreated,
}: RapidEntryModalProps) {
  const queryClient = useQueryClient()
  const pasteRef = useRef<HTMLTextAreaElement>(null)

  const [hierarchyTypeId, setHierarchyTypeId] = useState('')
  const [levelName, setLevelName] = useState('')
  const [rows, setRows] = useState<EntryRow[]>([emptyRow(), emptyRow(), emptyRow()])
  const [result, setResult] = useState<any>(null)
  const [showPaste, setShowPaste] = useState(false)
  const [pasteText, setPasteText] = useState('')

  const { data: parentNode } = useQuery({
    queryKey: ['node-parent', parentId],
    queryFn: () => nodesApi.get(parentId!).then(r => r.data.data),
    enabled: !!parentId,
  })

  const batchMutation = useMutation({
    mutationFn: () => {
      const entries = rows.filter(r => r.title.trim() || r.local_ref.trim())
      return fetch('/api/v1/nodes/batch', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_id: parentId ?? null,
          hierarchy_type_id: parseInt(hierarchyTypeId),
          level_of_description: levelName,
          entries: entries.map(r => ({
            title: r.title.trim(),
            local_ref: r.local_ref.trim(),
            date_start: r.date_start || null,
            date_end: r.date_end || null,
            description: r.description || null,
          })),
        }),
      }).then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.message || 'Batch failed')
        return data
      })
    },
    onSuccess: (data) => {
      setResult(data.data)
      // Mark row errors
      if (data.data.errors?.length) {
        setRows(prev => prev.map((row, i) => {
          const err = data.data.errors.find((e: any) => e.row === i + 1)
          return err ? { ...row, error: err.error } : row
        }))
      }
      queryClient.invalidateQueries({ queryKey: ['node-tree'] })
      queryClient.invalidateQueries({ queryKey: ['node-children', parentId] })
    },
  })

  const updateRow = useCallback((id: string, field: keyof EntryRow, value: string) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }, [])

  const deleteRow = useCallback((id: string) => {
    setRows(prev => prev.filter(r => r.id !== id))
  }, [])

  const addRow = () => setRows(prev => [...prev, emptyRow()])

  const handlePasteApply = () => {
    const parsed = parsePaste(pasteText)
    if (parsed.length) {
      setRows(prev => {
        const empties = prev.filter(r => !r.title && !r.local_ref)
        const keepers = prev.filter(r => r.title || r.local_ref)
        return [...keepers, ...parsed, ...(empties.length < 2 ? [emptyRow()] : [])]
      })
    }
    setPasteText('')
    setShowPaste(false)
  }

  const validRows = rows.filter(r => r.title.trim() && r.local_ref.trim())
  const canSubmit = !!hierarchyTypeId && !!levelName && validRows.length > 0

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Zap size={18} className={styles.headerIcon} />
            <div>
              <h3 className={styles.title}>Rapid entry</h3>
              {parentNode && (
                <div className={styles.parentNote}>
                  Under <strong>{parentNode.ref_code}</strong> — {parentNode.title}
                </div>
              )}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><X size={14} /></button>
        </div>

        {result ? (
          /* Success view */
          <div className={styles.resultView}>
            <div className={styles.resultSuccess}>
              <CheckCircle size={24} className={styles.resultIcon} />
              <div>
                <div className={styles.resultTitle}>
                  {result.total_created} record{result.total_created !== 1 ? 's' : ''} created
                </div>
                {result.errors?.length > 0 && (
                  <div className={styles.resultWarning}>
                    {result.errors.length} row{result.errors.length !== 1 ? 's' : ''} had errors — check highlighted rows
                  </div>
                )}
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => onCreated(result.total_created)}>
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Config row */}
            <div className={styles.config}>
              <div className={styles.configFields}>
                <HierarchyLevelSelect
                  entityType="resource"
                  hierarchyTypeId={hierarchyTypeId}
                  levelName={levelName}
                  onHierarchyTypeChange={setHierarchyTypeId}
                  onLevelChange={setLevelName}
                />
              </div>
              <div className={styles.configActions}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowPaste(v => !v)}
                >
                  <ClipboardPaste size={13} /> Paste from spreadsheet
                </button>
              </div>
            </div>

            {/* Paste panel */}
            {showPaste && (
              <div className={styles.pastePanel}>
                <p className={styles.pasteHint}>
                  Paste tab- or comma-separated data. Columns: <code>title, local_ref, date_start, date_end, description</code>. First row can be a header.
                </p>
                <textarea
                  ref={pasteRef}
                  className={styles.pasteArea}
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  placeholder="Paste here…"
                  rows={6}
                  autoFocus
                />
                <div className={styles.pasteActions}>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setShowPaste(false); setPasteText('') }}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!pasteText.trim()}
                    onClick={handlePasteApply}
                  >
                    Apply ({parsePaste(pasteText).length} rows detected)
                  </button>
                </div>
              </div>
            )}

            {/* Grid */}
            <div className={styles.gridWrap}>
              <table className={styles.grid}>
                <thead>
                  <tr>
                    <th className={styles.thNum}>#</th>
                    <th className={styles.thTitle}>Title *</th>
                    <th className={styles.thRef}>Ref *</th>
                    <th className={styles.thDate}>Date from</th>
                    <th className={styles.thDate}>Date to</th>
                    <th className={styles.thDesc}>Description</th>
                    <th className={styles.thAction} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <EntryRowComponent
                      key={row.id}
                      row={row}
                      index={i}
                      onChange={updateRow}
                      onDelete={deleteRow}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className={styles.footer}>
              <button className="btn btn-ghost btn-sm" onClick={addRow}>
                <Plus size={13} /> Add row
              </button>
              <div className={styles.footerRight}>
                <span className={styles.rowCount}>
                  {validRows.length} valid row{validRows.length !== 1 ? 's' : ''}
                </span>
                <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button
                  className="btn btn-primary"
                  disabled={!canSubmit || batchMutation.isPending}
                  onClick={() => batchMutation.mutate()}
                >
                  {batchMutation.isPending
                    ? <><Spinner size={14} /> Creating…</>
                    : <><Zap size={14} /> Create {validRows.length} record{validRows.length !== 1 ? 's' : ''}</>
                  }
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
