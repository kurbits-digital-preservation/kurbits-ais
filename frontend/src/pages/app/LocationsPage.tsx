import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { nodesApi } from '@/api'
import {
  Plus, MapPin, Package, ArrowDownToLine, ArrowUpFromLine, ExternalLink, ArrowRightLeft, FileText,
  ArrowLeftRight, Pencil, Trash2, X, Save, Clock,
  BarChart3, ChevronRight, ScanLine, CheckCircle2, AlertCircle
} from 'lucide-react'
import { locationsApi } from '@/api'
import LocationTree from '@/components/tree/LocationTree'
import { PageShell, SidebarPanel, EmptyState, Tabs, FieldList, Spinner, PrintLabelsButton } from '@/components/ui'
import HierarchyLevelSelect from '@/components/ui/HierarchyLevelSelect'
import type { LocationDetail, LocationStub } from '@/types'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const [form, setForm] = useState<LocationFormData>({ ...EMPTY_FORM, ...initial })

  const set = (field: keyof LocationFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))

  return (
    <div className={styles.form}>
      {parentLocation && (
        <div className={styles.parentNote}>
          <ChevronRight size={13} />
          <span>{t('locations.form.childOf')} <strong>{parentLocation.full_path}</strong></span>
        </div>
      )}

      <div className={styles.formGrid}>
        <div className="form-group">
          <label>{t('locations.form.name')}</label>
          <input value={form.name} onChange={set('name')} placeholder={t('locations.form.namePlaceholder')} required />
        </div>

        <div className="form-group">
          <label>{t('locations.form.code')}</label>
          <input value={form.code} onChange={set('code')} placeholder={t('locations.form.codePlaceholder')} />
          <span className="form-hint">{t('locations.form.codeHint')}</span>
        </div>

        <HierarchyLevelSelect
          entityType="location"
          hierarchyTypeId={form.hierarchy_type_id}
          levelName={form.level_name}
          onHierarchyTypeChange={v => setForm(f => ({ ...f, hierarchy_type_id: v }))}
          onLevelChange={v => setForm(f => ({ ...f, level_name: v }))}
        />

        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{t('resources.form.fields.description')}</label>
          <textarea value={form.description} onChange={set('description')} rows={2} />
        </div>

        <div className={styles.checkboxRow}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={form.can_store_nodes}
              onChange={e => setForm(f => ({ ...f, can_store_nodes: e.target.checked }))}
            />
            {t('locations.form.canStoreMaterials')}
          </label>
        </div>

        {form.can_store_nodes && (
          <div className="form-group">
            <label>{t('locations.form.capacity')}</label>
            <input
              value={form.capacity}
              onChange={set('capacity')}
              type="number"
              min="1"
              placeholder={t('locations.form.capacityPlaceholder')}
            />
          </div>
        )}
      </div>

      <div className={styles.formActions}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={isSaving}>
          <X size={14} /> {t('common.cancel')}
        </button>
        <button
          className="btn btn-primary"
          onClick={() => onSave(form)}
          disabled={!form.name || !form.code || !form.level_name || !form.hierarchy_type_id || isSaving}
        >
          {isSaving ? <Spinner size={14} /> : <Save size={14} />}
          {isSaving ? t('resources.form.saving') : t('locations.form.saveLocation')}
        </button>
      </div>
    </div>
  )
}

// ─── Overview tab ─────────────────────────────────────────────────────

