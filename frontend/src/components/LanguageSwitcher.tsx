import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Languages, ChevronDown } from 'lucide-react'
import { LANGUAGES } from '@/i18n'
import styles from './LanguageSwitcher.module.css'

export default function LanguageSwitcher() {
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)

  const current = LANGUAGES.find(l => l.code === i18n.resolvedLanguage) ?? LANGUAGES[0]

  const choose = (code: string) => {
    i18n.changeLanguage(code)
    setOpen(false)
  }

  return (
    <div className={styles.wrap}>
      <button className={styles.btn} onClick={() => setOpen(v => !v)} title="Language">
        <Languages size={13} />
        <span className={styles.code}>{current.code.toUpperCase()}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} />
          <div className={styles.menu}>
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                className={`${styles.option} ${l.code === current.code ? styles.active : ''}`}
                onClick={() => choose(l.code)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
