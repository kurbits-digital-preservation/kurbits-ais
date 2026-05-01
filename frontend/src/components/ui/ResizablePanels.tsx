import { useState, useCallback, useRef, type ReactNode } from 'react'
import styles from './ResizablePanels.module.css'

interface ResizablePanelsProps {
  left: ReactNode
  right: ReactNode
  defaultLeftWidth?: number   // px
  minLeftWidth?: number
  maxLeftWidth?: number
}

export default function ResizablePanels({
  left,
  right,
  defaultLeftWidth = 300,
  minLeftWidth = 200,
  maxLeftWidth = 600,
}: ResizablePanelsProps) {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startWidth.current = leftWidth

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const delta = ev.clientX - startX.current
      const next = Math.min(maxLeftWidth, Math.max(minLeftWidth, startWidth.current + delta))
      setLeftWidth(next)
    }

    const onUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [leftWidth, minLeftWidth, maxLeftWidth])

  return (
    <div className={styles.container}>
      <div className={styles.left} style={{ width: leftWidth, minWidth: leftWidth }}>
        {left}
      </div>
      <div
        className={styles.handle}
        onMouseDown={onMouseDown}
        title="Drag to resize"
      >
        <div className={styles.handleBar} />
      </div>
      <div className={styles.right}>
        {right}
      </div>
    </div>
  )
}