import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './locales/en.json'
import sv from './locales/sv.json'

// Default language is English; users can switch to Swedish. The choice is
// persisted to localStorage and reused on the next visit.
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      sv: { translation: sv },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'sv'],
    interpolation: { escapeValue: false },   // React already escapes
    detection: {
      // Prefer an explicit saved choice; otherwise fall back to English
      // (not the browser language) per product decision.
      order: ['localStorage'],
      lookupLocalStorage: 'kurbits_lang',
      caches: ['localStorage'],
    },
  })

export default i18n
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'sv', label: 'Svenska' },
]
