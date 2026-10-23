import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api'
import type { PublicUser } from '@/shared/api/generated'

export type { PublicUser } from '@/shared/api/generated'
export const currentUserKey = ['current-user'] as const

export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserKey,
    queryFn: ({ signal }) => apiClient.request<PublicUser | null>('/auth/me', { signal }),
    staleTime: 60_000,
  })
}
