import { useState } from 'react'
import { Building2, LogOut, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '@/api'
import { useAuthStore } from '@/store/auth'
import styles from './InstitutionPicker.module.css'

export default function InstitutionPicker() {
  const { user, setUser, logout } = useAuthStore()
  const navigate = useNavigate()
  const [loading, setLoading] = useState<number | null>(null)
  const [error, setError] = useState('')

  const handleSelect = async (institutionId: number) => {
    setLoading(institutionId)
    setError('')
    try {
      const res = await authApi.switchInstitution(institutionId)
      setUser(res.data.data)
      navigate('/app/resources')
    } catch {
      setError('Failed to select institution. Please try again.')
      setLoading(null)
    }
  }

  const handleLogout = async () => {
    await authApi.logout()
    logout()
    navigate('/login')
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.wordmark}>Kurbits</span>
          <p className={styles.welcome}>Welcome, {user?.username}</p>
          <p className={styles.subtitle}>Select an institution to continue</p>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.list}>
          {user?.institutions.length === 0 && (
            <div className={styles.empty}>
              <Building2 size={28} />
              <p>You are not a member of any institution yet.</p>
              <p className={styles.emptyHint}>Contact a system administrator to be added.</p>
            </div>
          )}
          {user?.institutions.map(inst => (
            <button
              key={inst.id}
              className={styles.item}
              onClick={() => handleSelect(inst.id)}
              disabled={loading !== null}
            >
              <div className={styles.itemIcon}>
                <Building2 size={18} />
              </div>
              <div className={styles.itemBody}>
                <span className={styles.itemName}>{inst.name}</span>
                <div className={styles.itemMeta}>
                  <span className={styles.itemRef}>{inst.ref_prefix}</span>
                  <span className={styles.itemRole}>{inst.role}</span>
                </div>
              </div>
              <div className={styles.itemArrow}>
                {loading === inst.id
                  ? <span className={styles.spinner} />
                  : <ChevronRight size={16} />
                }
              </div>
            </button>
          ))}
        </div>

        <button className={styles.logoutBtn} onClick={handleLogout}>
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </div>
  )
}