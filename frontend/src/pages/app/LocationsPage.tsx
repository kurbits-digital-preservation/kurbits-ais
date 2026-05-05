import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { nodesApi } from '@/api'
import {
  Plus, MapPin, Package, ArrowDownToLine, ArrowUpFromLine, ExternalLink, ArrowRightLeft, FileText,
  ArrowLeftRight, Pencil, Trash2, X, Save, Clock,
  BarChart3, ChevronRight
} from 'lucide-react'
import { locationsApi } from '@/api'
import LocationTree from '@/components/tree/LocationTree'
import { PageShell, SidebarPanel, EmptyState, Tabs, FieldList, Spinner, PrintLabelsButton } from '@/components/ui'
import HierarchyLevelSelect from '@/components/ui/HierarchyLevelSelect'
import type { LocationDetail, LocationStub } from '@/types'
import styles from './LocationsPage.module.css'

// ─── Location form ────────────────────────────────────────────────────

interface LocationFormData {
  name: string
  code: string
  level_name: string
  hierarchy_type_id: string
  description: string
  can_store_nodes: boolean
  capacity: string
  parent_id: number | null
}

const EMPTY_FORM: LocationFormData = {
  name: '', code: '', level_name: '', hierarchy_type_id: '',
  description: '', can_store_nodes: false, capacity: '', parent_id: null,
}

function LocationForm({
  initial,
  parentLocation,
  onSave,
  onCancel,
  isSaving,
}: {
  initial?: Partial<LocationFormData>
  parentLocation?: LocationDetail | null
  onSave: (data: LocationFormData) => void
  onCancel: () => void
  isSaving: boolean
}) {
  const [form, setForm] = useState<LocationFormData>({ ...EMPTY_FORM, ...initial })
  const set = (field: keyof LocationFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))

  return (
    <div className={styles.form}>
      {parentLocation && (
        <div className={styles.parentNote}>
          <ChevronRight size={13} />
          <span>Child of <strong>{parentLocation.full_path}</strong></span>
        </div>
      )}

      <div className={styles.formGrid}>
        <div className="form-group">
          <label>Name *</label>
          <input value={form.name} onChange={set('name')} placeholder="e.g. Reading Room A" required />
        </div>

        <div className="form-group">
          <label>Code *</label>
          <input value={form.code} onChange={set('code')} placeholder="e.g. RRA" />
          <span className="form-hint">Unique identifier within parent</span>
        </div>

        <HierarchyLevelSelect
          entityType="location"
          hierarchyTypeId={form.hierarchy_type_id}
          levelName={form.level_name}
          onHierarchyTypeChange={v => setForm(f => ({ ...f, hierarchy_type_id: v }))}
          onLevelChange={v => setForm(f => ({ ...f, level_name: v }))}
        />

        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>Description</label>
          <textarea value={form.description} onChange={set('description')} rows={2} />
        </div>

        <div className={styles.checkboxRow}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={form.can_store_nodes}
              onChange={e => setForm(f => ({ ...f, can_store_nodes: e.target.checked }))}
            />
            Can store archival materials
          </label>
        </div>

        {form.can_store_nodes && (
          <div className="form-group">
            <label>Capacity (items)</label>
            <input
              value={form.capacity}
              onChange={set('capacity')}
              type="number"
              min="1"
              placeholder="Leave empty for unlimited"
            />
          </div>
        )}
      </div>

      <div className={styles.formActions}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={isSaving}>
          <X size={14} /> Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={() => onSave(form)}
          disabled={!form.name || !form.code || !form.level_name || !form.hierarchy_type_id || isSaving}
        >
          {isSaving ? <Spinner size={14} /> : <Save size={14} />}
          {isSaving ? 'Saving…' : 'Save location'}
        </button>
      </div>
    </div>
  )
}

// ─── Overview tab ─────────────────────────────────────────────────────

