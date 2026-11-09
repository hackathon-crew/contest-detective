import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { defaultLocale, type Locale } from '.'
import {
  LocaleContext,
  PreferenceContext,
  translation,
  type LanguagePreference,
} from './locale-context'

const preferenceKey = 'contest-detective.language'

function browserLocale(): Locale {
  for (const language of navigator.languages) {
    const base = language.toLowerCase().split('-')[0]
    if (base === 'en') return 'en'
    if (base === 'zh') return defaultLocale
  }
  return defaultLocale
}

function readPreference(): LanguagePreference {
  try {
    const value = localStorage.getItem(preferenceKey)
    if (value === 'en' || value === defaultLocale) return value
  } catch {
    // Browser storage can be unavailable in a restricted session.
  }
  return 'browser'
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(readPreference)
  const [browser, setBrowser] = useState(browserLocale)
  const locale = preference === 'browser' ? browser : preference
  const copy = useMemo(() => translation(locale), [locale])
  const choose = useCallback((value: LanguagePreference) => {
    setPreference(value)
    try {
      if (value === 'browser') localStorage.removeItem(preferenceKey)
      else localStorage.setItem(preferenceKey, value)
    } catch {
      // The selected language still applies until the page is closed.
    }
  }, [])
  useEffect(() => {
    function onLanguageChange() {
      setBrowser(browserLocale())
    }
    function onStorage(event: StorageEvent) {
      if (event.key === preferenceKey || event.key === null) setPreference(readPreference())
    }
    window.addEventListener('languagechange', onLanguageChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('languagechange', onLanguageChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  useEffect(() => {
    document.documentElement.lang = copy.locale
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', copy.t('黑客松清单，每个关键日期都追到主办方原文核对。'))
  }, [copy])
  const setting = useMemo(() => ({ preference, choose }), [preference, choose])
  return (
    <LocaleContext.Provider value={copy}>
      <PreferenceContext.Provider value={setting}>{children}</PreferenceContext.Provider>
    </LocaleContext.Provider>
  )
}
