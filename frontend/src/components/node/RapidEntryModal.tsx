import { useState, useCallback, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  X, Zap, Plus, Trash2, AlertCircle,
  CheckCircle, ClipboardPaste, ArrowRight, Paperclip, FileCheck2
} from 'lucide-react'
import { nodesApi, representationsApi, hierarchyApi } from '@/api'
import api from '@/api/client'
import { Spinner } from '@/components/ui'
import HierarchyLevelSelect from '@/components/ui/HierarchyLevelSelect'
import type { MetadataField } from '@/components/node/MetadataFieldRenderer'
import styles from './RapidEntryModal.module.css'

// ─── Types ────────────────────────────────────────────────────────────

interface EntryRow {
  id: string
  title: string
  local_ref: string
  date_start: string
  date_end: string
  description: string
  // Custom metadata values, keyed by MetadataField.name
  metadata: Record<string, any>
  // Filenames named by the sheet's `files` column, and the representation
  // type this row's files belong to. One row = one object = one representation.
  files: string[]
  repType: string
  error?: string
  // Per-cell validation problems found while coercing pasted values
  fieldErrors?: Record<string, string>
}

function emptyRow(): EntryRow {
  return {
    id: Math.random().toString(36).slice(2),
    title: '', local_ref: '', date_start: '', date_end: '', description: '',
    metadata: {}, files: [], repType: '',
  }
}

// ─── Column mapping ───────────────────────────────────────────────────
// A pasted column resolves to one of:
//   a core field key ('title', 'local_ref', …)
//   'meta:<field name>' for a custom metadata field
//   IGNORE — explicitly discarded by the user
//   '' — unresolved; blocks import until the user decides

const IGNORE = '__ignore__'
// Two columns aren't record fields — they drive file attachment instead.
const FILES_COL = '__files__'
const REPTYPE_COL = '__rep_type__'

const CORE_FIELDS = [
  { key: 'title',       label: 'Title' },
  { key: 'local_ref',   label: 'Reference' },
  { key: 'date_start',  label: 'Date from' },
  { key: 'date_end',    label: 'Date to' },
  { key: 'description', label: 'Description' },
]

// Header spellings that map onto core fields, incl. common Swedish ones.
const CORE_ALIASES: Record<string, string> = {
  title: 'title', titel: 'title', rubrik: 'title', name: 'title', namn: 'title',
  local_ref: 'local_ref', localref: 'local_ref', ref: 'local_ref',
  reference: 'local_ref', referens: 'local_ref', beteckning: 'local_ref',
  date_start: 'date_start', datestart: 'date_start', date: 'date_start',
  from: 'date_start', datum: 'date_start', fran: 'date_start',
  date_end: 'date_end', dateend: 'date_end', to: 'date_end', till: 'date_end',
  description: 'description', desc: 'description', beskrivning: 'description',
  note: 'description', anmarkning: 'description',
}

/** Lowercase, strip accents, collapse anything non-alphanumeric to nothing. */
function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics so "anmärkning" → "anmarkning"
    .replace(/[^a-z0-9]/g, '')
}

const FILE_ALIASES = new Set(['files', 'file', 'filer', 'fil', 'filename', 'filnamn', 'bilagor'])
const REPTYPE_ALIASES = new Set(['reptype', 'representationtype', 'representation', 'representationstyp', 'typ'])

/** Best-guess mapping for one header against core fields then metadata fields. */
function autoResolveHeader(header: string, fields: MetadataField[]): string {
  const n = normalizeHeader(header)
  if (!n) return ''

  if (FILE_ALIASES.has(n)) return FILES_COL
  if (REPTYPE_ALIASES.has(n)) return REPTYPE_COL

  const core = CORE_ALIASES[n]
  if (core) return core

  const byName = fields.find(f => normalizeHeader(f.name) === n)
  if (byName) return `meta:${byName.name}`

  const byLabel = fields.find(f => normalizeHeader(f.label) === n)
  if (byLabel) return `meta:${byLabel.name}`

  return ''
}

// ─── Value coercion ───────────────────────────────────────────────────
// Turns a raw spreadsheet cell into the shape the field expects, or reports
// why it can't. Returning an error rather than silently coercing matters —
// a typo'd select value should fail loudly, not write garbage into the record.

const TRUTHY = new Set(['true', 'yes', 'y', 'ja', 'j', '1', 'x'])
const FALSY  = new Set(['false', 'no', 'n', 'nej', '0', ''])

