import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation, useSearchParams, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import {
  Plus, Edit2, Trash2, ChevronRight, FileText,
  Calendar, Globe, Lock, Archive, RotateCcw,
  Paperclip, StickyNote, History, Link,
  Download, Upload, X, Save, AlertCircle, MoveRight, Zap, MapPin, Tag, Link2, Check, Flag, Search, RefreshCw,
  CheckSquare, Square
} from 'lucide-react'
import { nodesApi, exportApi, oaiApi, hierarchyApi, eadApi } from '@/api'
import NodeTree from '@/components/tree/NodeTree'
import NodeForm from '@/components/node/NodeForm'
import ResizablePanels from '@/components/ui/ResizablePanels'
import { Spinner, PrintLabelsButton } from '@/components/ui'
import NodeRelationsTab, { NodeLocationsTab, NodeClassificationsTab } from '@/components/node/NodeRelationsTab'
import { MetadataFieldValue } from '@/components/node/MetadataFieldRenderer'
import PlacesPanel from '@/components/geo/PlacesPanel'
import FlagsTab from '@/components/node/FlagsTab'
import { acquisitionsApi } from '@/api'
import TagsPanel from '@/components/geo/TagsPanel'
import MoveNodeDialog from '@/components/node/MoveNodeDialog'
import RapidEntryModal from '@/components/node/RapidEntryModal'
import type { NodeStub, NodeDetail, NodeStatus } from '@/types'
import styles from './ResourcesPage.module.css'
import RepresentationsTab from '@/components/node/RepresentationsTab'
import NodeIdentifiersTab from '@/components/node/NodeIdentifiersTab'
import { Layers, Copy, Fingerprint } from 'lucide-react'
import BookmarkButton from '@/components/layout/BookmarkButton'
import OcrButton from '@/components/node/OcrButton'

// ─── Status badge ─────────────────────────────────────────────────────

const STATUS_ICONS: Record<NodeStatus, typeof Globe> = {
  draft: Archive, published: Globe, restricted: Lock,
}

const STATUS_TRANSITIONS: Record<NodeStatus, NodeStatus[]> = {
  draft: ['published', 'restricted'],
  published: ['draft', 'restricted'],
  restricted: ['draft', 'published'],
}

function StatusBadge({ status }: { status: NodeStatus }) {
  const Icon = STATUS_ICONS[status]
  return (
    <span className={`badge badge-${status}`}>
      <Icon size={10} />
      {status}
    </span>
  )
}


// ─── Export menu (multi-format) ───────────────────────────────────────

