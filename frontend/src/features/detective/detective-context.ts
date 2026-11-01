import { createContext, useContext } from 'react'
import type { Profile } from '@/shared/api'
import type { DetectiveSession } from './sessions'
import type { ContestReferenceValue } from './contest-reference'
import type { VerificationOptions } from './verification-contracts'

export interface ProfileRequest {
  conversationId: string
  question: string
  verification?: VerificationOptions
  contest?: ContestReferenceValue | null
}

interface DetectiveStore {
  profileRequest: ProfileRequest | null
  resumeWithProfile: (profile: Profile) => string | null
  sessions: DetectiveSession[]
  loading: boolean
  storageError: boolean
  reload: () => Promise<void>
  send: (
    question: string,
    profile?: Profile | null,
    sessionId?: string,
    verificationOptions?: VerificationOptions,
    contest?: ContestReferenceValue | null,
  ) => string | null
  stop: (sessionId: string) => void
  retry: (turnId: string) => void
}
export const DetectiveContext = createContext<DetectiveStore | null>(null)

export function useDetective() {
  const context = useContext(DetectiveContext)
  if (!context) throw new Error('DetectiveProvider is required')
  return context
}