function OverviewTab({ location }: { location: LocationDetail }) {
  const { t } = useTranslation()
  const capacityPct = location.capacity && location.stored_count != null
    ? Math.min((location.stored_count / location.capacity) * 100, 100)
    : null

  return (
    <div className={styles.tabContent}>
      {location.can_store_nodes && (
        <div className={styles.capacityCard}>
          <div className={styles.capacityCardHeader}>
            <span className={styles.capacityLabel}>{t('locations.overview.storageCapacity')}</span>
            <span className={styles.capacityNumbers}>
              <strong>{location.stored_count}</strong>
              {location.capacity !== null && <span> / {location.capacity}</span>}
              <span className={styles.capacityUnit}> {t('locations.overview.items')}</span>
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
              {t('locations.overview.spacesAvailable', { count: location.available_capacity })}
            </p>
          )}
        </div>
      )}

      <FieldList fields={[
        { label: t('locations.overview.fullPath'), value: location.full_path },
        { label: t('locations.overview.level'),     value: location.level_name },
        { label: t('locations.overview.code'),      value: location.code },
        { label: t('resources.form.fields.description'), value: location.description },
        { label: t('locations.overview.created'),   value: new Date(location.created_at).toLocaleDateString() },
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
  const { t } = useTranslation()
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
            <ArrowRightLeft size={16} /> {t('locations.moveTo.title')}
          </h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className={styles.modalBody}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-muted)', marginBottom: 'var(--space-3)' }}>
            {t('locations.moveTo.moving')} <strong>{node.ref_code}</strong> — {node.title}
          </p>
          <div className="form-group">
            <label>{t('locations.moveTo.searchTarget')}</label>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('locations.moveTo.searchPlaceholder')}
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
            <label>{t('locations.notes')}</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder={t('locations.moveTo.notesReasonPlaceholder')} />
          </div>
        </div>
        <div className={styles.modalFooter}>
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary"
            disabled={!targetId || moveMutation.isPending}
            onClick={() => moveMutation.mutate()}>
            {moveMutation.isPending ? <Spinner size={14} /> : <ArrowRightLeft size={14} />}
            {t('resources.modals.move.moveButton')}
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
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const returnMutation = useMutation({
    mutationFn: (nodeId: number) => locationsApi.returnToPrevious(nodeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['location-nodes'] })
      queryClient.invalidateQueries({ queryKey: ['location-movements'] })
      queryClient.invalidateQueries({ queryKey: ['location-tree'] })
      queryClient.invalidateQueries({ queryKey: ['location'] })
      queryClient.invalidateQueries({ queryKey: ['location-overview'] })
      queryClient.invalidateQueries({ queryKey: ['node'] })
    },
    onError: (err: any) => {
      alert(err?.response?.data?.message ?? t('relations.locations.returnFailed'))
    },
  })
  const { data, isLoading } = useQuery({
    queryKey: ['location-nodes', location.id],
    queryFn: () => locationsApi.getStoredNodes(location.id).then(r => r.data.data as any[]),
    enabled: location.can_store_nodes,
  })

  if (!location.can_store_nodes) return (
    <div className={styles.tabContent}>
      <p className={styles.infoNote}>{t('locations.storedItems.cannotStore')}</p>
    </div>
  )

  if (isLoading) return <div className={styles.tabContent}><Spinner /></div>

  const isCheckedOutVirtual =
    (location as any).is_checkout ?? (location as any).code === '__checked_out__'

  return (
    <div className={styles.tabContent}>
      {(!data || data.length === 0) ? (
        <p className={styles.emptyText}>{t('locations.storedItems.noneStored')}</p>
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
                title={t('search.fileResults.openResource')}
              >
                <ExternalLink size={13} />
              </button>
              <PrintLabelsButton nodeIds={[node.id]} label={t('locations.storedItems.label')} />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => onMove({ id: node.id, title: node.title, ref_code: node.ref_code })}
                title={t('locations.storedItems.moveToAnother')}
              >
                <ArrowRightLeft size={13} /> {t('resources.modals.move.moveButton')}
              </button>
              {!isCheckedOutVirtual && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onCheckOut(node.id)}
                  title={t('relations.locations.checkOut')}
                >
                  <ArrowUpFromLine size={13} /> {t('relations.locations.checkOut')}
                </button>
              )}
              {isCheckedOutVirtual && (
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={returnMutation.isPending}
                  onClick={() => returnMutation.mutate(node.id)}
                  title={t('relations.locations.returnHint')}
                >
                  <ArrowDownToLine size={13} /> {t('relations.locations.returnButton')}
                </button>
              )}
              {isCheckedOutVirtual && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-warning)',
                  fontWeight: 600, padding: '2px 8px',
                  background: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)' }}>
                  {t('relations.locations.checkedOutBadge')}
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
  const { t } = useTranslation()
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
        <p className={styles.emptyText}>{t('locations.movements.noneYet')}</p>
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
                    <span className={styles.movementType}>{t(`locations.movements.types.${m.movement_type}`, { defaultValue: m.movement_type.replace('_', ' ') })}</span>
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
                {t('locations.movements.previous')}
              </button>
              <span className={styles.pageInfo}>{t('locations.movements.pageOf', { page, pages: meta.pages })}</span>
              <button className="btn btn-ghost btn-sm" disabled={page >= meta.pages} onClick={() => setPage(p => p + 1)}>
                {t('locations.movements.next')}
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
  const { t } = useTranslation()
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
            <ArrowDownToLine size={16} /> {t('locations.checkIn.title', { name: location.name })}
          </h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className={styles.modalBody}>
          {location.available_capacity === 0 && (
            <div className={styles.warningBanner}>
              {t('locations.checkIn.atCapacity', { count: location.capacity })}
            </div>
          )}

          <div className="form-group">
            <label>{t('locations.checkIn.searchForResource')}</label>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('locations.checkIn.typeToSearchGeneric')}
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
                  <span className={`badge badge-${node.status}`}>{t(`resources.status.${node.status}`, { defaultValue: node.status })}</span>
                </button>
              ))}
            </div>
          )}

          <div className="form-group">
            <label>{t('locations.notes')}</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('identifiers.notePlaceholder')} />
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="btn btn-primary"
            disabled={!nodeId || checkInMutation.isPending || location.available_capacity === 0}
            onClick={() => checkInMutation.mutate()}
          >
            {checkInMutation.isPending ? <Spinner size={14} /> : <ArrowDownToLine size={14} />}
            {t('relations.locations.checkIn')}
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
  const { t } = useTranslation()
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
            <ArrowLeftRight size={16} /> {t('locations.transfer.title')}
          </h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><X size={14} /></button>
        </div>

        <div className={styles.modalBody}>
          <div className="form-group">
            <label>{t('locations.transfer.filterTargets')}</label>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('locations.transfer.searchPlaceholder')} autoFocus />
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
                  {loc.stored_count}{loc.capacity !== null ? `/${loc.capacity}` : ''} {t('locations.transfer.itemsUnit')}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className={styles.emptyText} style={{ padding: 'var(--space-3)' }}>
                {t('locations.transfer.noneFound')}
              </p>
            )}
          </div>

          <div className="form-group">
            <label>{t('locations.notes')}</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('identifiers.notePlaceholder')} />
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="btn btn-primary"
            disabled={!targetId || transferMutation.isPending}
            onClick={() => transferMutation.mutate()}
          >
            {transferMutation.isPending ? <Spinner size={14} /> : <ArrowLeftRight size={14} />}
            {t('locations.transfer.transferButton')}
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
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('overview')
  const [showCheckIn, setShowCheckIn] = useState(false)
  const [showMoveContents, setShowMoveContents] = useState(false)
  const [checkOutNodeId, setCheckOutNodeId] = useState<number | null>(null)
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

  if (isLoading) return <div className={styles.loadingState}><Spinner /><span>{t('common.loading')}</span></div>
  if (!location) return null

  const tabs = [
    { key: 'overview',  icon: <BarChart3 size={13} />,      label: t('locations.detail.overview') },
    { key: 'items',     icon: <Package size={13} />,        label: `${t('locations.detail.itemsTab')}${location.stored_count ? ` (${location.stored_count})` : ''}` },
    { key: 'movements', icon: <Clock size={13} />,          label: t('resources.tabs.history') },
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
                      {location.stored_count} {t('locations.detail.stored')}
                      {location.capacity !== null && ` / ${location.capacity} ${t('locations.detail.capacity')}`}
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
                  <ArrowDownToLine size={13} /> {t('relations.locations.checkIn')}
                </button>
              )}
              {location.can_store_nodes && location.stored_count > 0 && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowMoveContents(true)}
                  title={t('locations.detail.moveContentsTitle')}
                >
                  <ArrowLeftRight size={13} /> {t('locations.detail.moveContents')}
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
                } catch (e) { alert(t('locations.detail.inventoryFailed')) }
              }}>
                <FileText size={13} /> {t('locations.detail.inventory')}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => onAddChild(locationId)}>
                <Plus size={13} /> {t('locations.detail.addChild')}
              </button>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => onEdit(location)}>
                <Pencil size={14} />
              </button>
              <button
                className="btn btn-ghost btn-sm btn-icon"
                onClick={() => { if (confirm(t('locations.detail.deleteConfirm', { name: location.name }))) deleteMutation.mutate() }}
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
              onCheckOut={(nodeId) => setCheckOutNodeId(nodeId)}
              onMove={(node) => setMovingNode(node)}
            />
          )}
          {tab === 'movements' && <MovementsTab locationId={locationId} />}
        </div>
      </div>

      {showCheckIn && (
        <CheckInModal location={location} onClose={() => setShowCheckIn(false)} />
      )}
      {showMoveContents && (
        <MoveContentsModal location={location} onClose={() => setShowMoveContents(false)} />
      )}
      {checkOutNodeId !== null && (
        <CheckOutCategoryModal
          location={location}
          nodeId={checkOutNodeId}
          onClose={() => setCheckOutNodeId(null)}
        />
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
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const routerLocation = useLocation()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedStub, setSelectedStub] = useState<LocationStub | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('detail')

  // Incoming navigation from a node's Locations tab:
  // navigate('/app/locations', { state: { selectLocationId } })
  useEffect(() => {
    const incoming = routerLocation.state?.selectLocationId
    if (incoming) {
      setSelectedId(incoming)
      setSelectedStub(null)
      setViewMode('detail')
    }
  }, [routerLocation.state?.selectLocationId])
  const [editingLocation, setEditingLocation] = useState<LocationDetail | null>(null)
  const [addingChildOf, setAddingChildOf] = useState<number | null>(null)
  const [treeSearch, setTreeSearch] = useState('')
  const [showQuickMove, setShowQuickMove] = useState(false)

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
    <>
    <PageShell
      sidebar={
        <SidebarPanel
          title={t('nav.locations')}
          actions={
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowQuickMove(true)}
                title={t('locations.page.quickMoveTitle')}
              >
                <ScanLine size={14} /> {t('locations.page.quickMove')}
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => { setAddingChildOf(null); setViewMode('create') }}
              >
                <Plus size={14} /> {t('resources.tree.newButton')}
              </button>
            </>
          }
        >
