import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hierarchyApi, classificationsApi } from '@/api'
import { Spinner } from '@/components/ui'

interface HierarchyLevelSelectProps {
  entityType: 'resource' | 'location' | 'classification'
  hierarchyTypeId: string
  levelName: string
  onHierarchyTypeChange: (id: string) => void
  onLevelChange: (name: string) => void
  disabled?: boolean
  // For classifications: pass the parent classification id to filter valid levels
  parentClassificationId?: number | null
}

export default function HierarchyLevelSelect({
  entityType,
  hierarchyTypeId,
  levelName,
  onHierarchyTypeChange,
  onLevelChange,
  disabled,
  parentClassificationId,
}: HierarchyLevelSelectProps) {
  const { data: types, isLoading: loadingTypes } = useQuery({
    queryKey: ['hierarchy-types', entityType],
    queryFn: () => hierarchyApi.listTypes(entityType).then(r => r.data.data as any[]),
  })

  // For classifications: use valid-levels endpoint which respects parent
  const useValidLevels = entityType === 'classification' && !!hierarchyTypeId
  const { data: validLevels, isLoading: loadingValid } = useQuery({
    queryKey: ['classification-valid-levels', hierarchyTypeId, parentClassificationId],
    queryFn: () => classificationsApi.validLevels(
      parseInt(hierarchyTypeId),
      parentClassificationId ?? undefined
    ).then(r => r.data.data),
    enabled: useValidLevels,
  })

  // For non-classification: use all levels
  const { data: allLevels, isLoading: loadingAll } = useQuery({
    queryKey: ['hierarchy-levels', hierarchyTypeId],
    queryFn: () => hierarchyApi.listLevels(parseInt(hierarchyTypeId)).then(r => r.data.data as any[]),
    enabled: !!hierarchyTypeId && !useValidLevels,
  })

  const levels = useValidLevels ? validLevels : allLevels
  const loadingLevels = useValidLevels ? loadingValid : loadingAll
  const sortedLevels = [...(levels ?? [])].sort((a, b) => a.sort_order - b.sort_order)

  // Auto-select if only one hierarchy type
  useEffect(() => {
    if (!hierarchyTypeId && types?.length === 1) {
      onHierarchyTypeChange(String(types[0].id))
    }
  }, [types, hierarchyTypeId])

  // Clear level when hierarchy type or parent changes
  useEffect(() => {
    onLevelChange('')
  }, [hierarchyTypeId, parentClassificationId])

  // Auto-select if only one valid level
  useEffect(() => {
    if (sortedLevels.length === 1 && !levelName) {
      onLevelChange(sortedLevels[0].name)
    }
  }, [sortedLevels])

  return (
    <>
      <div className="form-group">
        <label>Hierarchy type *</label>
        {loadingTypes ? (
          <div style={{ padding: '8px 0' }}><Spinner size={14} /></div>
        ) : (
          <select
            value={hierarchyTypeId}
            onChange={e => onHierarchyTypeChange(e.target.value)}
            disabled={disabled}
          >
            <option value="">Select hierarchy…</option>
            {types?.map((ht: any) => (
              <option key={ht.id} value={ht.id}>{ht.name}</option>
            ))}
          </select>
        )}
        {disabled && <span className="form-hint">Cannot change after creation</span>}
      </div>

      <div className="form-group">
        <label>Level *</label>
        {loadingLevels && hierarchyTypeId ? (
          <div style={{ padding: '8px 0' }}><Spinner size={14} /></div>
        ) : (
          <select
            value={levelName}
            onChange={e => onLevelChange(e.target.value)}
            disabled={!hierarchyTypeId || disabled || sortedLevels.length === 0}
          >
            <option value="">
              {!hierarchyTypeId
                ? 'Select a hierarchy type first'
                : sortedLevels.length === 0
                ? 'No valid levels for this position'
                : 'Select level…'}
            </option>
            {sortedLevels.map((l: any) => (
              <option key={l.id} value={l.name}>{l.name}</option>
            ))}
          </select>
        )}
        {entityType === 'classification' && hierarchyTypeId && sortedLevels.length === 0 && !loadingLevels && (
          <span className="form-hint" style={{ color: 'var(--color-error)' }}>
            No levels are configured as valid {parentClassificationId ? 'children' : 'root nodes'} for this hierarchy
          </span>
        )}
      </div>
    </>
  )
}