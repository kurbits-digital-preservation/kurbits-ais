import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Search, FileText, User, Building2, UsersRound, Bot, X, Command } from 'lucide-react'
import { searchApi } from '@/api'
import styles from './GlobalSearch.module.css'

// ─── Agent type icons ─────────────────────────────────────────────────

const AGENT_ICONS: Record<string, typeof User> = {
  person: User,
  organization: Building2,
  family: UsersRound,
  software: Bot,
}

// ─── Result row ───────────────────────────────────────────────────────

function NodeResult({ item, onClick, active }: { item: any; onClick: () => void; active: boolean }) {
  return (
    <button
      className={`${styles.result} ${active ? styles.resultActive : ''}`}
      onClick={onClick}
    >
      <div className={styles.resultIcon}>
        <FileText size={14} />
      </div>
      <div className={styles.resultBody}>
        <span className={styles.resultTitle}>{item.title}</span>
        <div className={styles.resultMeta}>
          <span className={styles.resultRef}>{item.ref_code}</span>
          <span className={styles.resultSep}>·</span>
          <span className={styles.resultLevel}>{item.level}</span>
          {item.status !== 'published' && (
            <>
              <span className={styles.resultSep}>·</span>
              <span className={styles.resultStatus}>{item.status}</span>
            </>
          )}
          {(item.date_start || item.date_end) && (
            <>
              <span className={styles.resultSep}>·</span>
              <span>{item.date_start}{item.date_end && item.date_end !== item.date_start ? `–${item.date_end}` : ''}</span>
            </>
          )}
        </div>
      </div>
      <span className={styles.resultType}>Resource</span>
    </button>
  )
}

function AgentResult({ item, onClick, active }: { item: any; onClick: () => void; active: boolean }) {
  const Icon = AGENT_ICONS[item.agent_type] ?? User
  return (
    <button
      className={`${styles.result} ${active ? styles.resultActive : ''}`}
      onClick={onClick}
    >
      <div className={styles.resultIcon}>
        <Icon size={14} />
      </div>
      <div className={styles.resultBody}>
        <span className={styles.resultTitle}>{item.name}</span>
        <div className={styles.resultMeta}>
          <span className={styles.resultLevel}>{item.agent_type}</span>
          {item.authorized_form && item.authorized_form !== item.name && (
            <>
              <span className={styles.resultSep}>·</span>
              <span className={styles.resultRef}>{item.authorized_form}</span>
            </>
          )}
          {(item.date_from || item.date_to) && (
            <>
              <span className={styles.resultSep}>·</span>
              <span>{item.date_from ?? '?'}{item.date_to ? `–${item.date_to}` : ''}</span>
            </>
          )}
        </div>
      </div>
      <span className={styles.resultType}>Agent</span>
    </button>
  )
}

// ─── Main search component ────────────────────────────────────────────

interface GlobalSearchProps {
  onClose: () => void
}

export function GlobalSearchModal({ onClose }: GlobalSearchProps) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const { data, isFetching } = useQuery({
    queryKey: ['global-search', q],
    queryFn: () => searchApi.quick(q).then(r => r.data.data),
    enabled: q.trim().length >= 2,
    staleTime: 10_000,
  })

  const nodes: any[] = data?.nodes ?? []
  const agents: any[] = data?.agents ?? []
  const allResults = [
    ...nodes.map(n => ({ ...n, _type: 'node' })),
    ...agents.map(a => ({ ...a, _type: 'agent' })),
  ]

  const handleSelect = useCallback((item: any) => {
    if (item._type === 'node') {
      navigate('/app/resources', { state: { selectNodeId: item.id } })
    } else {
      navigate('/app/agents', { state: { selectAgentId: item.id } })
    }
    onClose()
  }, [navigate, onClose])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx(i => Math.min(i + 1, allResults.length - 1))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx(i => Math.max(i - 1, 0))
      }
      if (e.key === 'Enter' && allResults[activeIdx]) {
        handleSelect(allResults[activeIdx])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [allResults, activeIdx, handleSelect, onClose])

  // Reset active index when results change
  useEffect(() => setActiveIdx(0), [q])

  const showEmpty = q.length >= 2 && !isFetching && allResults.length === 0
  const showResults = allResults.length > 0

  let globalIdx = 0

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        {/* Search input */}
        <div className={styles.inputRow}>
          <Search size={16} className={styles.searchIcon} />
          <input
            ref={inputRef}
            className={styles.input}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search resources and agents…"
            autoComplete="off"
            spellCheck={false}
          />
          {isFetching && <div className={styles.spinner} />}
          {q && <button className={styles.clearBtn} onClick={() => setQ('')}><X size={14} /></button>}
        </div>

        {/* Results */}
        <div className={styles.results}>
          {!q && (
            <div className={styles.hint}>
              Start typing to search across resources and agents
            </div>
          )}
          {q.length === 1 && (
            <div className={styles.hint}>Type at least 2 characters…</div>
          )}
          {showEmpty && (
            <div className={styles.empty}>No results for <strong>{q}</strong></div>
          )}

          {showResults && (
            <>
              {nodes.length > 0 && (
                <div className={styles.group}>
                  <div className={styles.groupLabel}>Resources</div>
                  {nodes.map(item => {
                    const idx = globalIdx++
                    return (
                      <NodeResult
                        key={item.id}
                        item={item}
                        active={activeIdx === idx}
                        onClick={() => handleSelect({ ...item, _type: 'node' })}
                      />
                    )
                  })}
                </div>
              )}
              {agents.length > 0 && (
                <div className={styles.group}>
                  <div className={styles.groupLabel}>Agents</div>
                  {agents.map(item => {
                    const idx = globalIdx++
                    return (
                      <AgentResult
                        key={item.id}
                        item={item}
                        active={activeIdx === idx}
                        onClick={() => handleSelect({ ...item, _type: 'agent' })}
                      />
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
          {q && allResults.length > 0 && (
            <a
              href={`/app/search?q=${encodeURIComponent(q)}`}
              className={styles.seeAll}
              onClick={onClose}
            >
              See all results →
            </a>
          )}
          {data?.engine && (
            <span className={styles.engineBadge}>{data.engine}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Trigger button (in topbar) ───────────────────────────────────────

export function SearchTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button className={styles.trigger} onClick={onClick}>
      <Search size={14} />
      <span className={styles.triggerText}>Search…</span>
      <div className={styles.triggerKbd}>
        <Command size={10} />
        <span>K</span>
      </div>
    </button>
  )
}