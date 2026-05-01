import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, X, ChevronRight } from 'lucide-react'
import { nodesApi } from '@/api'
import api from '@/api/client'
import { Spinner } from '@/components/ui'
import type { NodeDetail, MetadataField } from '@/types'
import styles from './NodeForm.module.css'
import { MetadataFieldInput } from './MetadataFieldRenderer'

// ─── Types ────────────────────────────────────────────────────────────

interface NodeFormData {
  title: string
  local_ref: string
  level_of_description: string
  hierarchy_type_id: number | ''
  parent_id: number | null
  description: string
  scope_and_content: string
  arrangement: string
  access_conditions: string
  reproduction_conditions: string
  language: string
  finding_aids: string
  extent: string
  date_start: string
  date_end: string
  date_certainty: string
  metadata_spec: Record<string, string>
}

const EMPTY_FORM: NodeFormData = {
  title: '',
  local_ref: '',
  level_of_description: '',
  hierarchy_type_id: '',
  parent_id: null,
  description: '',
  scope_and_content: '',
  arrangement: '',
  access_conditions: '',
  reproduction_conditions: '',
  language: '',
  finding_aids: '',
  extent: '',
  date_start: '',
  date_end: '',
  date_certainty: '',
  metadata_spec: {},
}

function nodeToForm(node: NodeDetail): NodeFormData {
  return {
    title: node.title,
    local_ref: node.local_ref,
    level_of_description: node.level_of_description,
    hierarchy_type_id: node.hierarchy_type_id,
    parent_id: node.parent_id,
    description: node.description ?? '',
    scope_and_content: node.scope_and_content ?? '',
    arrangement: node.arrangement ?? '',
    access_conditions: node.access_conditions ?? '',
    reproduction_conditions: node.reproduction_conditions ?? '',
    language: node.language ?? '',
    finding_aids: node.finding_aids ?? '',
    extent: node.extent ?? '',
    date_start: node.date_start ?? '',
    date_end: node.date_end ?? '',
    date_certainty: node.date_certainty ?? '',
    metadata_spec: Object.fromEntries(
      Object.entries(node.metadata_spec ?? {}).map(([k, v]) => [k, String(v)])
    ),
  }
}

// ─── Dynamic metadata fields ──────────────────────────────────────────

