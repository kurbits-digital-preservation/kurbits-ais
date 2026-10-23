import { useState, useCallback, useRef, type ReactNode } from 'react'
import styles from './ResizablePanels.module.css'

interface ResizablePanelsProps {
  left: ReactNode
  right: ReactNode
  defaultLeftWidth?: number   // px
  minLeftWidth?: number
  maxLeftWidth?: number
  storageKey?: string         // remembers the width in localStorage when set
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function readStoredWidth(key: string | undefined): number | null {
  if (!key) return null
  try {
    const raw = window.localStorage.getItem(key)
    const value = raw ? parseInt(raw, 10) : NaN
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function writeStoredWidth(key: string | undefined, width: number | null) {
  if (!key) return
  try {
    if (width === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, String(Math.round(width)))
  } catch {
    // storage unavailable — the width just won't be remembered
  }
}

export default function ResizablePanels({
  left,
  right,
  defaultLeftWidth = 300,
  minLeftWidth = 200,
  maxLeftWidth = 600,
  storageKey,
}: ResizablePanelsProps) {
  const [leftWidth, setLeftWidth] = useState(() =>
    clamp(readStoredWidth(storageKey) ?? defaultLeftWidth, minLeftWidth, maxLeftWidth)
  )
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)
  const latestWidth = useRef(leftWidth)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startWidth.current = leftWidth

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const delta = ev.clientX - startX.current
      const next = clamp(startWidth.current + delta, minLeftWidth, maxLeftWidth)
      latestWidth.current = next
      setLeftWidth(next)
    }

    const onUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      writeStoredWidth(storageKey, latestWidth.current)
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [leftWidth, minLeftWidth, maxLeftWidth, storageKey])

  const onDoubleClick = useCallback(() => {
    const reset = clamp(defaultLeftWidth, minLeftWidth, maxLeftWidth)
    latestWidth.current = reset
    setLeftWidth(reset)
    writeStoredWidth(storageKey, null)
  }, [defaultLeftWidth, minLeftWidth, maxLeftWidth, storageKey])

  return (
    <div className={styles.container}>
      <div className={styles.left} style={{ width: leftWidth, minWidth: leftWidth }}>
        {left}
      </div>
      <div
        className={styles.handle}
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        title="Drag to resize · double-click to reset"
      >
        <div className={styles.handleBar} />
      </div>
      <div className={styles.right}>
        {right}
      </div>
    </div>
  )
}