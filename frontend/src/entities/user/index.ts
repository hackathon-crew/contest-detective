import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate, type Location } from 'react-router'
import { apiClient } from '@/shared/api'
import type { PublicUser } from '@/shared/api/generated'

export type { PublicUser } from '@/shared/api/generated'
export const currentUserKey = ['current-user'] as const

export interface PersonalIntent {
  question?: string
  profileSection?: 'all' | 'github' | 'profile' | 'filters'
}

export function personalIntent(location: Location): PersonalIntent {
  return location.state?.personalIntent ?? {}
}

export function loginReturn(location: Location, intent: PersonalIntent = {}) {
  return {
    returnTo: {
      ...location,
      state: { ...location.state, personalIntent: { ...personalIntent(location), ...intent } },
    },
  }
}

export function useLoginGate() {
  const { data: user } = useCurrentUser()
  const location = useLocation()
  const navigate = useNavigate()
  return (intent?: PersonalIntent) => {
    if (user) return true
    navigate('/login', { state: loginReturn(location, intent) })
    return false
  }
}

export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserKey,
    queryFn: ({ signal }) => apiClient.request<PublicUser | null>('/auth/me', { signal }),
    staleTime: 60_000,
  })
}
