import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  FolderOpen, Users, MapPin, Tag, ChevronDown,
  LogOut, Building2, Settings, Search, Flag, PackageOpen
} from 'lucide-react'
import { useAuthStore } from '@/store/auth'
import { authApi } from '@/api'
import styles from './AppLayout.module.css'
import { GlobalSearchModal, SearchTrigger } from './GlobalSearch'
import { Clock } from 'lucide-react'
import HistoryPopover from './HistoryPopover'

const NAV_ITEMS = [
  { to: '/app/resources',          icon: FolderOpen,  label: 'Resources' },
  { to: '/app/agents',             icon: Users,       label: 'Agents' },
  { to: '/app/locations',          icon: MapPin,      label: 'Locations' },
  { to: '/app/classifications',    icon: Tag,         label: 'Classifications' },
  { to: '/app/flags',              icon: Flag,        label: 'Flags' },
  { to: '/app/acquisitions',       icon: PackageOpen, label: 'Acquisitions' },
]

export default function AppLayout() {
  const { user, setUser, logout } = useAuthStore()
  const navigate = useNavigate()
  const [institutionMenuOpen, setInstitutionMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(v => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleLogout = async () => {
    await authApi.logout()
    logout()
    navigate('/login')
  }

  const handleSwitchInstitution = async (id: number) => {
    const res = await authApi.switchInstitution(id)
    setUser(res.data.data)
    setInstitutionMenuOpen(false)
    navigate('/app/resources')
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        {/* Left: wordmark + nav */}
        <div className={styles.topbarLeft}>
          <img src="/kurbits.png" alt="" className={styles.topbarLogo} aria-hidden="true" />
          <span className={styles.wordmark}>Kurbits</span>

          <nav className={styles.topbarNav}>
            {NAV_ITEMS.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end
                className={({ isActive }) =>
                  `${styles.topbarNavItem} ${isActive ? styles.topbarNavItemActive : ''}`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <NavLink
            to="/app/search"
            className={({ isActive }) =>
              `${styles.topbarNavItem} ${isActive ? styles.topbarNavItemActive : ''}`
            }
          >
            <Search size={14} />
            Search
          </NavLink>
        </div>

        {/* Right: institution + user */}
        <div className={styles.topbarRight}>
          {(user?.institutions?.length ?? 0) > 0 && (
            <div className={styles.institutionSwitcher}>
              <button
                className={styles.institutionBtn}
                onClick={() => setInstitutionMenuOpen(!institutionMenuOpen)}
              >
                <Building2 size={13} />
                <span>{user!.active_institution?.name ?? 'Select institution'}</span>
                {user!.active_institution && (
                  <span className={styles.refPrefix}>{user!.active_institution!.ref_prefix}</span>
                )}
                <ChevronDown size={12} />
              </button>
              {institutionMenuOpen && (
                <>
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 199 }}
                    onClick={() => setInstitutionMenuOpen(false)}
                  />
                  <div className={styles.institutionMenu}>
                    {user!.institutions.map((inst) => (
                      <button
                        key={inst.id}
                        className={`${styles.institutionOption} ${inst.id === user!.active_institution?.id ? styles.active : ''}`}
                        onClick={() => handleSwitchInstitution(inst.id)}
                      >
                        <span className={styles.institutionOptionName}>{inst.name}</span>
                        <span className={styles.institutionOptionRole}>{inst.role}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
            <HistoryPopover />
          <NavLink
            to="/app/administration"
            className={({ isActive }) =>
              `${styles.topbarNavItem} ${isActive ? styles.topbarNavItemActive : ''}`
            }
            title="Administration"
          >
            <Settings size={14} />
          </NavLink>

          <span className={styles.username}>{user?.username}</span>
          <button className="btn btn-ghost btn-icon" onClick={handleLogout} title="Log out">
            <LogOut size={15} />
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>

      {searchOpen && <GlobalSearchModal onClose={() => setSearchOpen(false)} />}
    </div>
  )
}