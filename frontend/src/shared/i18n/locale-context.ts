import { createContext, useContext } from 'react'
import { defaultLocale, translate, type Locale } from '.'

export type LanguagePreference = Locale | 'browser'

export function translation(locale: Locale) {
  return { locale, t: translate.bind(null, locale) }
}

// Isolated components and design previews use the application's default copy.
export const LocaleContext = createContext(translation(defaultLocale))
export const PreferenceContext = createContext<{
  preference: LanguagePreference
  choose: (value: LanguagePreference) => void
} | null>(null)

export function useLocale() {
  return useContext(LocaleContext)
}

export function useLanguagePreference() {
  return useContext(PreferenceContext)
}