function coerceValue(raw: string, field: MetadataField): { value?: any; error?: string } {
  const v = (raw ?? '').trim()
  if (!v) return { value: undefined }

  switch (field.type) {
    case 'boolean': {
      const l = v.toLowerCase()
      if (TRUTHY.has(l)) return { value: true }
      if (FALSY.has(l)) return { value: false }
      return { error: `"${v}" is not yes/no` }
    }
    case 'number': {
      const n = Number(v.replace(',', '.'))
      if (Number.isNaN(n)) return { error: `"${v}" is not a number` }
      return { value: n }
    }
    case 'select': {
      const opts = field.options ?? []
      if (!opts.length) return { value: v }
      const hit = opts.find(o => o.toLowerCase() === v.toLowerCase())
      if (!hit) return { error: `"${v}" is not an allowed value` }
      return { value: hit }
    }
    case 'multiselect': {
      const opts = field.options ?? []
      const parts = v.split(';').map(p => p.trim()).filter(Boolean)
      const out: string[] = []
      for (const p of parts) {
        if (!opts.length) { out.push(p); continue }
        const hit = opts.find(o => o.toLowerCase() === p.toLowerCase())
        if (!hit) return { error: `"${p}" is not an allowed value` }
        out.push(hit)
      }
      return { value: out }
    }
    default:
      // text, textarea, date, url, email and vocab-style fields all store
      // the raw string; vocab values are normalised server-side.
      return { value: v }
  }
}

// ─── Paste parser ─────────────────────────────────────────────────────

interface ParsedPaste {
  headers: string[]
  rows: string[][]
  hasHeader: boolean
}