function OverviewTab({ location }: { location: LocationDetail }) {
  const capacityPct = location.capacity && location.stored_count != null
    ? Math.min((location.stored_count / location.capacity) * 100, 100)
    : null

  return (
    <div className={styles.tabContent}>
      {location.can_store_nodes && (
        <div className={styles.capacityCard}>
          <div className={styles.capacityCardHeader}>
            <span className={styles.capacityLabel}>Storage capacity</span>
            <span className={styles.capacityNumbers}>
              <strong>{location.stored_count}</strong>
              {location.capacity !== null && <span> / {location.capacity}</span>}
              <span className={styles.capacityUnit}> items</span>
            </span>
          </div>
          {capacityPct !== null && (
            <div className={styles.capacityTrack}>
              <div
                className={styles.capacityFill}
                style={{
                  width: `${capacityPct}%`,
                  background: capacityPct > 90
                    ? 'var(--color-error)'
                    : capacityPct > 70
                    ? 'var(--color-warning)'
                    : 'var(--color-success)',
                }}
              />
            </div>
          )}
          {location.available_capacity !== null && (
            <p className={styles.capacityAvail}>
              {location.available_capacity} spaces available
            </p>
          )}
        </div>
      )}

      <FieldList fields={[
        { label: 'Full path',    value: location.full_path },
        { label: 'Level',        value: location.level_name },
        { label: 'Code',         value: location.code },
        { label: 'Description',  value: location.description },
        { label: 'Created',      value: new Date(location.created_at).toLocaleDateString() },
      ]} />
    </div>
  )
}


// ─── Move to modal ────────────────────────────────────────────────────