<div className={styles.treeWrap}>
  <div style={{ padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <svg style={{ position: 'absolute', left: 8, color: 'var(--color-ink-faint)', pointerEvents: 'none' }} width="13" height="13" viewBox="0 0 16 16" fill="none">
        <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      <input
        style={{ paddingLeft: 28, width: '100%', fontSize: 'var(--text-sm)' }}
        value={treeSearch}
        onChange={e => setTreeSearch(e.target.value)}
        placeholder={t('locations.page.filterPlaceholder')}
      />
      {treeSearch && (
        <button
          style={{ position: 'absolute', right: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-ink-faint)', display: 'flex', padding: 4 }}
          onClick={() => setTreeSearch('')}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      )}
    </div>
  </div>
  <LocationTree
    selectedId={selectedId}
    onSelect={(loc) => {
      setSelectedId(loc.id)
      setSelectedStub(loc)
      setViewMode('detail')
    }}
    search={treeSearch}
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
                  ? addingChildOf ? t('locations.page.addChildLocation') : t('locations.page.newRootLocation')
                  : t('locations.page.editLocation', { name: editingLocation?.name })}
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
            title={t('locations.page.emptyTitle')}
            subtitle={t('resources.emptyState.subtitle')}
          />
        )
      }
    />
    {showQuickMove && (
      <QuickMoveModal
        onClose={() => setShowQuickMove(false)}
        onOpenLocation={(id) => { setSelectedId(id); setViewMode('detail'); setShowQuickMove(false) }}
      />
    )}
    </>
  )
}

