import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tag, X, Plus } from 'lucide-react'
import { tagsApi, vocabApi } from '@/api'
import { Spinner } from '@/components/ui'
import styles from './TagsPanel.module.css'

const NO_CATEGORY = { value: '', label: 'No category' }

const CATEGORY_COLORS: Record<string, string> = {
  topic:      'var(--color-accent)',
  occupation: '#7c3aed',
  genre:      '#059669',
  function:   '#d97706',
  period:     '#dc2626',
  other:      'var(--color-ink-faint)',
}

function getCategoryColor(name: string): string {
  return CATEGORY_COLORS[name] ?? 'var(--color-ink-faint)'
}

interface TagsPanelProps {
  entityType: 'node' | 'agent'
  entityId: number
}

export default function TagsPanel({ entityType, entityId }: TagsPanelProps) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [category, setCategory] = useState('')
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: tagCategories = [] } = useQuery({
    queryKey: ['tag-categories'],
    queryFn: () => vocabApi.listTagCategories(entityType).then(r => r.data.data),
  })

  const categoryOptions = [NO_CATEGORY, ...tagCategories.map((c: any) => ({ value: c.name, label: c.label }))]

  const queryKey = [entityType === 'node' ? 'node-tags' : 'agent-tags', entityId]

  const { data: tags, isLoading } = useQuery({
    queryKey,
    queryFn: () => entityType === 'node'
      ? tagsApi.getNodeTags(entityId).then(r => r.data.data)
      : tagsApi.getAgentTags(entityId).then(r => r.data.data),
  })

  const addMutation = useMutation({
    mutationFn: (name: string) => entityType === 'node'
      ? tagsApi.addNodeTag(entityId, name, category || undefined)
      : tagsApi.addAgentTag(entityId, name, category || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setInput('')
      setSuggestions([])
    },
  })

  const removeMutation = useMutation({
    mutationFn: (tagId: number) => entityType === 'node'
      ? tagsApi.removeNodeTag(entityId, tagId)
      : tagsApi.removeAgentTag(entityId, tagId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  // Debounced suggestion fetch
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!input.trim()) { setSuggestions([]); return }
    debounceRef.current = setTimeout(async () => {
      const res = await tagsApi.search(input.trim(), category || undefined)
      const existing = new Set((tags ?? []).map((t: any) => t.name.toLowerCase()))
      setSuggestions(res.data.data.filter((t: any) => !existing.has(t.name.toLowerCase())))
    }, 200)
  }, [input, category, tags])

  const handleAdd = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    addMutation.mutate(trimmed)
    setShowSuggestions(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { handleAdd(input); return }
    if (e.key === 'Escape') { setShowSuggestions(false); setInput('') }
  }

  const groupedTags = (tags ?? []).reduce((acc: Record<string, any[]>, t: any) => {
    const key = t.category || ''
    if (!acc[key]) acc[key] = []
    acc[key].push(t)
    return acc
  }, {})

  if (isLoading) return <div style={{ padding: 'var(--space-4)' }}><Spinner size={16} /></div>

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>
          <Tag size={14} /> Tags
        </span>
      </div>

      {/* Grouped tags */}
      {Object.entries(groupedTags).map(([cat, catTags]) => (
        <div key={cat} className={styles.tagGroup}>
          {cat && (
            <div className={styles.groupLabel} style={{ color: getCategoryColor(cat) }}>
              {categoryOptions.find((c: any) => c.value === cat)?.label ?? cat}
            </div>
          )}
          <div className={styles.tagList}>
            {(catTags as any[]).map(tag => (
              <span key={tag.id} className={styles.tagPill}
                style={{ '--tag-color': getCategoryColor(tag.category ?? '') } as any}>
                {tag.name}
                <button className={styles.tagRemove}
                  onClick={() => removeMutation.mutate(tag.id)}
                  title="Remove tag">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        </div>
      ))}

      {(!tags || tags.length === 0) && (
        <p className={styles.empty}>No tags yet.</p>
      )}

      {/* Add tag input */}
      <div className={styles.addArea}>
        <div className={styles.addRow}>
          <div className={styles.inputWrap}>
            <input
              ref={inputRef}
              className={styles.tagInput}
              value={input}
              onChange={e => { setInput(e.target.value); setShowSuggestions(true) }}
              onKeyDown={handleKeyDown}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="Add a tag…"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className={styles.suggestions}>
                {suggestions.map((s: any) => (
                  <button key={s.id} className={styles.suggestion}
                    onMouseDown={() => handleAdd(s.name)}>
                    <span className={styles.suggestionName}>{s.name}</span>
                    {s.category && (
                      <span className={styles.suggestionCat}>{s.category}</span>
                    )}
                  </button>
                ))}
                {input.trim() && !suggestions.find((s: any) => s.name.toLowerCase() === input.trim().toLowerCase()) && (
                  <button className={`${styles.suggestion} ${styles.suggestionNew}`}
                    onMouseDown={() => handleAdd(input)}>
                    <Plus size={11} /> Create "{input.trim()}"
                  </button>
                )}
              </div>
            )}
          </div>

          <select value={category} onChange={e => setCategory(e.target.value)}
            className={styles.categorySelect}>
            {categoryOptions.map((c: any) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>

          <button className="btn btn-secondary btn-sm"
            disabled={!input.trim() || addMutation.isPending}
            onClick={() => handleAdd(input)}>
            {addMutation.isPending ? <Spinner size={13} /> : <Plus size={13} />}
          </button>
        </div>
        <span className={styles.hint}>Press Enter to add · Existing tags are suggested as you type</span>
      </div>
    </div>
  )
}
