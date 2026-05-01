import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import { authApi } from '@/api'
import InstitutionPicker from './InstitutionPicker'

export default function AuthGuard() {
  const { user, isLoading, setUser, setLoading } = useAuthStore()

  useEffect(() => {
    if (user) { setLoading(false); return }
    authApi.me()
      .then(res => { setUser(res.data.data); setLoading(false) })
      .catch(() => { setLoading(false) })
  }, [])

  if (isLoading) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: 'var(--color-ink-faint)',
        fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)'
      }}>
        Kurbits
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  // Authenticated but no institution selected — show picker
  if (!user.active_institution) return <InstitutionPicker />

  return <Outlet />
}