function ExportMenu({ nodeId }: { nodeId: number }) {
  const [open, setOpen] = useState(false)
  const [loadingAid, setLoadingAid] = useState(false)
  const { data: formats } = useQuery({
    queryKey: ['export-formats'],
    queryFn: () => exportApi.listFormats().then(r => r.data.data as any[]),
    enabled: open,
  })

  const handleFindingAid = async () => {
    setLoadingAid(true)
    setOpen(false)
    try {
      const res = await nodesApi.findingAid(nodeId)
      const blob = new Blob([res.data as BlobPart], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `finding_aid_${nodeId}.pdf`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (e) { /* silent */ }
    finally { setLoadingAid(false) }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(v => !v)}>
        <Download size={14} /> Export
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 100 }} onClick={() => setOpen(false)} />
          <div className={styles.eadMenu} style={{ minWidth: 260 }}>
            {/* Finding aid */}
            <div className={styles.eadMenuSection}>
              <div className={styles.eadMenuSectionTitle}>Reports</div>
              <button className={styles.eadMenuItem} onClick={handleFindingAid} disabled={loadingAid}
                style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', textAlign: 'left' }}>
                <FileText size={12} />
                <div>
                  <span className={styles.eadMenuItemTitle}>Finding aid (PDF)</span>
                  <span className={styles.eadMenuItemDesc}>Full finding aid with table of contents</span>
                </div>
              </button>
            </div>
            {/* EAD exports */}
            {(formats ?? []).map((fmt: any) => (
              <div key={fmt.id} className={styles.eadMenuSection}>
                <div className={styles.eadMenuSectionTitle}>{fmt.label}</div>
                <a className={styles.eadMenuItem}
                   href={exportApi.exportUrl(nodeId, fmt.id, true)} download
                   onClick={() => setOpen(false)}>
                  <Download size={12} />
                  <div>
                    <span className={styles.eadMenuItemTitle}>Full export</span>
                    <span className={styles.eadMenuItemDesc}>Node and all descendants</span>
                  </div>
                </a>
                <a className={styles.eadMenuItem}
                   href={exportApi.exportUrl(nodeId, fmt.id, false)} download
                   onClick={() => setOpen(false)}>
                  <FileText size={12} />
                  <div>
                    <span className={styles.eadMenuItemTitle}>Single record</span>
                    <span className={styles.eadMenuItemDesc}>This node only</span>
                  </div>
                </a>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Import modal (EAD file + OAI-PMH) ───────────────────────────────

function ImportModal({ onClose, onImported }: {
  onClose: () => void
  onImported: () => void
}) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'ead' | 'oai'>('ead')
  const [result, setResult] = useState<any>(null)
  const [importError, setImportError] = useState('')

  // Shared
  const [hierarchyTypeId, setHierarchyTypeId] = useState('')
  const [parentNodeId, setParentNodeId] = useState('')

  // EAD file
  const [file, setFile] = useState<File | null>(null)

  // OAI-PMH
  const [oaiUrl, setOaiUrl] = useState('')
  const [oaiInfo, setOaiInfo] = useState<any>(null)
  const [oaiFormats, setOaiFormats] = useState<any[]>([])
  const [oaiPrefix, setOaiPrefix] = useState('oai_dc')
  const [oaiIdentifier, setOaiIdentifier] = useState('')
  const [identifying, setIdentifying] = useState(false)

  const { data: hierarchyTypes } = useQuery({
    queryKey: ['hierarchy-types', 'resource'],
    queryFn: () => hierarchyApi.listTypes('resource').then(r => r.data.data as any[]),
  })

  const handleIdentify = async () => {
    if (!oaiUrl.trim()) return
    setIdentifying(true)
    setOaiInfo(null)
    setImportError('')
    try {
      const [infoRes, fmtRes] = await Promise.all([
        oaiApi.identify(oaiUrl.trim()),
        oaiApi.listFormats(oaiUrl.trim()),
      ])
      setOaiInfo(infoRes.data.data)
      const fmts = fmtRes.data.data
      setOaiFormats(fmts)
      // Auto-select first available format
      if (fmts.length > 0) setOaiPrefix(fmts[0].prefix)
    } catch (e: any) {
      setImportError(e.response?.data?.message ?? 'Could not connect to OAI-PMH endpoint')
    } finally {
      setIdentifying(false)
    }
  }

  const eadMutation = useMutation({
    mutationFn: () => {
      const formData = new FormData()
      formData.append('file', file!)
      formData.append('hierarchy_type_id', hierarchyTypeId)
      if (parentNodeId) formData.append('parent_node_id', parentNodeId)
      return eadApi.import(formData)
    },
    onSuccess: (res: any) => {
      setResult(res.data.data)
      setImportError('')
      queryClient.invalidateQueries({ queryKey: ['node-tree'] })
      onImported()
    },
    onError: (err: any) => setImportError(err.response?.data?.message ?? 'EAD import failed'),
  })

  const oaiMutation = useMutation({
    mutationFn: () => oaiApi.harvest({
      base_url: oaiUrl.trim(),
      metadata_prefix: oaiPrefix,
      oai_identifier: oaiIdentifier.trim() || undefined,
      hierarchy_type_id: parseInt(hierarchyTypeId),
      parent_node_id: parentNodeId ? parseInt(parentNodeId) : undefined,
    }),
    onSuccess: (res) => {
      setResult(res.data.data)
      setImportError('')
      queryClient.invalidateQueries({ queryKey: ['node-tree'] })
      onImported()
    },
    onError: (err: any) => setImportError(err.response?.data?.message ?? 'OAI harvest failed'),
  })

  const isPending = eadMutation.isPending || oaiMutation.isPending

  const canSubmit = mode === 'ead'
    ? !!file && !!hierarchyTypeId
    : !!oaiUrl && !!oaiIdentifier && !!hierarchyTypeId

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}><Upload size={16} /> Import records</h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><X size={14} /></button>
        </div>

        {result ? (
          <div className={styles.modalBody}>
            <div className={styles.importSuccess}>
              <div className={styles.importSuccessTitle}>
                Import complete — {result.total_created} record{result.total_created !== 1 ? 's' : ''} created
              </div>
              {result.warnings?.length > 0 && (
                <div className={styles.importWarnings}>
                  <div className={styles.importWarningsTitle}><AlertCircle size={13} /> Warnings</div>
                  {result.warnings.map((w: string, i: number) => (
                    <p key={i} className={styles.importWarning}>{w}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.modalBody}>
            {/* Mode tabs */}
            <div className={styles.modeTabs}>
              <button className={`${styles.modeTab} ${mode === 'ead' ? styles.modeTabActive : ''}`}
                onClick={() => setMode('ead')}>EAD 2002 file</button>
              <button className={`${styles.modeTab} ${mode === 'oai' ? styles.modeTabActive : ''}`}
                onClick={() => setMode('oai')}>OAI-PMH harvest</button>
            </div>

            {importError && (
              <div className={styles.importError}><AlertCircle size={14} /> {importError}</div>
            )}

            {mode === 'ead' ? (
              <>
                <div className="form-group">
                  <label>EAD 2002 XML file *</label>
                  <input type="file" accept=".xml"
                    onChange={e => setFile(e.target.files?.[0] ?? null)} />
                </div>
              </>
            ) : (
              <>
                <div className={styles.oaiRow}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>OAI-PMH base URL *</label>
                    <input value={oaiUrl} onChange={e => setOaiUrl(e.target.value)}
                      placeholder="https://oai-pmh.riksarkivet.se/OAI"
                      onKeyDown={e => e.key === 'Enter' && handleIdentify()} />
                  </div>
                  <button className="btn btn-secondary btn-sm" style={{ marginTop: 21 }}
                    onClick={handleIdentify} disabled={!oaiUrl || identifying}>
                    {identifying ? '…' : 'Verify'}
                  </button>
                </div>
                {oaiInfo && (
                  <div className={styles.oaiInfo}>
                    <span className={styles.oaiInfoName}>{oaiInfo.repository_name}</span>
                    <span className={styles.oaiInfoMeta}>Protocol {oaiInfo.protocol_version} · {oaiInfo.earliest_datestamp}</span>
                  </div>
                )}
                <div className="form-group">
                  <label>OAI identifier *</label>
                  <input value={oaiIdentifier} onChange={e => setOaiIdentifier(e.target.value)}
                    placeholder="oai:example.org:record123"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }} />
                  <span className="form-hint">The identifier value from the repository — e.g. <code>SE/ULA/10012/A I</code> (paste as-is, spaces are fine)</span>
                </div>
                <div className="form-group">
                  <label>Metadata format</label>
                  <select value={oaiPrefix} onChange={e => setOaiPrefix(e.target.value)}>
                    {oaiFormats.length === 0
                      ? <option value={oaiPrefix}>{oaiPrefix}</option>
                      : oaiFormats.map((f: any) => (
                          <option key={f.prefix} value={f.prefix}>{f.prefix}</option>
                        ))
                    }
                  </select>
                  {oaiFormats.length === 0 && (
                    <span className="form-hint">Click Verify to load available formats from the repository</span>
                  )}
                </div>
              </>
            )}

            {/* Shared fields */}
            <div className="form-group">
              <label>Hierarchy type *</label>
              <select value={hierarchyTypeId} onChange={e => setHierarchyTypeId(e.target.value)}>
                <option value="">Select hierarchy…</option>
                {hierarchyTypes?.map((ht: any) => (
                  <option key={ht.id} value={ht.id}>{ht.name}</option>
                ))}
              </select>
              <span className="form-hint">Level names will be matched to this hierarchy</span>
            </div>
            <div className="form-group">
              <label>Import under node (optional)</label>
              <input type="number" value={parentNodeId}
                onChange={e => setParentNodeId(e.target.value)}
                placeholder="Parent node ID — leave empty for root" />
            </div>
          </div>
        )}

        <div className={styles.modalFooter}>
          <button className="btn btn-ghost" onClick={onClose}>
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button className="btn btn-primary"
              disabled={!canSubmit || isPending}
              onClick={() => mode === 'ead' ? eadMutation.mutate() : oaiMutation.mutate()}>
              {isPending ? 'Importing…' : <><Upload size={14} /> Import</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}


// ─── Move node dialog ─────────────────────────────────────────────────

function MoveDialog({ node, onMoved, onClose }: {
  node: NodeDetail
  onMoved: () => void
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [targetId, setTargetId] = useState<number | null>(null)
  const [toRoot, setToRoot] = useState(false)
  const [moveError, setMoveError] = useState('')

  const { data: searchResults, isLoading } = useQuery({
    queryKey: ['nodes-move-search', search],
    queryFn: () => nodesApi.list({ q: search, per_page: 10 }).then(r => r.data.data as any[]),
    enabled: search.length > 1,
  })

  const moveMutation = useMutation({
    mutationFn: () => nodesApi.move(node.id, toRoot ? null : targetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node-tree'] })
      queryClient.invalidateQueries({ queryKey: ['node-children'] })
      queryClient.invalidateQueries({ queryKey: ['node', node.id] })
      onMoved()
      onClose()
    },
    onError: (err: any) => setMoveError(err.response?.data?.message ?? 'Move failed'),
  })

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            <MoveRight size={15} /> Move
          </h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.moveCurrentPath}>
            <span className={styles.moveLabel}>Moving:</span>
            <strong>{node.title}</strong>
            <span className="ref-code">{node.ref_code}</span>
          </div>
          <div className={styles.moveCurrentPath}>
            <span className={styles.moveLabel}>Current parent:</span>
            <span>{node.breadcrumb.length > 1 ? node.breadcrumb[node.breadcrumb.length - 2]?.title : 'Root'}</span>
          </div>

          {moveError && (
            <div className={styles.importError}><AlertCircle size={14} /> {moveError}</div>
          )}

          <div className="form-group">
            <label>New parent node</label>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setTargetId(null); setToRoot(false); setMoveError('') }}
              placeholder="Search for new parent…"
              autoFocus
              disabled={toRoot}
            />
          </div>

          {search.length > 1 && !toRoot && (
            <div className={styles.moveResults}>
              {isLoading && <div className={styles.moveResultHint}>Searching…</div>}
              {searchResults?.filter((n: any) => n.id !== node.id).map((n: any) => (
                <button
                  key={n.id}
                  className={styles.moveResult + (targetId === n.id ? ' ' + styles.moveResultSelected : '')}
                  onClick={() => { setTargetId(n.id); setSearch(n.title) }}
                >
                  <span className={styles.moveResultTitle}>{n.title}</span>
                  <span className={styles.moveResultRef}>{n.ref_code}</span>
                </button>
              ))}
              {!isLoading && searchResults?.filter((n: any) => n.id !== node.id).length === 0 && (
                <p className={styles.moveResultHint}>No results</p>
              )}
            </div>
          )}

          <label className={styles.moveRootLabel}>
            <input type="checkbox" checked={toRoot}
              onChange={e => { setToRoot(e.target.checked); setSearch(''); setTargetId(null) }} />
            Move to root (no parent)
          </label>
        </div>
        <div className={styles.modalFooter}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={moveMutation.isPending || (!toRoot && !targetId)}
            onClick={() => moveMutation.mutate()}
          >
            {moveMutation.isPending ? 'Moving…' : 'Move'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Detail panel ─────────────────────────────────────────────────────

function CopyLinkButton({ nodeId, refCode }: { nodeId: number; refCode: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="btn btn-ghost btn-sm btn-icon"
      onClick={() => {
        const url = `${window.location.origin}/app/resources?node=${nodeId}`
        navigator.clipboard.writeText(url).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
      }}
      title={copied ? `Copied link for ${refCode}` : `Copy direct link (${refCode})`}
    >
      {copied ? <Check size={14} /> : <Link2 size={14} />}
    </button>
  )
}


// ─── NodeAccessionsTab ────────────────────────────────────────────────

function NodeAccessionsTab({ nodeId }: { nodeId: number }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [linking, setLinking] = useState(false)

  // Accessions this node is already linked to
  const { data: linkedAccessions = [], isLoading } = useQuery({
    queryKey: ['node-accessions', nodeId],
    queryFn: async () => {
      // Find accessions that have this node linked
      const all = await acquisitionsApi.listAccessions().then(r => r.data.data)
      const linked = []
      for (const acc of all) {
        const nodes = await acquisitionsApi.getAccessionNodes(acc.id).then(r => r.data.data)
        if ((nodes as any[]).some((n: any) => n.id === nodeId)) linked.push(acc)
      }
      return linked
    },
  })

  const { data: allAccessions = [] } = useQuery({
    queryKey: ['accessions'],
    queryFn: () => acquisitionsApi.listAccessions().then(r => r.data.data),
    enabled: linking,
  })

  const linkMutation = useMutation({
    mutationFn: (accessionId: number) => acquisitionsApi.linkNode(accessionId, nodeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node-accessions', nodeId] })
      queryClient.invalidateQueries({ queryKey: ['accessions'] })
      setLinking(false)
      setSearch('')
    },
  })

  const unlinkMutation = useMutation({
    mutationFn: (accessionId: number) => acquisitionsApi.unlinkNode(accessionId, nodeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['node-accessions', nodeId] }),
  })

  const linkedIds = new Set((linkedAccessions as any[]).map((a: any) => a.id))
  const filtered = (allAccessions as any[]).filter((a: any) =>
    !linkedIds.has(a.id) && (
      !search ||
      a.accession_number.toLowerCase().includes(search.toLowerCase()) ||
      a.title.toLowerCase().includes(search.toLowerCase())
    )
  )

  return (
    <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-ink-muted)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Archive size={14} /> Accessions
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => setLinking(v => !v)}>
          <Plus size={13} /> Link accession
        </button>
      </div>

      {/* Link picker */}
      {linking && (
        <div style={{ border: '1px solid var(--color-accent-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--color-accent-bg)' }}>
          <div style={{ padding: 'var(--space-3)' }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search accessions…" autoFocus />
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <p style={{ padding: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--color-ink-faint)', fontStyle: 'italic', textAlign: 'center' }}>
                {allAccessions.length === 0 ? 'No accessions yet. Create one in Acquisitions.' : 'No matching accessions.'}
              </p>
            )}
            {filtered.map((acc: any) => (
              <button key={acc.id}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', width: '100%',
                  padding: '10px var(--space-4)', background: 'none', border: 'none',
                  borderBottom: '1px solid var(--color-border)', cursor: 'pointer',
                  textAlign: 'left', fontFamily: 'var(--font-sans)', transition: 'background 0.06s' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                onClick={() => linkMutation.mutate(acc.id)}>
                <code style={{ fontSize: 'var(--text-xs)', color: 'var(--color-accent)', flexShrink: 0 }}>
                  {acc.accession_number}
                </code>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {acc.title}
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)', flexShrink: 0 }}>
                  {acc.status}
                </span>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 'var(--space-2) var(--space-3)', borderTop: '1px solid var(--color-border)' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setLinking(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Linked accessions */}
      {isLoading && <Spinner size={16} />}
      {!isLoading && (linkedAccessions as any[]).length === 0 && !linking && (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-faint)', fontStyle: 'italic' }}>
          Not linked to any accession.
        </p>
      )}
      {(linkedAccessions as any[]).map((acc: any) => (
        <div key={acc.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
          <Archive size={13} style={{ color: 'var(--color-ink-faint)', flexShrink: 0 }} />
          <button
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', background: 'none',
              border: 'none', cursor: 'pointer', textAlign: 'left', flex: 1, minWidth: 0, padding: 0,
              fontFamily: 'var(--font-sans)' }}
            onClick={() => navigate(`/app/acquisitions?section=accessions&id=${acc.id}`)}
            title="View accession"
          >
            <code style={{ fontSize: 'var(--text-xs)', color: 'var(--color-accent)', flexShrink: 0 }}>
              {acc.accession_number}
            </code>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink)', flex: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {acc.title}
            </span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-accent)', flexShrink: 0 }}>↗</span>
          </button>
          <button className="btn btn-ghost btn-sm btn-icon"
            onClick={() => unlinkMutation.mutate(acc.id)} title="Unlink">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

// ─── Bulk delete dialog ───────────────────────────────────────────────

function BulkDeleteDialog({ count, onConfirm, onClose, isPending }: {
  count: number
  onConfirm: (force: boolean) => void
  onClose: () => void
  isPending: boolean
}) {
  const [force, setForce] = useState(false)
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}><Trash2 size={15} /> Delete {count} node{count !== 1 ? 's' : ''}</h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><X size={14} /></button>
        </div>
        <div className={styles.modalBody}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-muted)' }}>
            This will permanently delete the selected {count} node{count !== 1 ? 's' : ''}. This cannot be undone.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-4)', fontSize: 'var(--text-sm)', cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />
            <span>Also delete all descendants recursively</span>
          </label>
          {force && (
            <p style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
              <AlertCircle size={12} />
              All child nodes at every level will be permanently removed.
            </p>
          )}
        </div>
        <div className={styles.modalFooter}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-sm"
            style={{ background: 'var(--color-error)', color: '#fff' }}
            onClick={() => onConfirm(force)}
            disabled={isPending}
          >
            {isPending ? <Spinner size={13} /> : <Trash2 size={13} />}
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Node detail panel ────────────────────────────────────────────────

function NodeDetailPanel({
  nodeId,
  onEdit,
  onSelectChild,
}: {
  nodeId: number
  onEdit: (node: NodeDetail) => void
  onSelectChild: (node: NodeStub) => void
}) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'details' | 'relations' | 'locations' | 'classifications' | 'places' | 'tags' | 'flags' | 'accessions' | 'notes' | 'attachments' | 'history' | 'representations' | 'identifiers'>('details')
  const [showMove, setShowMove] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['node', nodeId],
    queryFn: () => nodesApi.get(nodeId).then(r => r.data.data),
  })

  const statusMutation = useMutation({
    mutationFn: (status: NodeStatus) => nodesApi.updateStatus(nodeId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node', nodeId] })
      queryClient.invalidateQueries({ queryKey: ['node-tree'] })
      queryClient.invalidateQueries({ queryKey: ['node-children'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (force: boolean) => nodesApi.delete(nodeId, force),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node-tree'] })
      queryClient.invalidateQueries({ queryKey: ['node-children'] })
    },
    onError: (err: any) => alert(err?.response?.data?.message ?? 'Delete failed'),
  })

  const handleDelete = async () => {
    if (!data) return
    let descendants = 0
    try {
      const res = await nodesApi.descendantCount(nodeId)
      descendants = res.data.data.descendant_count
    } catch {
      descendants = 0
    }
    if (descendants > 0) {
      const ok = confirm(
        `"${data.title}" has ${descendants} descendant record${descendants !== 1 ? 's' : ''}.\n\n` +
        `Deleting it will permanently delete this node AND all ${descendants} of them ` +
        `(${descendants + 1} records in total). This cannot be undone.\n\nAre you absolutely sure?`
      )
      if (ok) deleteMutation.mutate(true)
    } else {
      if (confirm(`Delete "${data.title}"? This cannot be undone.`)) deleteMutation.mutate(false)
    }
  }

  if (isLoading) return <div className={styles.detailLoading}>Loading…</div>
  if (!data) return null

  const transitions = STATUS_TRANSITIONS[data.status]

  return (
    <div className={styles.detailPanel}>
      {/* Header */}
      <div className={styles.detailHeader}>
        <div className={styles.detailHeaderTop}>
          <div className={styles.breadcrumb}>
            {data.breadcrumb.map((crumb, i) => (
              <span key={crumb.id} className={styles.breadcrumbItem}>
                {i > 0 && <ChevronRight size={10} className={styles.breadcrumbSep} />}
                <span className={i === data.breadcrumb.length - 1 ? styles.breadcrumbCurrent : styles.breadcrumbLink}>
                  {crumb.title}
                </span>
              </span>
            ))}
          </div>
          <div className={styles.detailActions}>
            <BookmarkButton
              entityType="node"
              entityId={nodeId}
              title={data.title}
              subtitle={data.ref_code}
            />
            <CopyLinkButton nodeId={nodeId} refCode={data?.ref_code ?? ''} />
            <ExportMenu nodeId={nodeId} />
            <PrintLabelsButton nodeIds={[nodeId]} />
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowMove(true)} title="Move to different parent">
              <MoveRight size={14} />
            </button>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => onEdit(data)} title="Edit">
              <Edit2 size={14} />
            </button>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              onClick={handleDelete}
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        <div className={styles.detailTitleRow}>
          <h2 className={styles.detailTitle}>{data.title}</h2>
          <StatusBadge status={data.status} />
        </div>

        <div className={styles.detailMeta}>
          <span className="ref-code">{data.ref_code}</span>
          <span className={styles.metaSep}>·</span>
          <span className={styles.metaLevel}>{data.level_of_description}</span>
          {(data.date_start || data.date_end) && (
            <>
              <span className={styles.metaSep}>·</span>
              <span className={styles.metaDates}>
                <Calendar size={11} />
                {data.date_start?.slice(0, 4)}
                {data.date_end && data.date_end !== data.date_start && ` – ${data.date_end.slice(0, 4)}`}
              </span>
            </>
          )}
          {data.extent && (
            <>
              <span className={styles.metaSep}>·</span>
              <span className={styles.metaExtent}>{data.extent}</span>
            </>
          )}
        </div>

        {transitions.length > 0 && (
          <div className={styles.statusActions}>
            {transitions.map(s => (
              <button
                key={s}
                className="btn btn-secondary btn-sm"
                onClick={() => statusMutation.mutate(s)}
                disabled={statusMutation.isPending}
              >
                Set {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tabs */}
<div className={styles.tabs}>
  {[
    { key: 'details',         icon: <FileText size={13} />,   label: 'Details' },
    { key: 'relations',       icon: <Link size={13} />,       label: 'Relations' },
    { key: 'identifiers',     icon: <Fingerprint size={13} />, label: `Identifiers${data.identifiers?.length ? ` (${data.identifiers.length})` : ''}` },
    { key: 'locations',       icon: <MapPin size={13} />,     label: 'Locations' },
    { key: 'classifications', icon: <Tag size={13} />,        label: 'Classifications' },
    { key: 'places',          icon: <MapPin size={13} />,     label: 'Places' },
    { key: 'flags',           icon: <Flag size={13} />,       label: `Flags${data?.open_flag_count ? ` (${data.open_flag_count})` : ''}` },
    { key: 'accessions',      icon: <Archive size={13} />,    label: 'Accessions' },
    { key: 'tags',            icon: <Tag size={13} />,        label: 'Tags' },
    { key: 'notes',           icon: <StickyNote size={13} />, label: `Notes${data.notes.length ? ` (${data.notes.length})` : ''}` },
    { key: 'attachments',     icon: <Paperclip size={13} />,  label: `Files${data.attachments.length ? ` (${data.attachments.length})` : ''}` },
    ...(data.is_object ? [{
      key: 'representations',
      icon: <Layers size={13} />,
      label: `Objects${data.representations?.length ? ` (${data.representations.length})` : ''}`,
    }] : []),
    { key: 'history',         icon: <History size={13} />,   label: 'History' },
  ].map(({ key, icon, label }) => (
    <button
      key={key}
      className={`${styles.tab} ${activeTab === key ? styles.tabActive : ''}`}
      onClick={() => setActiveTab(key as typeof activeTab)}
    >
      {icon}{label}
    </button>
  ))}
</div>

      {showMove && data && (
        <MoveNodeDialog
          node={data}
          onClose={() => setShowMove(false)}
          onMoved={() => { setShowMove(false); queryClient.invalidateQueries({ queryKey: ['node-tree'] }) }}
        />
      )}
      <div className={styles.detailContent}>
        {activeTab === 'details'     && <DetailsTab node={data} onSelectChild={onSelectChild} />}
        {activeTab === 'relations'       && <NodeRelationsTab nodeId={nodeId} />}
        {activeTab === 'identifiers'     && <NodeIdentifiersTab nodeId={nodeId} />}
        {activeTab === 'locations'       && <NodeLocationsTab nodeId={nodeId} />}
        {activeTab === 'classifications' && <NodeClassificationsTab nodeId={nodeId} />}
        {activeTab === 'places'          && <PlacesPanel entityType="node" entityId={nodeId} />}
        {activeTab === 'tags'            && <TagsPanel entityType="node" entityId={nodeId} />}
        {activeTab === 'flags'          && <FlagsTab nodeId={nodeId} />}
        {activeTab === 'accessions'     && <NodeAccessionsTab nodeId={nodeId} />}
        {activeTab === 'notes'       && <NotesTab node={data} />}
        {activeTab === 'attachments' && <AttachmentsTab node={data} />}
        {activeTab === 'representations' && <RepresentationsTab node={data} />}
        {activeTab === 'history'     && <HistoryTab nodeId={nodeId} />}
      </div>
    </div>
  )
}

// ─── Children / Content panel ─────────────────────────────────────────

function ChildrenTab({ nodeId, onSelect }: { nodeId: number; onSelect: (node: NodeStub) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const PER_PAGE = 20

  useEffect(() => { setPage(1) }, [search])

  const { data, isLoading } = useQuery({
    queryKey: ['node-children-list', nodeId, search, page],
    queryFn: () => nodesApi.list({ parent_id: nodeId, q: search || undefined, page, per_page: PER_PAGE }).then(r => r.data),
    enabled: open,
  })

  const children: NodeStub[] = (data as any)?.data ?? []
  const total: number = (data as any)?.meta?.total ?? 0
  const pages: number = (data as any)?.meta?.pages ?? 1

  return (
    <div className={styles.childrenPanel}>
      <button className={styles.childrenToggle} onClick={() => setOpen(v => !v)}>
        <ChevronRight size={14} className={`${styles.childrenChevron} ${open ? styles.childrenChevronOpen : ''}`} />
        <span>Content</span>
        {total > 0 && <span className={styles.childrenCount}>{total}</span>}
      </button>

      {open && (
        <div className={styles.childrenBody}>
          <div className={styles.childrenFilterRow}>
            <div className={styles.childrenSearchWrap}>
              <Search size={12} className={styles.childrenSearchIcon} />
              <input
                className={styles.childrenSearchInput}
                placeholder="Filter…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button className={styles.childrenSearchClear} onClick={() => setSearch('')}>
                  <X size={11} />
                </button>
              )}
            </div>
          </div>

          {isLoading && <div className={styles.childrenLoading}><Spinner size={13} /></div>}

          {!isLoading && children.length === 0 && (
            <p className={styles.childrenEmpty}>
              {search ? `No results for "${search}"` : 'No immediate children.'}
            </p>
          )}

          {!isLoading && children.map(child => (
            <button key={child.id} className={styles.childRow} onClick={() => onSelect(child)}>
              <div className={styles.childRowInfo}>
                <span className={styles.childRowTitle}>{child.title || child.ref_code}</span>
                <div className={styles.childRowMeta}>
                  <span className="ref-code" style={{ fontSize: 'var(--text-xs)' }}>{child.ref_code}</span>
                  {child.level_of_description && (
                    <span className={styles.childRowLevel}>{child.level_of_description}</span>
                  )}
                  {child.status !== 'published' && (
                    <span className={`badge badge-${child.status}`} style={{ fontSize: '10px', padding: '1px 5px' }}>
                      {child.status}
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight size={12} className={styles.childRowArrow} />
            </button>
          ))}

          {pages > 1 && (
            <div className={styles.childrenPagination}>
              <button className="btn btn-ghost btn-sm btn-icon" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
              <span className={styles.childrenPaginationInfo}>{page} / {pages}</span>
              <button className="btn btn-ghost btn-sm btn-icon" disabled={page === pages} onClick={() => setPage(p => p + 1)}>›</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Details tab ──────────────────────────────────────────────────────

function DetailsTab({ node, onSelectChild }: { node: NodeDetail; onSelectChild: (node: NodeStub) => void }) {
  const fields = [
    { label: 'Description',             value: node.description },
    { label: 'Scope & Content',         value: node.scope_and_content },
    { label: 'Arrangement',             value: node.arrangement },
    { label: 'Access Conditions',       value: node.access_conditions },
    { label: 'Reproduction Conditions', value: node.reproduction_conditions },
    { label: 'Language',                value: node.language },
    { label: 'Finding Aids',            value: node.finding_aids },
  ].filter(f => f.value)

  return (
    <div className={styles.detailFields}>
      {fields.length === 0 && (
        <p className="text-faint" style={{ fontSize: 'var(--text-sm)', padding: 'var(--space-4) 0' }}>
          No description fields filled in yet.
        </p>
      )}
      {fields.map(({ label, value }) => (
        <div key={label} className={styles.field}>
          <dt className={styles.fieldLabel}>{label}</dt>
          <dd className={styles.fieldValue}>{value}</dd>
        </div>
      ))}
      {node.metadata_fields.length > 0 && Object.keys(node.metadata_spec ?? {}).length > 0 && (
        <>
          <hr style={{ margin: 'var(--space-4) 0', borderColor: 'var(--color-border)' }} />
          <div className={styles.metaSectionTitle}>Custom fields</div>
          {node.metadata_fields
            .filter((f: any) => node.metadata_spec[f.name] !== undefined && node.metadata_spec[f.name] !== '')
            .map((f: any) => (
              <div key={f.name} className={styles.field}>
                <dt className={styles.fieldLabel}>{f.label}</dt>
                <dd className={styles.fieldValue}>
                  <MetadataFieldValue field={f} value={node.metadata_spec[f.name]} />
                </dd>
              </div>
            ))}
        </>
      )}
      <div className={styles.fieldFooter}>
        <span>Created by {node.created_by || '—'}</span>
        <span>Updated {new Date(node.updated_at).toLocaleDateString()}</span>
      </div>
      <ChildrenTab nodeId={node.id} onSelect={onSelectChild} />
    </div>
  )
}

// ─── Notes tab ────────────────────────────────────────────────────────

const NOTE_TYPES = ['general', 'accruals', 'appraisal', 'provenance', 'processing']

function NoteCard({ node, note, onDeleted }: { node: NodeDetail; note: any; onDeleted: () => void }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(note.content)
  const [editType, setEditType] = useState(note.note_type)
  const [editPublic, setEditPublic] = useState(note.is_public)

  const updateMutation = useMutation({
    mutationFn: () => nodesApi.updateNote(node.id, note.id, {
      content: editContent, note_type: editType, is_public: editPublic,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node', node.id] })
      setEditing(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => nodesApi.deleteNote(node.id, note.id),
    onSuccess: onDeleted,
  })

  if (editing) {
    return (
      <div className={styles.noteCard}>
        <div className={styles.noteForm}>
          <div className="form-group">
            <label>Type</label>
            <select value={editType} onChange={e => setEditType(e.target.value)}>
              {NOTE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Content</label>
            <textarea value={editContent} onChange={e => setEditContent(e.target.value)} rows={4} autoFocus />
          </div>
          <label className={styles.checkboxLabel}>
            <input type="checkbox" checked={editPublic} onChange={e => setEditPublic(e.target.checked)} />
            Visible on public portal
          </label>
          <div className={styles.noteFormActions}>
            <button className="btn btn-ghost btn-sm" onClick={() => {
              setEditContent(note.content); setEditType(note.note_type)
              setEditPublic(note.is_public); setEditing(false)
            }}>Cancel</button>
            <button className="btn btn-primary btn-sm"
              disabled={!editContent || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}>
              Save
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.noteCard}>
      <div className={styles.noteCardHeader}>
        <span className={styles.noteType}>{note.note_type}</span>
        {note.is_public && <span className="badge badge-published"><Globe size={9} /> public</span>}
        <div className={styles.noteCardActions}>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(true)} title="Edit">
            <Edit2 size={12} />
          </button>
          <button className="btn btn-ghost btn-sm btn-icon"
            onClick={() => { if (confirm('Delete this note?')) deleteMutation.mutate() }}
            title="Delete">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      <p className={styles.noteContent}>{note.content}</p>
      <span className={styles.noteMeta}>
        {note.created_by} · {new Date(note.updated_at).toLocaleDateString()}
        {note.updated_at !== note.created_at && ' (edited)'}
      </span>
    </div>
  )
}

function NotesTab({ node }: { node: NodeDetail }) {
  const queryClient = useQueryClient()
  const [content, setContent] = useState('')
  const [noteType, setNoteType] = useState('general')
  const [isPublic, setIsPublic] = useState(false)
  const [adding, setAdding] = useState(false)

  const addMutation = useMutation({
    mutationFn: () => nodesApi.addNote(node.id, { content, note_type: noteType, is_public: isPublic }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node', node.id] })
      setContent(''); setAdding(false)
    },
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['node', node.id] })

  return (
    <div className={styles.notesTab}>
      <div className={styles.notesHeader}>
        <button className="btn btn-secondary btn-sm" onClick={() => setAdding(!adding)}>
          <Plus size={13} /> Add note
        </button>
      </div>
      {adding && (
        <div className={styles.noteForm}>
          <div className="form-group">
            <label>Type</label>
            <select value={noteType} onChange={e => setNoteType(e.target.value)}>
              {NOTE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Content</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={4} autoFocus />
          </div>
          <label className={styles.checkboxLabel}>
            <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
            Visible on public portal
          </label>
          <div className={styles.noteFormActions}>
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={() => addMutation.mutate()} disabled={!content}>
              Save note
            </button>
          </div>
        </div>
      )}
      {node.notes.length === 0 && !adding && (
        <p className="text-faint" style={{ fontSize: 'var(--text-sm)' }}>No notes yet.</p>
      )}
      {node.notes.map(note => (
        <NoteCard key={note.id} node={node} note={note} onDeleted={invalidate} />
      ))}
    </div>
  )
}

// ─── Attachments tab ──────────────────────────────────────────────────

function AttachmentsTab({ node }: { node: NodeDetail }) {
  const queryClient = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: number) => nodesApi.deleteAttachment(node.id, attachmentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['node', node.id] }),
  })

  const reextractMutation = useMutation({
    mutationFn: (attachmentId: number) => nodesApi.reextractMetadata(node.id, attachmentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['node', node.id] }),
  })

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError('')
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      await nodesApi.uploadAttachment(node.id, formData)
      queryClient.invalidateQueries({ queryKey: ['node', node.id] })
    } catch (err: any) {
      setUploadError(err.response?.data?.message ?? 'Upload failed.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const fmtSize = (bytes: number) => bytes < 1048576
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`

  return (
    <div className={styles.attachmentsTab}>
      <div className={styles.uploadRow}>
        <label className={`btn btn-secondary btn-sm ${uploading ? styles.uploadBtnLoading : ''}`}>
          <Paperclip size={13} /> {uploading ? 'Uploading…' : 'Upload file'}
          <input type="file" onChange={handleUpload} style={{ display: 'none' }} disabled={uploading} />
        </label>
        {uploadError && <span className={styles.uploadError}>{uploadError}</span>}
      </div>

      {node.attachments.length === 0 && (
        <p className="text-faint" style={{ fontSize: 'var(--text-sm)' }}>No attachments yet.</p>
      )}

      {node.attachments.map((att: any) => {
        const downloadUrl = nodesApi.getDownloadUrl(node.id, att.id)
        const thumbUrl = nodesApi.getThumbnailUrl(node.id, att.id)
        const mime = att.mime_type ?? ''
        const isImage = mime.startsWith('image/')
        const isPdf = mime === 'application/pdf'
        const hasThumb = att.has_thumbnail
        const isExpanded = expandedId === att.id

        return (
          <div key={att.id} className={styles.attachmentCard}>
            {/* Thumbnail strip */}
            {hasThumb && (
              <div className={styles.attachmentThumb}>
                <img src={thumbUrl} alt="" className={styles.attachmentThumbImg}
                  onClick={() => window.open(downloadUrl, '_blank')} />
              </div>
            )}

            {/* Main row */}
            <div className={styles.attachmentRow}>
              <FileText size={14} className={styles.attachmentIcon} />
              <div className={styles.attachmentInfo}>
                <span className={styles.attachmentName}>{att.original_filename}</span>
                <div className={styles.attachmentMeta}>
                  <span>{fmtSize(att.file_size)}</span>
                  {att.mime_type && <span>{att.mime_type}</span>}
                  {att.pronom_id && (
                    <a href={`https://www.nationalarchives.gov.uk/pronom/${att.pronom_id}`}
                      target="_blank" rel="noreferrer"
                      style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                      {att.pronom_id}
                    </a>
                  )}
                  {att.image_width && att.image_height && (
                    <span>{att.image_width} × {att.image_height}px
                      {att.image_dpi_x ? ` · ${Math.round(att.image_dpi_x)} DPI` : ''}
                    </span>
                  )}
                  {att.checksum_sha256 && (
                    <span title={`SHA-256: ${att.checksum_sha256}`}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 10, cursor: 'help' }}>
                      ✓ {att.checksum_sha256.slice(0, 8)}…
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-1)', flexShrink: 0, alignItems: 'center' }}>
                <OcrButton
                  nodeId={node.id}
                  attachmentId={att.id}
                  mimeType={att.mime_type}
                  filename={att.original_filename}
                  hasText={att.extracted_text === true}
                />
                <button className="btn btn-ghost btn-sm btn-icon"
                  onClick={() => setExpandedId(isExpanded ? null : att.id)}
                  title="Technical metadata">
                  <AlertCircle size={12} />
                </button>
                <a href={downloadUrl} target="_blank" rel="noreferrer"
                  className="btn btn-ghost btn-sm btn-icon" title="View / download">
                  <Download size={12} />
                </a>
                {att.extracted_text === true && (
                  <a
                    href={nodesApi.getTextUrl(node.id, att.id)}
                    download={att.original_filename.replace(/\.[^.]+$/, '') + '_text.txt'}
                    className="btn btn-ghost btn-sm btn-icon"
                    title="Download extracted text"
                  >
                    <FileText size={12} />
                  </a>
                )}
                <button className="btn btn-ghost btn-sm btn-icon"
                  onClick={() => deleteMutation.mutate(att.id)} title="Delete">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            {/* Expanded technical metadata panel */}
            {isExpanded && (
              <div className={styles.attachmentTechPanel}>
                <div className={styles.attachmentTechGrid}>
                  {att.checksum_md5 && <><dt>MD5</dt><dd style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{att.checksum_md5}</dd></>}
                  {att.checksum_sha256 && <><dt>SHA-256</dt><dd style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', wordBreak: 'break-all' }}>{att.checksum_sha256}</dd></>}
                  {att.pronom_id && <><dt>PRONOM</dt><dd><a href={`https://www.nationalarchives.gov.uk/pronom/${att.pronom_id}`} target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent)' }}>{att.pronom_id}</a></dd></>}
                  {att.image_width && <><dt>Dimensions</dt><dd>{att.image_width} × {att.image_height} px</dd></>}
                  {att.image_dpi_x && <><dt>Resolution</dt><dd>{Math.round(att.image_dpi_x)} × {Math.round(att.image_dpi_y ?? att.image_dpi_x)} DPI</dd></>}
                  {att.image_mode && <><dt>Colour mode</dt><dd>{att.image_mode}</dd></>}
                  {att.image_bit_depth && <><dt>Bit depth</dt><dd>{att.image_bit_depth}-bit</dd></>}
                  {att.duration_seconds && <><dt>Duration</dt><dd>{new Date(att.duration_seconds * 1000).toISOString().slice(11, 19)}</dd></>}
                  {att.av_codec && <><dt>Codec</dt><dd>{att.av_codec}</dd></>}
                  {att.av_bitrate && <><dt>Bitrate</dt><dd>{Math.round(att.av_bitrate / 1000)} kbps</dd></>}
                  {att.tech_extracted_at && <><dt>Extracted</dt><dd>{new Date(att.tech_extracted_at).toLocaleString()}</dd></>}
                </div>
                {att.exif_data && Object.keys(att.exif_data).length > 0 && (
                  <details className={styles.exifDetails}>
                    <summary>EXIF / IPTC ({Object.keys(att.exif_data).length} fields)</summary>
                    <div className={styles.attachmentTechGrid} style={{ marginTop: 'var(--space-2)' }}>
                      {Object.entries(att.exif_data).map(([k, v]) => (
                        <><dt key={`k-${k}`}>{k}</dt><dd key={`v-${k}`}>{String(v)}</dd></>
                      ))}
                    </div>
                  </details>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
                  <button className="btn btn-ghost btn-sm"
                    disabled={reextractMutation.isPending}
                    onClick={() => reextractMutation.mutate(att.id)}>
                    {reextractMutation.isPending ? <Spinner size={12} /> : <MoveRight size={12} />}
                    Re-extract metadata
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── History tab ──────────────────────────────────────────────────────

function HistoryTab({ nodeId }: { nodeId: number }) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['node-history', nodeId],
    queryFn: () => nodesApi.getHistory(nodeId).then(r => r.data.data as any[]),
  })

  const revertMutation = useMutation({
    mutationFn: (changeId: number) => nodesApi.revert(nodeId, changeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node', nodeId] })
      queryClient.invalidateQueries({ queryKey: ['node-history', nodeId] })
    },
  })

  if (isLoading) return <div className={styles.detailLoading}>Loading history…</div>

  return (
    <div className={styles.historyTab}>
      {(!data || data.length === 0) && (
        <p className="text-faint" style={{ fontSize: 'var(--text-sm)' }}>No history yet.</p>
      )}
      {data?.map((change: any, i: number) => (
        <div key={change.id} className={styles.historyEntry}>
          <div className={styles.historyEntryHeader}>
            <span className={styles.historyType}>{change.change_type}</span>
            <span className={styles.historyMeta}>
              {change.created_by} · {new Date(change.created_at).toLocaleString()}
            </span>
            {i > 0 && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { if (confirm('Revert to this version?')) revertMutation.mutate(change.id) }}
              >
                <RotateCcw size={12} /> Revert
              </button>
            )}
          </div>
          <p className={styles.historyDescription}>{change.description}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────

type ViewMode = 'detail' | 'create' | 'edit' | 'add-child'

export default function ResourcesPage() {
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const initialNodeId = searchParams.get('node')
    ? parseInt(searchParams.get('node')!)
    : location.state?.selectNodeId ?? null

  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  const queryClient = useQueryClient()

  const bulkDeleteMutation = useMutation({
    mutationFn: (force: boolean) => nodesApi.bulkDelete([...selectedIds], force),
    onSuccess: (res) => {
      const errors: any[] = (res.data as any)?.data?.errors ?? []
      queryClient.invalidateQueries({ queryKey: ['node-tree'] })
      queryClient.invalidateQueries({ queryKey: ['node-children'] })
      setSelectedIds(new Set())
      setBulkDeleteOpen(false)
      if (errors.length > 0) alert('Some nodes were not deleted:\n' + errors.map((e: any) => e.error).join('\n'))
    },
  })

  const toggleSelectMode = () => {
    setSelectMode(v => !v)
    setSelectedIds(new Set())
  }

  const handleToggleSelect = (node: NodeStub) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(node.id)) next.delete(node.id)
      else next.add(node.id)
      return next
    })
  }

  const [selectedNode, setSelectedNode] = useState<NodeStub | null>(
    initialNodeId
      ? { id: initialNodeId, title: '', ref_code: '', local_ref: '',
          level_of_description: '', status: 'draft' as unknown as NodeStatus,
          date_start: null, date_end: null, has_children: false, parent_id: null }
      : null
  )
  const [viewMode, setViewMode] = useState<ViewMode>('detail')
  const [editingNode, setEditingNode] = useState<NodeDetail | null>(null)
  const [addChildParentId, setAddChildParentId] = useState<number | null>(null)

  // When navigating here from search (even if already on this page),
  // location.state changes but useState initializer doesn't re-run.
  // This effect picks up the new selectNodeId.
  useEffect(() => {
    const id = location.state?.selectNodeId ?? (searchParams.get('node') ? parseInt(searchParams.get('node')!) : null)
    if (id) {
      setSelectedNode({ id, title: '', ref_code: '', local_ref: '',
        level_of_description: '', status: 'draft' as unknown as NodeStatus,
        date_start: null, date_end: null, has_children: false, parent_id: null })
      setViewMode('detail')
    }
  }, [location.state?.selectNodeId, searchParams.get('node')])

  const handleSelect = (node: NodeStub) => {
    setSelectedNode(node)
    setViewMode('detail')
    setEditingNode(null)
  }

  const handleEdit = (node: NodeDetail) => {
    setEditingNode(node)
    setViewMode('edit')
  }

  const handleAddChild = (parentId: number) => {
    setAddChildParentId(parentId)
    setViewMode('add-child')
  }

  const handleSaved = (nodeId: number) => {
    setSelectedNode(prev => prev ? { ...prev, id: nodeId } : null)
    setViewMode('detail')
    setEditingNode(null)
    setAddChildParentId(null)
  }

  const handleCancel = () => {
    setViewMode('detail')
    setEditingNode(null)
    setAddChildParentId(null)
  }

  const showForm = viewMode === 'create' || viewMode === 'edit' || viewMode === 'add-child'

  const [showImport, setShowImport] = useState(false)
  const [treeSearch, setTreeSearch] = useState('')
  const [hierarchyTypeFilter, setHierarchyTypeFilter] = useState('')
  const [showRapidEntry, setShowRapidEntry] = useState(false)
  const { data: hierarchyTypesForFilter } = useQuery({
    queryKey: ['hierarchy-types', 'resource'],
    queryFn: () => hierarchyApi.listTypes('resource').then(r => r.data.data as any[]),
  })

  const treePanel = (
    <div className={styles.treePanel}>
      <div className={styles.treePanelHeader}>
        <h2 className={styles.treePanelTitle}>Resources</h2>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowImport(true)}
            title="Import EAD"
          >
            <Upload size={14} />
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowRapidEntry(true)}
            title={selectedNode ? `Rapid entry under ${selectedNode.ref_code}` : 'Select a node first to use rapid entry'}
            disabled={!selectedNode}
          >
            <Zap size={14} />
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setSelectedNode(null); setEditingNode(null); setViewMode('create') }}
          >
            <Plus size={14} /> New
          </button>
        </div>
      </div>
      <div className={styles.treeFilterBar}>
        <div className={styles.treeSearchWrap}>
          <Search size={13} className={styles.treeSearchIcon} />
          <input
            className={styles.treeSearchInput}
            value={treeSearch}
            onChange={e => setTreeSearch(e.target.value)}
            placeholder="Filter resources…"
          />
          {treeSearch && (
            <button className={styles.treeSearchClear} onClick={() => setTreeSearch('')}>
              <X size={12} />
            </button>
          )}
        </div>
        {(hierarchyTypesForFilter?.length ?? 0) > 1 && (
          <select
            className={styles.treeHierarchySelect}
            value={hierarchyTypeFilter}
            onChange={e => setHierarchyTypeFilter(e.target.value)}
          >
            <option value="">All</option>
            {hierarchyTypesForFilter?.map((ht: any) => (
              <option key={ht.id} value={ht.id}>{ht.name}</option>
            ))}
          </select>
        )}
        <button
          className="btn btn-ghost btn-sm btn-icon"
          onClick={toggleSelectMode}
          title={selectMode ? 'Exit select mode' : 'Select items for bulk printing'}
          style={{ color: selectMode ? 'var(--color-accent)' : undefined, flexShrink: 0 }}
        >
          {selectMode ? <CheckSquare size={14} /> : <Square size={14} />}
        </button>
      </div>

      {selectMode && selectedIds.size > 0 && (
        <div className={styles.bulkActionsBar}>
          <span className={styles.bulkCount}>{selectedIds.size} selected</span>
          <div className={styles.bulkActions}>
            <PrintLabelsButton nodeIds={[...selectedIds]} label="" />
            <button className="btn btn-ghost btn-sm btn-icon" title="Move selected" onClick={() => setBulkMoveOpen(true)}>
              <MoveRight size={13} />
            </button>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              title="Delete selected"
              style={{ color: 'var(--color-error)' }}
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 size={13} />
            </button>
            <button className="btn btn-ghost btn-sm btn-icon" title="Clear selection" onClick={() => setSelectedIds(new Set())}>
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      <div className={styles.treeScroll}>
        <NodeTree
          selectedId={selectedNode?.id ?? null}
          onSelect={handleSelect}
          onAddChild={handleAddChild}
          searchQuery={treeSearch}
          hierarchyTypeId={hierarchyTypeFilter ? parseInt(hierarchyTypeFilter) : undefined}
          selectedIds={selectMode ? selectedIds : undefined}
          onToggleSelect={selectMode ? handleToggleSelect : undefined}
        />
      </div>
    </div>
  )

  const contentPanel = showForm ? (
    <NodeForm
      node={viewMode === 'edit' ? (editingNode ?? undefined) : undefined}
      parentId={viewMode === 'add-child' ? addChildParentId : null}
      onSaved={(nodeId) => {
        setSelectedNode(s => s ? { ...s, id: nodeId } : null)
        handleSaved(nodeId)
      }}
      onCancel={handleCancel}
    />
  ) : selectedNode && viewMode === 'detail' ? (
    <NodeDetailPanel
      key={selectedNode.id}
      nodeId={selectedNode.id}
      onEdit={handleEdit}
      onSelectChild={handleSelect}
    />
  ) : (
    <div className={styles.emptyState}>
      <div className={styles.emptyStateInner}>
        <FileText size={32} className={styles.emptyIcon} />
        <p>Select a resource to view its description</p>
        <p className="text-faint">or create a new one</p>
      </div>
    </div>
  )

  return (
    <>
      <ResizablePanels
        left={treePanel}
        right={contentPanel}
        defaultLeftWidth={300}
        minLeftWidth={200}
        maxLeftWidth={520}
      />
      {showRapidEntry && (
        <RapidEntryModal
          parentId={selectedNode?.id ?? null}
          onClose={() => setShowRapidEntry(false)}
          onCreated={() => { setShowRapidEntry(false) }}
        />
      )}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => setShowImport(false)}
        />
      )}
      {bulkDeleteOpen && (
        <BulkDeleteDialog
          count={selectedIds.size}
          onConfirm={(force) => bulkDeleteMutation.mutate(force)}
          onClose={() => setBulkDeleteOpen(false)}
          isPending={bulkDeleteMutation.isPending}
        />
      )}
      {bulkMoveOpen && (
        <MoveNodeDialog
          nodeIds={[...selectedIds]}
          onClose={() => setBulkMoveOpen(false)}
          onMoved={() => {
            setBulkMoveOpen(false)
            setSelectedIds(new Set())
            queryClient.invalidateQueries({ queryKey: ['node-tree'] })
            queryClient.invalidateQueries({ queryKey: ['node-children'] })
          }}
        />
      )}
    </>
  )
}