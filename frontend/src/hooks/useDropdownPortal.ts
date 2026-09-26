import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface Position {
  top: number
  left: number
  width: number
}

export function useDropdownPortal() {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Position>({ top: 0, left: 0, width: 0 })

  const openDropdown = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({
        top:   rect.bottom + window.scrollY + 4,
        left:  rect.right  + window.scrollX,
        width: rect.width,
      })
    }
    setOpen(true)
  }, [])

  const toggle = useCallback(() => {
    if (open) setOpen(false)
    else openDropdown()
  }, [open, openDropdown])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on scroll/resize
  useEffect(() => {
    if (!open) return
    const handler = () => setOpen(false)
    window.addEventListener('scroll', handler, true)
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('scroll', handler, true)
      window.removeEventListener('resize', handler)
    }
  }, [open])

  return { triggerRef, open, toggle, close: () => setOpen(false), pos, createPortal }
}