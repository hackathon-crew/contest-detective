import { createContext, useContext } from 'react'
import type { Profile } from '@/shared/api'
import type { DetectiveSession } from './sessions'
import type { VerificationOptions } from './verification-contracts'

interface DetectiveStore {
  sessions: DetectiveSession[]
  storageError: boolean
  send: (
    question: string,
    profile?: Profile | null,
    sessionId?: string,
    verificationOptions?: VerificationOptions,
  ) => string
  stop: (sessionId: string) => void
  retry: (turnId: string) => void
}
export const DetectiveContext = createContext<DetectiveStore | null>(null)

export function useDetective() {
  const context = useContext(DetectiveContext)
  if (!context) throw new Error('DetectiveProvider is required')
  return context
}
