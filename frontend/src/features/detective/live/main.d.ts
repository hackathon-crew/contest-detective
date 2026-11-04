import type { DetectiveTurn } from '../conversation'
import type { LiveCard } from './model'
export interface LiveSnapshot {
  textHref: string
  turn?: DetectiveTurn
  cards: LiveCard[]
  album: LiveCard[]
  loggedIn: boolean
  remaining?: number
  watching: string[]
  ticket?: 'login' | 'profile'
}
export interface LiveCallbacks {
  submit: (text: string) => void
  stop: () => void
  collect: (contest: LiveCard['contest']) => void
  watch: (id: string) => Promise<boolean>
  login: (watchId?: string | null) => void
  profile: (section: 'github' | 'profile') => void
  dismissTicket: () => void
  text: () => void
}
export interface LiveHandle {
  update: (snapshot: LiveSnapshot) => void
  reopen: (id: string, card?: LiveCard) => Promise<void>
  stop: () => void
}
export function mountLive(
  root: HTMLElement,
  callbacks: LiveCallbacks,
  initial: LiveSnapshot,
): LiveHandle
