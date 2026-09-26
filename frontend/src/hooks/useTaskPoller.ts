import { useEffect, useState, useRef } from 'react'
import { tasksApi } from '@/api'

interface Task {
  id: string
  task_type: string
  status: 'pending' | 'running' | 'done' | 'error'
  progress: number
  result: Record<string, any> | null
  error_message: string | null
}

export function useTaskPoller(taskId: string | null, onDone?: (task: Task) => void) {
  const [task, setTask] = useState<Task | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!taskId) return

    const poll = async () => {
      try {
        const res = await tasksApi.get(taskId)
        const t = res.data.data as Task
        setTask(t)
        if (t.status === 'done' || t.status === 'error') {
          if (intervalRef.current) clearInterval(intervalRef.current)
          if (t.status === 'done' && onDone) onDone(t)
        }
      } catch {
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    }

    poll()
    intervalRef.current = setInterval(poll, 3000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [taskId])

  return task
}