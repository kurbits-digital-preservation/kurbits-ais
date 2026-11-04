import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { authApi } from '@/api'
import { useAuthStore } from '@/store/auth'
import { useAuthConfig } from '@/hooks/useAuthConfig'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import styles from './LoginPage.module.css'

const SSO_ERROR_KEYS = ['saml_failed', 'saml_missing_attribute', 'saml_email_conflict', 'account_disabled']

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { setUser } = useAuthStore()
  const { t } = useTranslation()
  const { ssoEnabled, ssoLoginUrl, isLoading: configLoading } = useAuthConfig()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const ssoErrorCode = searchParams.get('error')
  const ssoError = ssoErrorCode && SSO_ERROR_KEYS.includes(ssoErrorCode)
    ? t(`login.errors.${ssoErrorCode}`)
    : ''

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await authApi.login(email, password)
      setUser(res.data.data)
      navigate('/app/resources')
    } catch (err: any) {
      setError(err.response?.data?.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleSso = () => {
    if (!ssoLoginUrl) return
    setLoading(true)
    window.location.href = ssoLoginUrl
  }

  return (
    <div className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <img src="/kurbits.png" alt="Kurbits" className={styles.logo} />
          <p className={styles.tagline}>{t('app.tagline')}</p>
        </div>

        {configLoading ? null : ssoEnabled ? (
          <div className={styles.form}>
            {ssoError && <div className={styles.error}>{ssoError}</div>}
            <button
              type="button"
              className={`btn btn-primary ${styles.submitBtn}`}
              onClick={handleSso}
              disabled={loading}
              autoFocus
            >
              <LogIn size={15} />
              {loading ? t('login.signingIn') : t('login.ssoSignIn')}
            </button>
            <p className="form-hint" style={{ textAlign: 'center' }}>{t('login.ssoHint')}</p>
          </div>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            {error && <div className={styles.error}>{error}</div>}

            <div className="form-group">
              <label htmlFor="email">{t('login.email')}</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="archivist@institution.org"
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">{t('login.password')}</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              className={`btn btn-primary ${styles.submitBtn}`}
              disabled={loading}
            >
              {loading ? t('login.signingIn') : t('login.signIn')}
            </button>
          </form>
        )}
      </div>
      <div className={styles.decoration} aria-hidden="true" />
    </div>
  )
}