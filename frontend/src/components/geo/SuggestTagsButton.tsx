import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Sparkles, Check, X, Tag } from 'lucide-react'
import { aiApi } from '@/api'
import { Spinner } from '@/components/ui'
import styles from './SuggestTagsButton.module.css'

interface Suggestion {
  name: string
  category: string
  category_label: string
  exists_in_vocab: boolean
  selected: boolean
}

interface Props {
  nodeId: number
  onApply: (tags: { name: string; category: string }[]) => void
  isApplying: boolean
}

export default function SuggestTagsButton({ nodeId, onApply, isApplying }: Props) {
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])

  const suggestMutation = useMutation({
    mutationFn: () => aiApi.suggestTags(nodeId),
    onSuccess: (res) => {
      setSuggestions(
        res.data.data.suggestions.map(s => ({ ...s, selected: true }))
      )
    },
  })

  const toggle = (name: string) => {
    setSuggestions(prev =>
      prev.map(s => s.name === name ? { ...s, selected: !s.selected } : s)
    )
  }

  const selected = suggestions.filter(s => s.selected)

  const handleApply = () => {
    onApply(selected.map(s => ({ name: s.name, category: s.category })))
    setSuggestions([])
    setOpen(false)
  }

  // Group by category for display
  const byCategory = suggestions.reduce((acc, s) => {
    const key = s.category_label
    if (!acc[key]) acc[key] = []
    acc[key].push(s)
    return acc
  }, {} as Record<string, Suggestion[]>)

  return (
    <div className={styles.wrap}>
      <button
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
        onClick={() => { setOpen(v => !v); if (open) setSuggestions([]) }}
        type="button"
      >
        <Sparkles size={13} />
        <span>Suggest tags with AI</span>
        {open
          ? <X size={12} style={{ marginLeft: 'auto' }} />
          : null}
      </button>

      {open && (
        <div className={styles.panel}>
          {suggestions.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyHint}>
                AI will suggest tags based on this record's title, description, and scope note — matched against your tag vocabulary.
              </p>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => suggestMutation.mutate()}
                disabled={suggestMutation.isPending}
              >
                {suggestMutation.isPending
                  ? <><Spinner size={13} /> Analysing...</>
                  : <><Sparkles size={13} /> Generate suggestions</>}
              </button>
              {suggestMutation.isError && (
                <span className={styles.error}>
                  {(suggestMutation.error as any)?.response?.data?.message ?? 'Suggestion failed'}
                </span>
              )}
            </div>
          ) : (
            <>
              <div className={styles.categories}>
                {Object.entries(byCategory).map(([catLabel, tags]) => (
                  <div key={catLabel} className={styles.category}>
                    <div className={styles.categoryLabel}>
                      <Tag size={11} />
                      {catLabel}
                    </div>
                    <div className={styles.tagList}>
                      {tags.map(s => (
                        <button
                          key={s.name}
                          className={`${styles.tagPill} ${s.selected ? styles.tagPillSelected : styles.tagPillUnselected}`}
                          onClick={() => toggle(s.name)}
                          title={s.exists_in_vocab ? 'Exists in vocabulary' : 'New tag'}
                        >
                          {s.selected
                            ? <Check size={10} />
                            : <X size={10} />}
                          {s.name}
                          {!s.exists_in_vocab && (
                            <span className={styles.newBadge}>new</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className={styles.actions}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => suggestMutation.mutate()}
                  disabled={suggestMutation.isPending}
                >
                  {suggestMutation.isPending ? <Spinner size={12} /> : <Sparkles size={12} />}
                  Regenerate
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleApply}
                  disabled={selected.length === 0 || isApplying}
                >
                  {isApplying ? <Spinner size={12} /> : <Check size={12} />}
                  Apply {selected.length} tag{selected.length !== 1 ? 's' : ''}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}