import styles from './ui.module.css'
import ResizablePanels from './ResizablePanels'
import type { ReactNode } from 'react'

// ─── PageShell ───────────────────────────────────────────────────────
// Two-panel layout: narrow list/tree on left, detail on right
interface PageShellProps {
  sidebar: ReactNode
  content: ReactNode
  defaultLeftWidth?: number
}
export function PageShell({ sidebar, content, defaultLeftWidth = 300 }: PageShellProps) {
  return (
    <ResizablePanels
      left={<div className={styles.pageShellSidebar}>{sidebar}</div>}
      right={<div className={styles.pageShellContent}>{content}</div>}
      defaultLeftWidth={defaultLeftWidth}
      minLeftWidth={200}
      maxLeftWidth={520}
    />
  )
}

// ─── SidebarPanel ────────────────────────────────────────────────────
interface SidebarPanelProps {
  title: string
  actions?: ReactNode
  children: ReactNode
}
export function SidebarPanel({ title, actions, children }: SidebarPanelProps) {
  return (
    <div className={styles.sidebarPanel}>
      <div className={styles.sidebarPanelHeader}>
        <h2 className={styles.sidebarPanelTitle}>{title}</h2>
        {actions && <div className={styles.sidebarPanelActions}>{actions}</div>}
      </div>
      <div className={styles.sidebarPanelBody}>{children}</div>
    </div>
  )
}

// ─── EmptyState ──────────────────────────────────────────────────────
interface EmptyStateProps {
  icon: ReactNode
  title: string
  subtitle?: string
  action?: ReactNode
}
export function EmptyState({ icon, title, subtitle, action }: EmptyStateProps) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyStateIcon}>{icon}</div>
      <p className={styles.emptyStateTitle}>{title}</p>
      {subtitle && <p className={styles.emptyStateSubtitle}>{subtitle}</p>}
      {action && <div className={styles.emptyStateAction}>{action}</div>}
    </div>
  )
}

// ─── Tabs ────────────────────────────────────────────────────────────
export interface TabDef {
  key: string
  icon: ReactNode
  label: string
}
interface TabsProps {
  tabs: TabDef[]
  active: string
  onChange: (key: string) => void
}
export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className={styles.tabs}>
      {tabs.map(tab => (
        <button
          key={tab.key}
          className={`${styles.tab} ${active === tab.key ? styles.tabActive : ''}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  )
}

// ─── FieldList ───────────────────────────────────────────────────────
interface FieldListProps {
  fields: Array<{ label: string; value: ReactNode | null | undefined }>
}
export function FieldList({ fields }: FieldListProps) {
  const populated = fields.filter(f => f.value != null && f.value !== '')
  if (!populated.length) return (
    <p className={styles.fieldListEmpty}>No details filled in yet.</p>
  )
  return (
    <dl className={styles.fieldList}>
      {populated.map(({ label, value }) => (
        <div key={label} className={styles.fieldItem}>
          <dt className={styles.fieldLabel}>{label}</dt>
          <dd className={styles.fieldValue}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ─── SearchInput ─────────────────────────────────────────────────────
interface SearchInputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}
export function SearchInput({ value, onChange, placeholder = 'Search…' }: SearchInputProps) {
  return (
    <div className={styles.searchWrap}>
      <svg className={styles.searchIcon} width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={styles.searchInput}
      />
    </div>
  )
}

// ─── Spinner ─────────────────────────────────────────────────────────
export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg
      className={styles.spinner}
      width={size} height={size}
      viewBox="0 0 24 24" fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.2"/>
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}

// ─── AgentTypeBadge / generic pill ───────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  person: 'var(--color-accent)',
  organization: 'var(--color-success)',
  family: '#6B5B8B',
  software: '#357A8B',
}
export function TypePill({ type }: { type: string }) {
  return (
    <span
      className={styles.typePill}
      style={{ '--pill-color': TYPE_COLORS[type] ?? 'var(--color-ink-muted)' } as React.CSSProperties}
    >
      {type}
    </span>
  )
}
export { default as PrintLabelsButton } from './PrintLabelsButton'