function MoveToModal({
  location,
  node,
  onClose,
}: {
  location: LocationDetail
  node: { id: number; title: string; ref_code: string }
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [targetId, setTargetId] = useState('')
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')

  const { data: searchResults } = useQuery({
    queryKey: ['locations-search-move', search],
    queryFn: () => locationsApi.search(search, true).then(r => r.data.data as any[]),
    enabled: search.length > 1,
  })

  const moveMutation = useMutation({
    mutationFn: () => locationsApi.move(location.id, node.id, parseInt(targetId), notes || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['location-nodes', location.id] })
      queryClient.invalidateQueries({ queryKey: ['location-nodes', parseInt(targetId)] })
      queryClient.invalidateQueries({ queryKey: ['location-movements', location.id] })
      queryClient.invalidateQueries({ queryKey: ['location-tree'] })
      queryClient.invalidateQueries({ queryKey: ['location-overview'] })
      queryClient.invalidateQueries({ queryKey: ['node', node.id] })
      onClose()
    },
  })

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            <ArrowRightLeft size={16} /> Move to another location
          </h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className={styles.modalBody}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-muted)', marginBottom: 'var(--space-3)' }}>
            Moving <strong>{node.ref_code}</strong> — {node.title}
          </p>
          <div className="form-group">
            <label>Search target location</label>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Type to search storable locations…"
              autoFocus
            />
          </div>
          {searchResults && search.length > 1 && (
            <div className={styles.searchResults}>
              {searchResults.map((loc: any) => (
                <button
                  key={loc.id}
                  className={`${styles.searchResult} ${targetId === String(loc.id) ? styles.searchResultSelected : ''}`}
                  onClick={() => setTargetId(String(loc.id))}
                >
                  <div className={styles.searchResultInfo}>
                    <span className={styles.searchResultTitle}>{loc.name}</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)' }}>
                      {loc.full_path}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="form-group" style={{ marginTop: 'var(--space-3)' }}>
            <label>Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Reason for move, condition, etc." />
          </div>
        </div>
        <div className={styles.modalFooter}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary"
            disabled={!targetId || moveMutation.isPending}
            onClick={() => moveMutation.mutate()}>
            {moveMutation.isPending ? <Spinner size={14} /> : <ArrowRightLeft size={14} />}
            Move
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Stored items tab ─────────────────────────────────────────────────

function StoredItemsTab({
  location,
  onCheckOut,
  onMove,
}: {
  location: LocationDetail
  onCheckOut: (nodeId: number) => void
  onMove: (node: {id:number;title:string;ref_code:string}) => void
}) {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['location-nodes', location.id],
    queryFn: () => locationsApi.getStoredNodes(location.id).then(r => r.data.data as any[]),
    enabled: location.can_store_nodes,
  })

  if (!location.can_store_nodes) return (
    <div className={styles.tabContent}>
      <p className={styles.infoNote}>This location cannot directly store archival materials.</p>
    </div>
  )

  if (isLoading) return <div className={styles.tabContent}><Spinner /></div>

  const isCheckedOutVirtual = (location as any).code === '__checked_out__'

  return (
    <div className={styles.tabContent}>
      {(!data || data.length === 0) ? (
        <p className={styles.emptyText}>No items stored here.</p>
      ) : (
        data.map((node: any) => (
          <div key={node.id} className={styles.storedItem}>
            <div className={styles.storedItemInfo}>
              <span className={styles.storedItemTitle}>{node.title}</span>
              <span className="ref-code">{node.ref_code}</span>
            </div>
            <div className={styles.storedItemActions}>
              <button
                className="btn btn-ghost btn-sm btn-icon"
                onClick={() => navigate(`/app/resources?node=${node.id}`)}
                title="Open resource"
              >
                <ExternalLink size={13} />
              </button>
              <PrintLabelsButton nodeIds={[node.id]} label="Label" />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => onMove({ id: node.id, title: node.title, ref_code: node.ref_code })}
                title="Move to another location"
              >
                <ArrowRightLeft size={13} /> Move
              </button>
              {!isCheckedOutVirtual && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onCheckOut(node.id)}
                  title="Check out"
                >
                  <ArrowUpFromLine size={13} /> Check out
                </button>
              )}
              {isCheckedOutVirtual && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-warning)',
                  fontWeight: 600, padding: '2px 8px',
                  background: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)' }}>
                  Checked out
                </span>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// ─── Movement history tab ─────────────────────────────────────────────

const MOVEMENT_ICONS = {
  check_in:  ArrowDownToLine,
  check_out: ArrowUpFromLine, ExternalLink, ArrowRightLeft,
  transfer:  ArrowLeftRight,
}

const MOVEMENT_COLOURS = {
  check_in:  'var(--color-success)',
  check_out: 'var(--color-warning)',
  transfer:  'var(--color-accent)',
}

function MovementsTab({ locationId }: { locationId: number }) {
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['location-movements', locationId, page],
    queryFn: () => locationsApi.getMovements(locationId, page).then(r => r.data as any),
  })

  if (isLoading) return <div className={styles.tabContent}><Spinner /></div>

  const movements: any[] = data?.data ?? []
  const meta = data?.meta

  return (
    <div className={styles.tabContent}>
      {movements.length === 0 ? (
        <p className={styles.emptyText}>No movement history yet.</p>
      ) : (
        <>
          {movements.map((m: any) => {
            const Icon = MOVEMENT_ICONS[m.movement_type as keyof typeof MOVEMENT_ICONS] ?? Clock
            const colour = MOVEMENT_COLOURS[m.movement_type as keyof typeof MOVEMENT_COLOURS] ?? 'var(--color-ink-muted)'
            return (
              <div key={m.id} className={styles.movementRow}>
                <div className={styles.movementIcon} style={{ color: colour }}>
                  <Icon size={14} />
                </div>
                <div className={styles.movementInfo}>
                  <div className={styles.movementHeader}>
                    <span className={styles.movementType}>{m.movement_type.replace('_', ' ')}</span>
                    <span className={styles.movementNode}>{m.node_title ?? `Node #${m.node_id}`}</span>
                    <span className="ref-code">{m.node_ref_code}</span>
                  </div>
                  {m.notes && <p className={styles.movementNotes}>{m.notes}</p>}
                  <span className={styles.movementMeta}>
                    {m.moved_by} · {new Date(m.moved_at).toLocaleString()}
                  </span>
                </div>
              </div>
            )
          })}
          {meta && meta.pages > 1 && (
            <div className={styles.pagination}>
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                ← Previous
              </button>
              <span className={styles.pageInfo}>Page {page} of {meta.pages}</span>
              <button className="btn btn-ghost btn-sm" disabled={page >= meta.pages} onClick={() => setPage(p => p + 1)}>
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Check-in modal ───────────────────────────────────────────────────

function CheckInModal({
  location,
  onClose,
}: {
  location: LocationDetail
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [nodeId, setNodeId] = useState('')
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')

  const { data: searchResults } = useQuery({
    queryKey: ['nodes-search-checkin', search],
    queryFn: () => nodesApi.list({ q: search, per_page: 6 }).then(r => r.data.data as any[]),
    enabled: search.length > 1,
  })

  const checkInMutation = useMutation({
    mutationFn: () => locationsApi.checkIn(location.id, parseInt(nodeId), notes || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['location-nodes', location.id] })
      queryClient.invalidateQueries({ queryKey: ['location-movements', location.id] })
      queryClient.invalidateQueries({ queryKey: ['location-tree'] })
      queryClient.invalidateQueries({ queryKey: ['location', location.id] })
      queryClient.invalidateQueries({ queryKey: ['location-overview'] })
      queryClient.invalidateQueries({ queryKey: ['node'] })
      onClose()
    },
  })

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            <ArrowDownToLine size={16} /> Check in to {location.name}
          </h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className={styles.modalBody}>
          {location.available_capacity === 0 && (
            <div className={styles.warningBanner}>
              This location is at full capacity ({location.capacity} items).
            </div>
          )}

          <div className="form-group">
            <label>Search for resource</label>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Type to search…"
              autoFocus
            />
          </div>

          {searchResults && search.length > 1 && (
            <div className={styles.searchResults}>
              {searchResults.map((node: any) => (
                <button
                  key={node.id}
                  className={`${styles.searchResult} ${nodeId === String(node.id) ? styles.searchResultSelected : ''}`}
                  onClick={() => setNodeId(String(node.id))}
                >
                  <div className={styles.searchResultInfo}>
                    <span className={styles.searchResultTitle}>{node.title}</span>
                    <span className="ref-code">{node.ref_code}</span>
                  </div>
                  <span className={`badge badge-${node.status}`}>{node.status}</span>
                </button>
              ))}
            </div>
          )}

          <div className="form-group">
            <label>Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!nodeId || checkInMutation.isPending || location.available_capacity === 0}
            onClick={() => checkInMutation.mutate()}
          >
            {checkInMutation.isPending ? <Spinner size={14} /> : <ArrowDownToLine size={14} />}
            Check in
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Transfer modal ───────────────────────────────────────────────────

function TransferModal({
  location,
  nodeId,
  onClose,
}: {
  location: LocationDetail
  nodeId: number
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [targetId, setTargetId] = useState('')
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')

  const { data: searchResults } = useQuery({
    queryKey: ['locations-search-transfer', search],
    queryFn: () => locationsApi.getTree().then(r =>
      r.data.data.filter((l: LocationStub) => l.can_store_nodes && l.id !== location.id)
    ),
    enabled: true,
  })

  const transferMutation = useMutation({
    mutationFn: () => locationsApi.transfer(location.id, nodeId, parseInt(targetId), notes || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['location-nodes'] })
      queryClient.invalidateQueries({ queryKey: ['location-movements'] })
      queryClient.invalidateQueries({ queryKey: ['location-tree'] })
      onClose()
    },
  })

  const filtered = searchResults?.filter((l: LocationStub) =>
    !search || l.name.toLowerCase().includes(search.toLowerCase())
  ) ?? []

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            <ArrowLeftRight size={16} /> Transfer item
          </h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><X size={14} /></button>
        </div>

        <div className={styles.modalBody}>
          <div className="form-group">
            <label>Filter target locations</label>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" autoFocus />
          </div>

          <div className={styles.searchResults}>
            {filtered.map((loc: LocationStub) => (
              <button
                key={loc.id}
                className={`${styles.searchResult} ${targetId === String(loc.id) ? styles.searchResultSelected : ''}`}
                onClick={() => setTargetId(String(loc.id))}
              >
                <span className={styles.searchResultTitle}>{loc.name}</span>
                <span className={styles.searchResultMeta}>
                  {loc.stored_count}{loc.capacity !== null ? `/${loc.capacity}` : ''} items
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className={styles.emptyText} style={{ padding: 'var(--space-3)' }}>
                No storage locations found
              </p>
            )}
          </div>

          <div className="form-group">
            <label>Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!targetId || transferMutation.isPending}
            onClick={() => transferMutation.mutate()}
          >
            {transferMutation.isPending ? <Spinner size={14} /> : <ArrowLeftRight size={14} />}
            Transfer
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Detail panel ─────────────────────────────────────────────────────

function LocationDetailPanel({

  locationId,
  onEdit,
  onAddChild,
  onDelete,
}: {
  locationId: number
  onEdit: (loc: LocationDetail) => void
  onAddChild: (parentId: number) => void
  onDelete: () => void
}) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('overview')
  const [showCheckIn, setShowCheckIn] = useState(false)
  const [movingNode, setMovingNode] = useState<{id:number;title:string;ref_code:string}|null>(null)
  const [transferNodeId, setTransferNodeId] = useState<number | null>(null)

  const { data: location, isLoading } = useQuery({
    queryKey: ['location', locationId],
    queryFn: () => locationsApi.get(locationId).then(r => r.data.data),
  })

  const deleteMutation = useMutation({
    mutationFn: () => locationsApi.delete(locationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['location-tree'] })
      onDelete()
    },
  })

  const checkOutMutation = useMutation({
    mutationFn: (nodeId: number) => locationsApi.checkOut(locationId, nodeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['location-nodes', locationId] })
      queryClient.invalidateQueries({ queryKey: ['location-movements', locationId] })
      queryClient.invalidateQueries({ queryKey: ['location-tree'] })
      queryClient.invalidateQueries({ queryKey: ['location', locationId] })
      queryClient.invalidateQueries({ queryKey: ['location-overview'] })
      queryClient.invalidateQueries({ queryKey: ['node'] })
    },
  })

  if (isLoading) return <div className={styles.loadingState}><Spinner /><span>Loading…</span></div>
  if (!location) return null

  const tabs = [
    { key: 'overview',  icon: <BarChart3 size={13} />,      label: 'Overview' },
    { key: 'items',     icon: <Package size={13} />,        label: `Items${location.stored_count ? ` (${location.stored_count})` : ''}` },
    { key: 'movements', icon: <Clock size={13} />,          label: 'History' },
  ]

  return (
    <>
      <div className={styles.detailPanel}>
        <div className={styles.detailHeader}>
          <div className={styles.detailHeaderRow}>
            <div>
              <p className={styles.detailPath}>{location.full_path}</p>
              <h2 className={styles.detailName}>{location.name}</h2>
              <div className={styles.detailMeta}>
                <span className={styles.detailLevel}>{location.level_name}</span>
                <span className={styles.metaSep}>·</span>
                <span className="ref-code">{location.code}</span>
                {location.can_store_nodes && (
                  <>
                    <span className={styles.metaSep}>·</span>
                    <span className={styles.detailCapacity}>
                      {location.stored_count} stored
                      {location.capacity !== null && ` / ${location.capacity} capacity`}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className={styles.detailActions}>
              {location.can_store_nodes && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowCheckIn(true)}
                  disabled={location.available_capacity === 0}
                >
                  <ArrowDownToLine size={13} /> Check in
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={async () => {
                try {
                  const res = await locationsApi.inventory(locationId)
                  const blob = new Blob([res.data as BlobPart], { type: 'application/pdf' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url; a.download = `inventory_${locationId}.pdf`; a.click()
                  setTimeout(() => URL.revokeObjectURL(url), 2000)
                } catch (e) { alert('Failed to generate inventory') }
              }}>
                <FileText size={13} /> Inventory
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => onAddChild(locationId)}>
                <Plus size={13} /> Add child
              </button>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => onEdit(location)}>
                <Pencil size={14} />
              </button>
              <button
                className="btn btn-ghost btn-sm btn-icon"
                onClick={() => { if (confirm(`Delete "${location.name}"?`)) deleteMutation.mutate() }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>

        <Tabs tabs={tabs} active={tab} onChange={setTab} />

        <div className={styles.detailBody}>
          {tab === 'overview'  && <OverviewTab location={location} />}
          {tab === 'items'     && (
            <StoredItemsTab
              location={location}
              onCheckOut={(nodeId) => {
                if (confirm('Check out this item?')) checkOutMutation.mutate(nodeId)
              }}
              onMove={(node) => setMovingNode(node)}
            />
          )}
          {tab === 'movements' && <MovementsTab locationId={locationId} />}
        </div>
      </div>

      {showCheckIn && (
        <CheckInModal location={location} onClose={() => setShowCheckIn(false)} />
      )}
      {movingNode && (
        <MoveToModal location={location} node={movingNode} onClose={() => setMovingNode(null)} />
      )}
      {transferNodeId !== null && (
        <TransferModal
          location={location}
          nodeId={transferNodeId}
          onClose={() => setTransferNodeId(null)}
        />
      )}
    </>
  )
}

// ─── Main page ────────────────────────────────────────────────────────

type ViewMode = 'detail' | 'create' | 'edit'

export default function LocationsPage() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedStub, setSelectedStub] = useState<LocationStub | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('detail')
  const [editingLocation, setEditingLocation] = useState<LocationDetail | null>(null)
  const [addingChildOf, setAddingChildOf] = useState<number | null>(null)

  const { data: parentLocation } = useQuery({
    queryKey: ['location', addingChildOf],
    queryFn: () => locationsApi.get(addingChildOf!).then(r => r.data.data),
    enabled: addingChildOf !== null,
  })

  const createMutation = useMutation({
    mutationFn: (data: LocationFormData) => locationsApi.create({
      ...data,
      hierarchy_type_id: parseInt(data.hierarchy_type_id),
      capacity: data.capacity ? parseInt(data.capacity) : null,
      parent_id: addingChildOf,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['location-tree'] })
      queryClient.invalidateQueries({ queryKey: ['location-children', addingChildOf] })
      setSelectedId(res.data.data.id)
      setViewMode('detail')
      setAddingChildOf(null)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: LocationFormData) => locationsApi.update(editingLocation!.id, {
      ...data,
      capacity: data.capacity ? parseInt(data.capacity) : null,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['location-tree'] })
      queryClient.invalidateQueries({ queryKey: ['location', editingLocation!.id] })
      setSelectedId(res.data.data.id)
      setViewMode('detail')
      setEditingLocation(null)
    },
  })

  const showDetail = selectedId !== null && viewMode === 'detail'
  const showForm   = viewMode === 'create' || viewMode === 'edit'

  const handleAddChild = (parentId: number) => {
    setAddingChildOf(parentId)
    setViewMode('create')
  }

  return (
    <PageShell
      sidebar={
        <SidebarPanel
          title="Locations"
          actions={
            <button
              className="btn btn-primary btn-sm"
              onClick={() => { setAddingChildOf(null); setViewMode('create') }}
            >
              <Plus size={14} /> New
            </button>
          }
        >
          <div className={styles.treeWrap}>
            <LocationTree
              selectedId={selectedId}
              onSelect={(loc) => {
                setSelectedId(loc.id)
                setSelectedStub(loc)
                setViewMode('detail')
              }}
            />
          </div>
        </SidebarPanel>
      }

      content={
        showForm ? (
          <div className={styles.formPanel}>
            <div className={styles.formPanelHeader}>
              <h2 className={styles.formPanelTitle}>
                {viewMode === 'create'
                  ? addingChildOf ? `Add child location` : 'New root location'
                  : `Edit: ${editingLocation?.name}`}
              </h2>
            </div>
            <div className={styles.formPanelBody}>
              <LocationForm
                initial={editingLocation ? {
                  name: editingLocation.name,
                  code: editingLocation.code,
                  level_name: editingLocation.level_name,
                  hierarchy_type_id: String(editingLocation.hierarchy_type_id),
                  description: editingLocation.description ?? '',
                  can_store_nodes: editingLocation.can_store_nodes,
                  capacity: editingLocation.capacity != null ? String(editingLocation.capacity) : '',
                } : undefined}
                parentLocation={addingChildOf ? (parentLocation ?? null) : null}
                onSave={(data) => {
                  if (viewMode === 'create') createMutation.mutate(data)
                  else updateMutation.mutate(data)
                }}
                onCancel={() => {
                  setViewMode('detail')
                  setEditingLocation(null)
                  setAddingChildOf(null)
                }}
                isSaving={createMutation.isPending || updateMutation.isPending}
              />
            </div>
          </div>
        ) : showDetail ? (
          <LocationDetailPanel
            key={selectedId}
            locationId={selectedId}
            onEdit={(loc) => { setEditingLocation(loc); setViewMode('edit') }}
            onAddChild={handleAddChild}
            onDelete={() => { setSelectedId(null); setViewMode('detail') }}
          />
        ) : (
          <EmptyState
            icon={<MapPin size={36} />}
            title="Select a location to view details"
            subtitle="or create a new one"
          />
        )
      }
    />
  )
}