/** Split one delimited line, honouring "quoted fields, with delimiters inside".
 *  A naive split() corrupts any CSV row containing a comma inside quotes —
 *  every later column shifts by one, silently. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }   // escaped ""
      else inQuotes = !inQuotes
    } else if (ch === delim && !inQuotes) {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map(c => c.trim())
}

function parsePaste(text: string): ParsedPaste {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return { headers: [], rows: [], hasHeader: false }

  const delim = lines[0].includes('\t') ? '\t' : ','
  const grid = lines.map(l => splitLine(l, delim))

  // Treat row 1 as a header if any cell looks like a known field name and the
  // row has no obviously data-ish cells. Cheap heuristic; the user confirms
  // the mapping anyway, so a wrong guess is visible and correctable.
  const first = grid[0].map(c => normalizeHeader(c))
  const looksLikeHeader = first.some(c => c && (c in CORE_ALIASES))

  if (looksLikeHeader) {
    return { headers: grid[0], rows: grid.slice(1).filter(r => r.some(c => c)), hasHeader: true }
  }
  // No header: synthesise positional names so the mapping UI still works.
  return {
    headers: grid[0].map((_, i) => `Column ${i + 1}`),
    rows: grid.filter(r => r.some(c => c)),
    hasHeader: false,
  }
}

// ─── Single row ───────────────────────────────────────────────────────

function EntryRowComponent({
  row, index, metaColumns, showFiles, findFile, repTypes,
  onChange, onMetaChange, onFilesChange, onDelete,
}: {
  row: EntryRow
  index: number
  metaColumns: MetadataField[]
  showFiles?: boolean
  findFile?: (name: string) => File | undefined
  repTypes?: { id: number; name: string }[]
  onChange: (id: string, field: keyof EntryRow, value: string) => void
  onMetaChange: (id: string, name: string, value: any) => void
  onFilesChange: (id: string, raw: string) => void
  onDelete: (id: string) => void
}) {
  const set = (field: keyof EntryRow) =>
    (e: React.ChangeEvent<HTMLInputElement>) => onChange(row.id, field, e.target.value)

  const hasFieldErrors = row.fieldErrors && Object.keys(row.fieldErrors).length > 0
  const missingFiles = row.files.filter(n => !findFile?.(n))
  const needsRepType = row.files.length > 0 && !row.repType.trim()

  return (
    <tr className={`${styles.entryRow} ${(row.error || hasFieldErrors) ? styles.entryRowError : ''}`}>
      <td className={styles.rowNum}>{index + 1}</td>
      <td>
        <input className={styles.cell} value={row.title} onChange={set('title')} placeholder="Title *" />
      </td>
      <td>
        <input className={`${styles.cell} ${styles.cellMono}`} value={row.local_ref}
          onChange={set('local_ref')} placeholder="Ref *" />
      </td>
      <td>
        <input className={styles.cell} type="date" value={row.date_start} onChange={set('date_start')} />
      </td>
      <td>
        <input className={styles.cell} type="date" value={row.date_end} onChange={set('date_end')} />
      </td>
      <td>
        <input className={styles.cell} value={row.description}
          onChange={set('description')} placeholder="Description" />
      </td>

      {metaColumns.map(f => {
        const err = row.fieldErrors?.[f.name]
        const val = row.metadata[f.name]
        return (
          <td key={f.name}>
            {f.type === 'boolean' ? (
              <input
                type="checkbox"
                checked={val === true}
                onChange={e => onMetaChange(row.id, f.name, e.target.checked)}
                className={styles.cellCheckbox}
              />
            ) : f.type === 'select' ? (
              <select
                className={`${styles.cell} ${err ? styles.cellError : ''}`}
                value={typeof val === 'string' ? val : ''}
                onChange={e => onMetaChange(row.id, f.name, e.target.value)}
                title={err}
              >
                <option value="">—</option>
                {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                className={`${styles.cell} ${err ? styles.cellError : ''}`}
                value={Array.isArray(val) ? val.join('; ') : (val ?? '')}
                onChange={e => onMetaChange(row.id, f.name, e.target.value)}
                placeholder={err ? err : f.label}
                title={err}
              />
            )}
          </td>
        )
      })}

      {showFiles && (
        <>
          <td className={styles.filesCell}>
            <input
              className={`${styles.cell} ${styles.cellMono} ${missingFiles.length ? styles.cellError : ''}`}
              value={row.files.join('; ')}
              onChange={e => onFilesChange(row.id, e.target.value)}
              placeholder="file1.jpg; file2.jpg"
              title={missingFiles.length
                ? `Not among the selected files: ${missingFiles.join(', ')}`
                : undefined}
            />
            {row.files.length > 0 && (
              <span className={styles.fileMatchNote}>
                {missingFiles.length === 0
                  ? `${row.files.length} matched`
                  : `${row.files.length - missingFiles.length}/${row.files.length} matched`}
              </span>
            )}
          </td>
          <td>
            <select
              className={`${styles.cell} ${needsRepType ? styles.cellError : ''}`}
              value={row.repType}
              onChange={e => onChange(row.id, 'repType', e.target.value)}
              title={needsRepType ? 'Required — this row has files' : undefined}
            >
              <option value="">—</option>
              {(repTypes ?? []).map(t => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
          </td>
        </>
      )}

      <td>
        {(row.error || hasFieldErrors) ? (
          <span className={styles.rowErrorMsg}
            title={row.error ?? Object.entries(row.fieldErrors ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n')}>
            <AlertCircle size={12} />
          </span>
        ) : (
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => onDelete(row.id)} tabIndex={-1}>
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

  // Paste flow: 'input' collects the text, 'mapping' confirms columns.
  const [pasteStage, setPasteStage] = useState<'closed' | 'input' | 'mapping'>('closed')
  const [pasteText, setPasteText] = useState('')
  const [parsed, setParsed] = useState<ParsedPaste | null>(null)
  const [columnMap, setColumnMap] = useState<string[]>([])

  // Metadata fields defined for the chosen level — the same source the full
  // node form uses, so rapid entry can never offer a field the form wouldn't.
  const { data: levelSchema } = useQuery({
    queryKey: ['level-schema', hierarchyTypeId, levelName],
    queryFn: () =>
      api.get('/hierarchy/level-schema', {
        params: { hierarchy_type_id: hierarchyTypeId, level_name: levelName },
      }).then(r => r.data.data as MetadataField[]),
    enabled: !!hierarchyTypeId && !!levelName,
  })

  const fields = levelSchema ?? []

  const { data: parentNode } = useQuery({
    queryKey: ['node-parent', parentId],
    queryFn: () => nodesApi.get(parentId!).then(r => r.data.data),
    enabled: !!parentId,
  })

  // ── Files ──────────────────────────────────────────────────────────
  // Selected on the client and matched to rows by name; uploaded only after
  // the nodes exist, so a failed upload never blocks record creation.
  const [pickedFiles, setPickedFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadState, setUploadState] = useState<
    { done: number; total: number; failures: string[] } | null
  >(null)
  const [autoMatchReport, setAutoMatchReport] = useState<
    { matched: number; unmatched: string[] } | null
  >(null)

  // Representations can only hang off a node whose LEVEL is flagged as an
  // object level. Checking this up front turns a post-creation upload failure
  // into an explanation before anything is written.
  const { data: hierarchyLevels } = useQuery({
    queryKey: ['hierarchy-levels', hierarchyTypeId],
    queryFn: () => hierarchyApi.listLevels(parseInt(hierarchyTypeId))
      .then(r => r.data.data as any[]),
    enabled: !!hierarchyTypeId,
  })
  const selectedLevel = (hierarchyLevels ?? []).find((l: any) => l.name === levelName)
  const levelSupportsObjects = selectedLevel ? !!selectedLevel.is_object_level : true

  const { data: repTypes } = useQuery({
    queryKey: ['representation-types'],
    queryFn: () => representationsApi.listTypes()
      .then(r => r.data.data as { id: number; name: string }[]),
  })

  // Metadata columns shown in the grid: those actually mapped from a paste.
  const [metaColumnNames, setMetaColumnNames] = useState<string[]>([])
  const metaColumns = useMemo(
    () => metaColumnNames
      .map(n => fields.find(f => f.name === n))
      .filter(Boolean) as MetadataField[],
    [metaColumnNames, fields]
  )

  // Match filenames (exact first, then case-insensitive) to the picked files.
  const fileIndex = useMemo(() => {
    const exact = new Map<string, File>()
    const lower = new Map<string, File>()
    for (const f of pickedFiles) {
      exact.set(f.name, f)
      lower.set(f.name.toLowerCase(), f)
    }
    return { exact, lower }
  }, [pickedFiles])

  const findFile = useCallback((name: string): File | undefined =>
    fileIndex.exact.get(name) ?? fileIndex.lower.get(name.toLowerCase()),
    [fileIndex]
  )

  const reconciliation = useMemo(() => {
    const referenced = new Set<string>()
    let matched = 0
    const missing: string[] = []

    for (const row of rows) {
      for (const name of row.files) {
        const hit = findFile(name)
        if (hit) { matched++; referenced.add(hit.name) }
        else missing.push(name)
      }
    }
    const unreferenced = pickedFiles.filter(f => !referenced.has(f.name)).map(f => f.name)
    const rowsWithFiles = rows.filter(r => r.files.length > 0).length
    const rowsMissingRepType = rows.filter(
      r => r.files.length > 0 && !r.repType.trim()
    ).length
    // A rep type named in the sheet that doesn't exist in the vocabulary
    const knownTypes = new Set((repTypes ?? []).map(t => t.name.toLowerCase()))
    const badRepTypes = Array.from(new Set(
      rows.filter(r => r.files.length > 0 && r.repType.trim() &&
                       !knownTypes.has(r.repType.trim().toLowerCase()))
          .map(r => r.repType.trim())
    ))

    return { matched, missing, unreferenced, rowsWithFiles, rowsMissingRepType, badRepTypes }
  }, [rows, pickedFiles, findFile, repTypes])

  // Show the file columns as soon as files are selected — manual rows need a
  // way in, not just sheets that happened to carry a `files` column.
  const filesInPlay = pickedFiles.length > 0 || reconciliation.rowsWithFiles > 0
  const hasFileWork = reconciliation.rowsWithFiles > 0
  const levelBlocksFiles = reconciliation.rowsWithFiles > 0 && !levelSupportsObjects
  const fileBlockers =
    reconciliation.missing.length > 0 ||
    reconciliation.rowsMissingRepType > 0 ||
    reconciliation.badRepTypes.length > 0 ||
    levelBlocksFiles

  /** Match each selected file to a row by filename stem.
   *  Exact match on local_ref first, then a prefix match (so `001_front.png`
   *  finds ref `001`), then the same two passes against title. Results are
   *  written into the editable Files cells so they stay reviewable. */
  const autoMatchFiles = () => {
    const norm = (s: string) => s.trim().toLowerCase()
    const stemOf = (name: string) => name.replace(/\.[^.]+$/, '')
    const SEPARATORS = ['_', '-', '.', ' ']

    const candidates = rows.map((r, i) => ({
      i,
      ref: norm(r.local_ref),
      title: norm(r.title),
    })).filter(c => c.ref || c.title)

    const assigned: Record<number, string[]> = {}
    const unmatched: string[] = []

    for (const file of pickedFiles) {
      const stem = norm(stemOf(file.name))
      if (!stem) { unmatched.push(file.name); continue }

      const matchOn = (key: 'ref' | 'title') => {
        const exact = candidates.find(c => c[key] && c[key] === stem)
        if (exact) return exact
        return candidates.find(c =>
          c[key] && stem.startsWith(c[key]) &&
          SEPARATORS.includes(stem.charAt(c[key].length))
        )
      }

      const hit = matchOn('ref') ?? matchOn('title')
      if (hit) {
        (assigned[hit.i] ??= []).push(file.name)
      } else {
        unmatched.push(file.name)
      }
    }

    setRows(prev => prev.map((r, i) =>
      assigned[i] ? { ...r, files: Array.from(new Set([...r.files, ...assigned[i]])) } : r
    ))
    setAutoMatchReport({ matched: pickedFiles.length - unmatched.length, unmatched })
  }

  /** After nodes exist: one representation per row, then its files. */
  const attachFiles = async (created: { row: number; id: number }[]) => {
    const typeByName = new Map(
      (repTypes ?? []).map(t => [t.name.toLowerCase(), t.id])
    )
    const jobs: { nodeId: number; repTypeId: number; files: File[] }[] = []

    for (const c of created) {
      const row = rows[c.row - 1]
      if (!row || row.files.length === 0) continue
      const repTypeId = typeByName.get(row.repType.trim().toLowerCase())
      if (!repTypeId) continue
      const files = row.files.map(findFile).filter(Boolean) as File[]
      if (files.length) jobs.push({ nodeId: c.id, repTypeId, files })
    }

    const total = jobs.reduce((n, j) => n + j.files.length, 0)
    if (!total) return
    setUploadState({ done: 0, total, failures: [] })

    let done = 0
    const failures: string[] = []

    for (const job of jobs) {
      let repId: number
      try {
        const res = await representationsApi.create(job.nodeId, { rep_type_id: job.repTypeId })
        repId = res.data.data.id
      } catch (err: any) {
        // Surface the server's reason — "could not create" on its own leaves
        // no way to tell a permissions problem from a config one.
        const reason = err?.response?.data?.message ?? err?.message ?? 'unknown error'
        failures.push(`${job.files.map(f => f.name).join(', ')} — ${reason}`)
        done += job.files.length
        setUploadState({ done, total, failures: [...failures] })
        continue
      }
      // Sequential on purpose: keeps server load predictable and makes the
      // progress count honest. One failure doesn't abort the rest.
      for (const file of job.files) {
        try {
          const fd = new FormData()
          fd.append('file', file)
          await representationsApi.uploadFile(job.nodeId, repId, fd)
        } catch (err: any) {
          const reason = err?.response?.data?.message ?? err?.message ?? 'upload failed'
          failures.push(`${file.name} — ${reason}`)
        }
        done++
        setUploadState({ done, total, failures: [...failures] })
      }
    }
  }

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
            metadata_spec: Object.keys(r.metadata).length ? r.metadata : undefined,
          })),
        }),
      }).then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.message || 'Batch failed')
        return data
      })
    },
    onSuccess: async (data) => {
      if (data.data.errors?.length) {
        setRows(prev => prev.map((row, i) => {
          const err = data.data.errors.find((e: any) => e.row === i + 1)
          return err ? { ...row, error: err.error } : row
        }))
      }
      queryClient.invalidateQueries({ queryKey: ['node-tree'] })
      queryClient.invalidateQueries({ queryKey: ['node-children', parentId] })

      // Records exist now — attach files as a second phase so an upload
      // failure can never roll back successfully created descriptions.
      if (hasFileWork) {
        try {
          await attachFiles(data.data.created ?? [])
        } catch {
          /* individual failures are already collected in uploadState */
        }
      }
      setResult(data.data)
    },
  })

  const updateRow = useCallback((id: string, field: keyof EntryRow, value: string) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }, [])

  const updateMeta = useCallback((id: string, name: string, value: any) => {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r
      const nextErrors = { ...(r.fieldErrors ?? {}) }
      delete nextErrors[name]   // manual edit clears that cell's import error
      return { ...r, metadata: { ...r.metadata, [name]: value }, fieldErrors: nextErrors }
    }))
  }, [])

  const updateFiles = useCallback((id: string, raw: string) => {
    const names = raw.split(';').map(s => s.trim()).filter(Boolean)
    setRows(prev => prev.map(r => r.id === id ? { ...r, files: names } : r))
  }, [])

  const deleteRow = useCallback((id: string) => {
    setRows(prev => prev.filter(r => r.id !== id))
  }, [])

  const addRow = () => setRows(prev => [...prev, emptyRow()])

  // ── Paste: step 1 → parse and auto-resolve headers ──
  const handleParse = () => {
    const p = parsePaste(pasteText)
    if (!p.rows.length) return
    setParsed(p)
    setColumnMap(p.headers.map(h => autoResolveHeader(h, fields)))
    setPasteStage('mapping')
  }

  // ── Paste: step 2 → build rows using the confirmed mapping ──
  const handleMappingApply = () => {
    if (!parsed) return

    const newRows: EntryRow[] = parsed.rows.map(cells => {
      const row = emptyRow()
      const fieldErrors: Record<string, string> = {}

      columnMap.forEach((target, i) => {
        if (!target || target === IGNORE) return
        const raw = cells[i] ?? ''
        if (target === FILES_COL) {
          row.files = raw.split(';').map(f => f.trim()).filter(Boolean)
        } else if (target === REPTYPE_COL) {
          row.repType = raw.trim()
        } else if (target.startsWith('meta:')) {
          const name = target.slice(5)
          const field = fields.find(f => f.name === name)
          if (!field) return
          const { value, error } = coerceValue(raw, field)
          if (error) {
            fieldErrors[name] = error
            row.metadata[name] = raw     // keep the raw text so it's editable
          } else if (value !== undefined) {
            row.metadata[name] = value
          }
        } else {
          ;(row as any)[target] = raw
        }
      })

      if (Object.keys(fieldErrors).length) row.fieldErrors = fieldErrors
      return row
    })

    // Surface columns for every metadata field the paste actually mapped.
    const mappedMeta = columnMap
      .filter(t => t && t.startsWith('meta:'))
      .map(t => t.slice(5))
    setMetaColumnNames(prev => Array.from(new Set([...prev, ...mappedMeta])))

    setRows(prev => {
      const keepers = prev.filter(r => r.title || r.local_ref)
      return [...keepers, ...newRows, emptyRow()]
    })

    setPasteText('')
    setParsed(null)
    setColumnMap([])
    setPasteStage('closed')
  }

  const cancelPaste = () => {
    setPasteText(''); setParsed(null); setColumnMap([]); setPasteStage('closed')
  }

  const unresolvedCount = columnMap.filter(t => t === '').length
  const validRows = rows.filter(r => r.title.trim() && r.local_ref.trim())
  const rowsWithCellErrors = rows.filter(r => r.fieldErrors && Object.keys(r.fieldErrors).length)
  const canSubmit =
    !!hierarchyTypeId && !!levelName && validRows.length > 0 &&
    rowsWithCellErrors.length === 0 && !fileBlockers

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
                {uploadState && (
                  <div className={styles.resultDetail}>
                    {uploadState.total - uploadState.failures.length} of {uploadState.total} file
                    {uploadState.total !== 1 ? 's' : ''} uploaded
                  </div>
                )}
                {uploadState && uploadState.failures.length > 0 && (
                  <div className={styles.resultWarning}>
                    {uploadState.failures.length} file
                    {uploadState.failures.length !== 1 ? 's' : ''} failed:{' '}
                    {uploadState.failures.slice(0, 4).join(', ')}
                    {uploadState.failures.length > 4 && ` +${uploadState.failures.length - 4} more`}
                    {' '}— the records were created; you can attach these manually.
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
                  disabled={!levelName}
                  title={!levelName ? 'Choose a level first so custom fields can be matched' : undefined}
                  onClick={() => setPasteStage(s => s === 'closed' ? 'input' : 'closed')}
                >
                  <ClipboardPaste size={13} /> Paste from spreadsheet
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={e => {
                    setPickedFiles(Array.from(e.target.files ?? []))
                    e.target.value = ''
                  }}
                />
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => fileInputRef.current?.click()}
                  title="Select the files referenced by the sheet's files column"
                >
                  <Paperclip size={13} /> Select files
                  {pickedFiles.length > 0 && ` (${pickedFiles.length})`}
                </button>
              </div>
            </div>

            {/* Paste — step 1: the data */}
            {pasteStage === 'input' && (
              <div className={styles.pastePanel}>
                <p className={styles.pasteHint}>
                  Paste tab- or comma-separated data with a header row. Core columns:{' '}
                  <code>title, local_ref, date_start, date_end, description</code>.
                  {fields.length > 0 && <> Custom fields for this level are matched by name or label.</>}
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
                  <button className="btn btn-ghost btn-sm" onClick={cancelPaste}>Cancel</button>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!pasteText.trim()}
                    onClick={handleParse}
                  >
                    Continue <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            )}

            {/* Paste — step 2: confirm the column mapping */}
            {pasteStage === 'mapping' && parsed && (
              <div className={styles.pastePanel}>
                <p className={styles.pasteHint}>
                  {parsed.rows.length} row{parsed.rows.length !== 1 ? 's' : ''} detected.
                  Check how each column maps
                  {!parsed.hasHeader && <> — no header row was detected, so columns are listed by position</>}.
                </p>

                <div className={styles.mappingList}>
                  {parsed.headers.map((h, i) => {
                    const target = columnMap[i]
                    const sample = parsed.rows.find(r => (r[i] ?? '').trim())?.[i] ?? ''
                    return (
                      <div
                        key={i}
                        className={`${styles.mappingRow} ${target === '' ? styles.mappingRowUnresolved : ''}`}
                      >
                        <div className={styles.mappingSource}>
                          <span className={styles.mappingHeader}>{h || `Column ${i + 1}`}</span>
                          {sample && <span className={styles.mappingSample}>e.g. {sample}</span>}
                        </div>
                        <ArrowRight size={12} className={styles.mappingArrow} />
                        <select
                          className={styles.mappingSelect}
                          value={target}
                          onChange={e => setColumnMap(prev =>
                            prev.map((t, j) => j === i ? e.target.value : t))}
                        >
                          <option value="">— choose —</option>
                          <option value={IGNORE}>Ignore this column</option>
                          <optgroup label="Files">
                            <option value={FILES_COL}>Filenames (semicolon separated)</option>
                            <option value={REPTYPE_COL}>Representation type</option>
                          </optgroup>
                          <optgroup label="Core fields">
                            {CORE_FIELDS.map(c => (
                              <option key={c.key} value={c.key}>{c.label}</option>
                            ))}
                          </optgroup>
                          {fields.length > 0 && (
                            <optgroup label="Custom fields">
                              {fields.map(f => (
                                <option key={f.name} value={`meta:${f.name}`}>{f.label}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </div>
                    )
                  })}
                </div>

                {unresolvedCount > 0 && (
                  <div className={styles.mappingWarning}>
                    <AlertCircle size={13} />
                    {unresolvedCount} column{unresolvedCount !== 1 ? 's' : ''} still need a decision —
                    map each to a field or choose “Ignore this column”.
                  </div>
                )}

                <div className={styles.pasteActions}>
                  <button className="btn btn-ghost btn-sm" onClick={cancelPaste}>Cancel</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setPasteStage('input')}>Back</button>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={unresolvedCount > 0}
                    onClick={handleMappingApply}
                  >
                    Add {parsed.rows.length} row{parsed.rows.length !== 1 ? 's' : ''}
                  </button>
                </div>
              </div>
            )}

            {/* File reconciliation */}
            {filesInPlay && (
              <div className={styles.filePanel}>
                <div className={styles.filePanelRow}>
                  <FileCheck2 size={14} className={styles.filePanelIcon} />
                  <span className={styles.filePanelSummary}>
                    {reconciliation.matched} file{reconciliation.matched !== 1 ? 's' : ''} matched
                    across {reconciliation.rowsWithFiles} row{reconciliation.rowsWithFiles !== 1 ? 's' : ''}
                    {pickedFiles.length > 0 && ` · ${pickedFiles.length} selected`}
                  </span>
                  {pickedFiles.length > 0 && (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={autoMatchFiles}
                        title="Fill the Files column by matching filenames against Ref, then Title">
                        Auto-match
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => {
                        setPickedFiles([]); setAutoMatchReport(null)
                      }}>
                        Clear
                      </button>
                    </>
                  )}
                </div>

                {/* Quick way to give every file-bearing row the same representation
                    type — the common case when the sheet didn't supply one. */}
                {reconciliation.rowsWithFiles > 0 && (repTypes ?? []).length > 0 && (
                  <div className={styles.filePanelRow}>
                    <span className={styles.fileNote}>Set representation for all rows with files:</span>
                    <select
                      className={styles.repTypeAll}
                      value=""
                      onChange={e => {
                        const v = e.target.value
                        if (!v) return
                        setRows(prev => prev.map(r =>
                          r.files.length > 0 ? { ...r, repType: v } : r))
                      }}
                    >
                      <option value="">Choose…</option>
                      {(repTypes ?? []).map(t => (
                        <option key={t.id} value={t.name}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {autoMatchReport && (
                  <div className={styles.fileNote}>
                    Auto-match: {autoMatchReport.matched} file
                    {autoMatchReport.matched !== 1 ? 's' : ''} assigned
                    {autoMatchReport.unmatched.length > 0 && (
                      <> · {autoMatchReport.unmatched.length} had no matching row
                        ({autoMatchReport.unmatched.slice(0, 4).join(', ')}
                        {autoMatchReport.unmatched.length > 4 && ` +${autoMatchReport.unmatched.length - 4}`})
                      </>
                    )}
                  </div>
                )}

                {reconciliation.missing.length > 0 && (
                  <div className={styles.fileProblem}>
                    <AlertCircle size={12} />
                    <span>
                      {reconciliation.missing.length} file
                      {reconciliation.missing.length !== 1 ? 's' : ''} named in the sheet
                      {reconciliation.missing.length !== 1 ? ' were' : ' was'} not selected:{' '}
                      <code>{reconciliation.missing.slice(0, 5).join(', ')}</code>
                      {reconciliation.missing.length > 5 && ` +${reconciliation.missing.length - 5} more`}
                    </span>
                  </div>
                )}

                {reconciliation.rowsMissingRepType > 0 && (
                  <div className={styles.fileProblem}>
                    <AlertCircle size={12} />
                    <span>
                      {reconciliation.rowsMissingRepType} row
                      {reconciliation.rowsMissingRepType !== 1 ? 's have' : ' has'} files but no
                      representation type.
                    </span>
                  </div>
                )}

                {levelBlocksFiles && (
                  <div className={styles.fileProblem}>
                    <AlertCircle size={12} />
                    <span>
                      The level <strong>{levelName}</strong> isn’t configured to hold objects, so
                      files can’t be attached to it. Enable “object level” for this level under
                      Administration → Hierarchies, or choose a level that already allows objects.
                    </span>
                  </div>
                )}

                {reconciliation.badRepTypes.length > 0 && (
                  <div className={styles.fileProblem}>
                    <AlertCircle size={12} />
                    <span>
                      Unknown representation type: <code>{reconciliation.badRepTypes.join(', ')}</code>.
                      Known types: {(repTypes ?? []).map(t => t.name).join(', ') || '(none configured)'}
                    </span>
                  </div>
                )}

                {reconciliation.unreferenced.length > 0 && (
                  <div className={styles.fileNote}>
                    {reconciliation.unreferenced.length} selected file
                    {reconciliation.unreferenced.length !== 1 ? 's are' : ' is'} not referenced by any
                    row and will be ignored.
                  </div>
                )}
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
                    {metaColumns.map(f => (
                      <th key={f.name} className={styles.thMeta} title={f.help_text}>
                        {f.label}
                      </th>
                    ))}
                    {filesInPlay && <th className={styles.thMeta}>Files</th>}
                    {filesInPlay && <th className={styles.thMeta}>Representation</th>}
                    <th className={styles.thAction} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <EntryRowComponent
                      key={row.id}
                      row={row}
                      index={i}
                      metaColumns={metaColumns}
                      showFiles={filesInPlay}
                      findFile={findFile}
                      repTypes={repTypes}
                      onChange={updateRow}
                      onMetaChange={updateMeta}
                      onFilesChange={updateFiles}
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
                {rowsWithCellErrors.length > 0 && (
                  <span className={styles.cellErrorCount}>
                    <AlertCircle size={12} />
                    {rowsWithCellErrors.length} row{rowsWithCellErrors.length !== 1 ? 's' : ''} with invalid values
                  </span>
                )}
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
                    ? (uploadState
                        ? <><Spinner size={14} /> Uploading {uploadState.done}/{uploadState.total}…</>
                        : <><Spinner size={14} /> Creating…</>)
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
