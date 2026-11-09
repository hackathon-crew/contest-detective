import { english } from './english'

export const defaultLocale = 'zh-CN'
export type Locale = typeof defaultLocale | 'en'
export type Message = keyof typeof english
type Values = Readonly<Record<string, string | number>>

export function translate(locale: Locale, message: Message, values?: Values): string {
  const text = locale === 'en' ? english[message] : message
  return values
    ? text.replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token))
    : text
}

// Older saved UI messages and API errors arrive as text. User content bypasses this lookup.
export function translateSystemText(locale: Locale, text: string): string {
  return locale === 'en' && Object.hasOwn(english, text) ? english[text as Message] : text
}
