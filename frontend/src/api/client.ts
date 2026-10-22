import axios from 'axios'
import i18n from '@/i18n'

export const TASKS_STARTED_EVENT = 'background-tasks-started'

export interface StartedTask {
  id: string
  task_type: string
}

const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

const MAX_LISTED_WARNINGS = 10

function showServerWarnings(warnings: string[]) {
  const listed = warnings.slice(0, MAX_LISTED_WARNINGS)
  const rest = warnings.length - listed.length
  const lines = [
    i18n.t('common.savedWithWarnings', { count: warnings.length }),
    '',
    ...listed.map(w => `• ${w}`),
  ]
  if (rest > 0) lines.push(i18n.t('common.moreWarnings', { count: rest }))
  setTimeout(() => alert(lines.join('\n')), 0)
}

api.interceptors.response.use(
  (res) => {
    const warnings = res.data?.warnings
    if (Array.isArray(warnings) && warnings.length) showServerWarnings(warnings)

    const tasks = res.data?.tasks
    if (Array.isArray(tasks) && tasks.length) {
      window.dispatchEvent(new CustomEvent<StartedTask[]>(TASKS_STARTED_EVENT, { detail: tasks }))
    }
    return res
  },
  (err) => {
    if (err.response?.status === 401) {
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api