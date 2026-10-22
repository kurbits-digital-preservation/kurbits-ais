import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tasksApi } from '@/api'
import { TASKS_STARTED_EVENT, type StartedTask } from '@/api/client'

const IDENTIFIER_TASK_TYPE = 'identifier_assignment'
const POLL_MS = 2000
const MAX_LISTED_WARNINGS = 10

export function useIdentifierAssignmentWatcher() {
  const queryClient = useQueryClient()
  const { i18n } = useTranslation()

  useEffect(() => {
    const active = new Set<string>()
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    let stopped = false

    const refresh = (result: any) => {
      for (const id of result?.node_ids ?? []) {
        queryClient.invalidateQueries({ queryKey: ['node-identifiers', id] })
        queryClient.invalidateQueries({ queryKey: ['node', id] })
      }
      for (const id of result?.agent_ids ?? []) {
        queryClient.invalidateQueries({ queryKey: ['agent-identifiers', id] })
        queryClient.invalidateQueries({ queryKey: ['agent', id] })
      }
    }

    const report = (task: any) => {
      if (task.status === 'error') {
        alert(i18n.t('identifiers.autoAssign.failed', { message: task.error_message ?? '' }))
        return
      }
      const warnings: string[] = task.result?.warnings ?? []
      const total: number = task.result?.warning_count ?? warnings.length
      if (!total) return
      const listed = warnings.slice(0, MAX_LISTED_WARNINGS)
      const lines = [
        i18n.t('identifiers.autoAssign.warnings', { count: total }),
        '',
        ...listed.map(w => `• ${w}`),
      ]
      if (total > listed.length) lines.push(i18n.t('common.moreWarnings', { count: total - listed.length }))
      alert(lines.join('\n'))
    }

    const schedule = (taskId: string) => {
      timers.set(taskId, setTimeout(() => poll(taskId), POLL_MS))
    }

    const poll = async (taskId: string) => {
      timers.delete(taskId)
      try {
        const res = await tasksApi.get(taskId)
        if (stopped) return
        const task = res.data.data
        if (task.status === 'done' || task.status === 'error') {
          active.delete(taskId)
          refresh(task.result)
          report(task)
          return
        }
        schedule(taskId)
      } catch {
        active.delete(taskId)
      }
    }

    const onStarted = (e: Event) => {
      const tasks = (e as CustomEvent<StartedTask[]>).detail ?? []
      for (const task of tasks) {
        if (task.task_type !== IDENTIFIER_TASK_TYPE || active.has(task.id)) continue
        active.add(task.id)
        schedule(task.id)
      }
    }

    window.addEventListener(TASKS_STARTED_EVENT, onStarted)
    return () => {
      stopped = true
      window.removeEventListener(TASKS_STARTED_EVENT, onStarted)
      timers.forEach(clearTimeout)
    }
  }, [queryClient, i18n])
}