// ─── Move-contents modal ──────────────────────────────────────────────

function MoveContentsModal({ location, onClose }: {
  location: LocationDetail
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<any>(null)
  const [notes, setNotes] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const { data: searchResults } = useQuery({
    queryKey: ['locations-search-movecontents', search],
    queryFn: () => locationsApi.search(search, true).then(r => r.data.data as any[]),
    enabled: search.length > 1,
  })

  const moveMutation = useMutation({
    mutationFn: () => locationsApi.moveContents(location.id, target.id, notes || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['location-tree'] })
      queryClient.invalidateQueries({ queryKey: ['location-nodes'] })
      queryClient.invalidateQueries({ queryKey: ['location-movements'] })
      queryClient.invalidateQueries({ queryKey: ['location'] })
      queryClient.invalidateQueries({ queryKey: ['location-overview'] })
      queryClient.invalidateQueries({ queryKey: ['node'] })
      onClose()
    },
    onError: (err: any) => {
      setErrorMsg(err?.response?.data?.message ?? t('resources.modals.move.moveFailed'))
    },
  })

  const overCapacity = target?.available_capacity != null
    && target.available_capacity < location.stored_count

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            <ArrowLeftRight size={16} /> {t('locations.moveContents.title', { name: location.name })}
          </h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className={styles.modalBody}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-muted)' }}>
            {t('locations.moveContents.willRelocate', { count: location.stored_count })}
          </p>

          <div className="form-group">
            <label>{t('locations.moveContents.targetLocation')}</label>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setTarget(null) }}
              placeholder={t('locations.moveContents.searchPlaceholder')}
              autoFocus
            />
          </div>

          {searchResults && search.length > 1 && !target && (
            <div className={styles.searchResults}>
              {searchResults
                .filter((l: any) => l.id !== location.id)
                .map((l: any) => (
                <button
                  key={l.id}
                  className={styles.searchResult}
                  onClick={() => { setTarget(l); setSearch(l.full_path ?? l.name) }}
                >
                  <div className={styles.searchResultInfo}>
                    <span className={styles.searchResultTitle}>{l.full_path ?? l.name}</span>
                    <span className="ref-code">{l.code}</span>
                  </div>
                  {l.available_capacity != null && (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-faint)' }}>
                      {l.available_capacity} {t('locations.moveContents.freeSuffix')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {overCapacity && (
            <div className={styles.warningBanner}>
              {t('locations.moveContents.overCapacity', { free: target.available_capacity, capacity: target.capacity, count: location.stored_count })}
            </div>
          )}

          {errorMsg && <div className={styles.warningBanner}>{errorMsg}</div>}

          <div className="form-group">
            <label>{t('locations.notes')}</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder={t('locations.moveContents.notesHint')} />
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="btn btn-primary"
            disabled={!target || overCapacity || moveMutation.isPending}
            onClick={() => moveMutation.mutate()}
          >
            {moveMutation.isPending ? <Spinner size={14} /> : <ArrowLeftRight size={14} />}
            {t('locations.moveContents.moveItems', { count: location.stored_count })}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Quick-move (barcode) modal ───────────────────────────────────────

interface QuickMoveResult {
  ref_code: string
  status: 'moved' | 'not_found' | 'already_here' | 'at_capacity'
  title?: string
  movement_type?: string
}

function QuickMoveModal({ onClose, onOpenLocation }: {
  onClose: () => void
  onOpenLocation: (locationId: number) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [locationCode, setLocationCode] = useState('')
  const [codeLocked, setCodeLocked] = useState(false)
  const [itemCode, setItemCode] = useState('')
  const [results, setResults] = useState<QuickMoveResult[]>([])
  const [targetInfo, setTargetInfo] = useState<{ id: number; full_path: string } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const moveMutation = useMutation({
    mutationFn: (ref: string) => locationsApi.quickMove(locationCode.trim(), [ref]),
    onSuccess: (res) => {
      const d = res.data.data
      setTargetInfo(d.target)
      setErrorMsg('')
      setResults(prev => [...d.results, ...prev])
      queryClient.invalidateQueries({ queryKey: ['location-tree'] })
      queryClient.invalidateQueries({ queryKey: ['location-nodes'] })
      queryClient.invalidateQueries({ queryKey: ['location'] })
      queryClient.invalidateQueries({ queryKey: ['location-overview'] })
      queryClient.invalidateQueries({ queryKey: ['node'] })
    },
    onError: (err: any) => {
      setErrorMsg(err?.response?.data?.message ?? t('resources.modals.move.moveFailed'))
    },
  })

  const handleItemScan = () => {
    const ref = itemCode.trim()
    if (!ref || !locationCode.trim()) return
    moveMutation.mutate(ref)
    setItemCode('')
  }

  const STATUS_META: Record<QuickMoveResult['status'], { icon: any; colour: string; label: string }> = {
    moved:        { icon: CheckCircle2, colour: 'var(--color-success)', label: t('locations.quickMove.status.moved') },
    not_found:    { icon: AlertCircle,  colour: 'var(--color-error)',   label: t('locations.quickMove.status.notFound') },
    already_here: { icon: CheckCircle2, colour: 'var(--color-ink-faint)', label: t('locations.quickMove.status.alreadyHere') },
    at_capacity:  { icon: AlertCircle,  colour: 'var(--color-warning)', label: t('locations.quickMove.status.atCapacity') },
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            <ScanLine size={16} /> {t('locations.quickMove.title')}
          </h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className={styles.modalBody}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-muted)' }}>
            {t('locations.quickMove.instructions')}
          </p>

          <div className="form-group">
            <label>{t('locations.quickMove.locationCode')}</label>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input
                value={locationCode}
                onChange={e => { setLocationCode(e.target.value); setTargetInfo(null) }}
                onKeyDown={e => { if (e.key === 'Enter') setCodeLocked(true) }}
                placeholder={t('locations.quickMove.locationCodePlaceholder')}
                disabled={codeLocked}
                autoFocus
                style={{ flex: 1 }}
              />
              {codeLocked && (
                <button className="btn btn-ghost btn-sm"
                  onClick={() => { setCodeLocked(false); setTargetInfo(null) }}>
                  {t('locations.quickMove.change')}
                </button>
              )}
            </div>
            {targetInfo && (
              <span className="form-hint" style={{ color: 'var(--color-success)' }}>
                → {targetInfo.full_path}
              </span>
            )}
          </div>

          <div className="form-group">
            <label>{t('locations.quickMove.itemRefCode')}</label>
            <input
              value={itemCode}
              onChange={e => setItemCode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleItemScan() }}
              placeholder={t('locations.quickMove.itemRefPlaceholder')}
              autoFocus={codeLocked}
              disabled={!locationCode.trim()}
            />
          </div>

          {errorMsg && <div className={styles.warningBanner}>{errorMsg}</div>}

          {results.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2,
              maxHeight: 220, overflowY: 'auto',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2)' }}>
              {results.map((r, i) => {
                const meta = STATUS_META[r.status]
                const Icon = meta.icon
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center',
                    gap: 'var(--space-2)', fontSize: 'var(--text-sm)',
                    padding: '2px 4px' }}>
                    <Icon size={13} style={{ color: meta.colour, flexShrink: 0 }} />
                    <span className="ref-code">{r.ref_code}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      color: 'var(--color-ink-muted)' }}>
                      {r.title ?? ''}
                    </span>
                    <span style={{ fontSize: 'var(--text-xs)', color: meta.colour,
                      fontWeight: 600, flexShrink: 0 }}>
                      {meta.label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className={styles.modalFooter}>
          {targetInfo && (
            <button className="btn btn-ghost"
              onClick={() => onOpenLocation(targetInfo.id)}>
              {t('locations.quickMove.openLocation')}
            </button>
          )}
          <button className="btn btn-primary" onClick={onClose}>{t('locations.quickMove.done')}</button>
        </div>
      </div>
    </div>
  )
}


// ─── Check-out with category modal ────────────────────────────────────

function CheckOutCategoryModal({ location, nodeId, onClose }: {
  location: LocationDetail
  nodeId: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [categoryId, setCategoryId] = useState<string>('')
  const [notes, setNotes] = useState('')

  const { data: cats } = useQuery({
    queryKey: ['checkout-categories'],
    queryFn: () => locationsApi.getCheckoutCategories().then(r => r.data.data),
  })

  const checkOutMutation = useMutation({
    mutationFn: () => locationsApi.checkOut(
      location.id, nodeId, notes || undefined,
      categoryId ? parseInt(categoryId) : undefined,
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['location-nodes'] })
      queryClient.invalidateQueries({ queryKey: ['location-movements'] })
      queryClient.invalidateQueries({ queryKey: ['location-tree'] })
      queryClient.invalidateQueries({ queryKey: ['location'] })
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
            <ArrowUpFromLine size={16} /> {t('relations.locations.checkOut')}
          </h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className="form-group">
            <label>{t('locations.checkOutCategory.reason')}</label>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)} autoFocus>
              <option value="">{t('relations.locations.uncategorised')}</option>
              {(cats as any)?.categories?.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <span className="form-hint">
              {t('locations.checkOutCategory.categoriesHint')}
            </span>
          </div>
          <div className="form-group">
            <label>{t('locations.notes')}</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('identifiers.notePlaceholder')} />
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="btn btn-primary"
            disabled={checkOutMutation.isPending}
            onClick={() => checkOutMutation.mutate()}
          >
            {checkOutMutation.isPending ? <Spinner size={14} /> : <ArrowUpFromLine size={14} />}
            {t('relations.locations.checkOut')}
          </button>
        </div>
      </div>
    </div>
  )
}