function MetadataFields({
  fields,
  values,
  onChange,
}: {
  fields: MetadataField[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}) {
  if (!fields.length) return null
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Level-specific fields</h3>
      <div className={styles.fieldGrid}>
        {fields.map(field => (
          <MetadataFieldInput
            key={field.name}
            field={field}
            value={values[field.name]}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Main form ────────────────────────────────────────────────────────

interface NodeFormProps {
  node?: NodeDetail               // present when editing
  parentId?: number | null        // present when adding child
  onSaved: (nodeId: number) => void
  onCancel: () => void
}

export default function NodeForm({ node, parentId, onSaved, onCancel }: NodeFormProps) {
  const queryClient = useQueryClient()
  const isEditing = !!node

  const [form, setForm] = useState<NodeFormData>(() =>
    node ? nodeToForm(node) : { ...EMPTY_FORM, parent_id: parentId ?? null }
  )

  const set = (field: keyof NodeFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))

  // Fetch hierarchy types for this institution
  const { data: hierarchyTypes } = useQuery({
    queryKey: ['hierarchy-types', 'resource'],
    queryFn: () => api.get('/hierarchy/types', { params: { entity_type: 'resource' } }).then(r => r.data.data as any[]),
  })

  // Fetch valid levels based on selected hierarchy type + parent
  const { data: parentNode } = useQuery({
    queryKey: ['node-parent', form.parent_id],
    queryFn: () => nodesApi.get(form.parent_id!).then(r => r.data.data),
    enabled: form.parent_id !== null && form.parent_id !== undefined,
  })

  // When there is a parent, wait until parentNode is loaded before fetching valid levels
  // so we can pass the correct parent_level. Without this, editing a child node
  // fires the query with parent_level=null, returning only root levels.
  const parentReady = form.parent_id === null || !!parentNode

  const { data: validLevels } = useQuery({
    queryKey: ['valid-levels', form.hierarchy_type_id, parentNode?.level_of_description ?? null],
    queryFn: () =>
      api.get('/hierarchy/valid-levels', {
        params: {
          hierarchy_type_id: form.hierarchy_type_id,
          parent_level: parentNode?.level_of_description ?? null,
        },
      }).then(r => r.data.data as any[]),
    enabled: !!form.hierarchy_type_id && parentReady,
  })

  // Fetch metadata fields for selected level
  const { data: levelSchema } = useQuery({
    queryKey: ['level-schema', form.hierarchy_type_id, form.level_of_description],
    queryFn: () =>
      api.get('/hierarchy/level-schema', {
        params: {
          hierarchy_type_id: form.hierarchy_type_id,
          level_name: form.level_of_description,
        },
      }).then(r => r.data.data as MetadataField[]),
    enabled: !!form.hierarchy_type_id && !!form.level_of_description,
  })

  // Clear level when hierarchy type changes — but skip on initial mount
  // so that editing a node doesn't wipe the existing level_of_description
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    setForm(f => ({ ...f, level_of_description: '', metadata_spec: {} }))
  }, [form.hierarchy_type_id])

  // Clear metadata when level changes — also skip first render
  const isFirstLevelRender = useRef(true)
  useEffect(() => {
    if (isFirstLevelRender.current) { isFirstLevelRender.current = false; return }
    setForm(f => ({ ...f, metadata_spec: {} }))
  }, [form.level_of_description])

  const createMutation = useMutation({
    mutationFn: () => nodesApi.create({
      ...form,
      hierarchy_type_id: form.hierarchy_type_id as number,
      date_start: form.date_start || null,
      date_end: form.date_end || null,
      date_certainty: form.date_certainty || null,
      metadata_spec: form.metadata_spec,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['node-tree'] })
      queryClient.invalidateQueries({ queryKey: ['node-children', form.parent_id] })
      onSaved(res.data.data.id)
    },
  })

  const updateMutation = useMutation({
    mutationFn: () => nodesApi.update(node!.id, {
      title: form.title,
      local_ref: form.local_ref,
      level_of_description: form.level_of_description,
      description: form.description || null,
      scope_and_content: form.scope_and_content || null,
      arrangement: form.arrangement || null,
      access_conditions: form.access_conditions || null,
      reproduction_conditions: form.reproduction_conditions || null,
      language: form.language || null,
      finding_aids: form.finding_aids || null,
      extent: form.extent || null,
      date_start: form.date_start || null,
      date_end: form.date_end || null,
      date_certainty: form.date_certainty || null,
      metadata_spec: form.metadata_spec,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['node', node!.id] })
      queryClient.invalidateQueries({ queryKey: ['node-tree'] })
      queryClient.invalidateQueries({ queryKey: ['node-children', node!.parent_id] })
      onSaved(res.data.data.id)
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending
  const error = createMutation.error || updateMutation.error

  const handleSubmit = () => {
    if (isEditing) updateMutation.mutate()
    else createMutation.mutate()
  }

  const metadataFields: MetadataField[] = levelSchema ?? []

  return (
    <div className={styles.formPanel}>
      {/* Header */}
      <div className={styles.formHeader}>
        <div className={styles.formHeaderLeft}>
          {parentNode && (
            <div className={styles.parentNote}>
              <ChevronRight size={13} />
              <span>Child of <strong>{parentNode.ref_code}</strong> — {parentNode.title}</span>
            </div>
          )}
          <h2 className={styles.formTitle}>
            {isEditing ? `Editing: ${node.title}` : 'New resource'}
          </h2>
        </div>
        <div className={styles.formHeaderActions}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={isPending}>
            <X size={14} /> Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={!form.title || !form.local_ref || !form.level_of_description || !form.hierarchy_type_id || isPending}
          >
            {isPending ? <Spinner size={14} /> : <Save size={14} />}
            {isPending ? 'Saving…' : isEditing ? 'Save changes' : 'Create resource'}
          </button>
        </div>
      </div>

      {error && (
        <div className={styles.errorBanner}>
          {(error as any).response?.data?.message ?? 'Something went wrong. Please try again.'}
        </div>
      )}

      <div className={styles.formBody}>

        {/* Identity */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Identity</h3>
          <div className={styles.fieldGrid}>

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Title *</label>
              <input value={form.title} onChange={set('title')} placeholder="Descriptive title" required />
            </div>

            <div className="form-group">
              <label>Reference code *</label>
              <input
                value={form.local_ref}
                onChange={set('local_ref')}
                placeholder="e.g. A1, F2023-001"
                required
              />
              <span className="form-hint">
                {form.parent_id
                  ? 'Will be appended to parent ref code'
                  : 'Root-level code — combined with institution prefix'}
              </span>
            </div>

            <div className="form-group">
              <label>Hierarchy type *</label>
              <select
                value={form.hierarchy_type_id}
                onChange={set('hierarchy_type_id')}
                disabled={isEditing}
              >
                <option value="">Select hierarchy…</option>
                {/* Fallback option while loading when editing */}
                {isEditing && form.hierarchy_type_id && !hierarchyTypes?.find((ht: any) => String(ht.id) === String(form.hierarchy_type_id)) && (
                  <option value={form.hierarchy_type_id}>{node?.hierarchy_type_name ?? 'Loading…'}</option>
                )}
                {hierarchyTypes?.map((ht: any) => (
                  <option key={ht.id} value={ht.id}>{ht.name}</option>
                ))}
              </select>
              {isEditing && (
                <span className="form-hint">Hierarchy type cannot be changed after creation</span>
              )}
            </div>

            <div className="form-group">
              <label>Level of description *</label>
              <select
                value={form.level_of_description}
                onChange={set('level_of_description')}
                disabled={!form.hierarchy_type_id}
              >
                <option value="">
                  {form.hierarchy_type_id ? 'Select level…' : 'Select hierarchy first'}
                </option>
                {/* If editing and validLevels not yet loaded, show current value so select isn't blank */}
                {isEditing && form.level_of_description && !validLevels?.find((l: any) => l.name === form.level_of_description) && (
                  <option value={form.level_of_description}>{form.level_of_description}</option>
                )}
                {validLevels?.map((l: any) => (
                  <option key={l.id} value={l.name}>{l.name}</option>
                ))}
              </select>
            </div>

          </div>
        </div>

        {/* Dates & Extent */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Dates & Extent</h3>
          <div className={styles.fieldGrid}>

            <div className="form-group">
              <label>Date start</label>
              <input type="date" value={form.date_start} onChange={set('date_start')} />
            </div>

            <div className="form-group">
              <label>Date end</label>
              <input type="date" value={form.date_end} onChange={set('date_end')} />
            </div>

            <div className="form-group">
              <label>Date certainty</label>
              <select value={form.date_certainty} onChange={set('date_certainty')}>
                <option value="">Not specified</option>
                <option value="exact">Exact</option>
                <option value="approximate">Approximate</option>
                <option value="inferred">Inferred</option>
              </select>
            </div>

            <div className="form-group">
              <label>Extent</label>
              <input
                value={form.extent}
                onChange={set('extent')}
                placeholder="e.g. 3 boxes, 45 folders, 1.2 linear metres"
              />
            </div>

          </div>
        </div>

        {/* Description */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Description</h3>
          <div className={styles.fieldGridSingle}>

            <div className="form-group">
              <label>Description</label>
              <textarea
                value={form.description}
                onChange={set('description')}
                rows={4}
                placeholder="Brief description of the material…"
              />
            </div>

            <div className="form-group">
              <label>Scope and content</label>
              <textarea
                value={form.scope_and_content}
                onChange={set('scope_and_content')}
                rows={4}
                placeholder="Detailed account of the scope and content…"
              />
            </div>

            <div className="form-group">
              <label>Arrangement</label>
              <textarea
                value={form.arrangement}
                onChange={set('arrangement')}
                rows={2}
                placeholder="Information about internal arrangement or order…"
              />
            </div>

          </div>
        </div>

        {/* Access & Use */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Access & Use</h3>
          <div className={styles.fieldGridSingle}>

            <div className="form-group">
              <label>Access conditions</label>
              <textarea
                value={form.access_conditions}
                onChange={set('access_conditions')}
                rows={2}
                placeholder="Restrictions or conditions governing access…"
              />
            </div>

            <div className="form-group">
              <label>Reproduction conditions</label>
              <textarea
                value={form.reproduction_conditions}
                onChange={set('reproduction_conditions')}
                rows={2}
                placeholder="Conditions governing reproduction…"
              />
            </div>

            <div className={styles.fieldGrid}>
              <div className="form-group">
                <label>Language</label>
                <input
                  value={form.language}
                  onChange={set('language')}
                  placeholder="e.g. Swedish, English"
                />
              </div>

              <div className="form-group">
                <label>Finding aids</label>
                <input
                  value={form.finding_aids}
                  onChange={set('finding_aids')}
                  placeholder="Reference to any finding aids…"
                />
              </div>
            </div>

          </div>
        </div>

        {/* Dynamic metadata fields from hierarchy level schema */}
        {metadataFields.length > 0 && (
          <MetadataFields
            fields={metadataFields}
            values={form.metadata_spec}
            onChange={(key, value) =>
              setForm(f => ({
                ...f,
                metadata_spec: { ...f.metadata_spec, [key]: value as string },
              }))
            }
          />
        )}

      </div>
    </div>
  )
}