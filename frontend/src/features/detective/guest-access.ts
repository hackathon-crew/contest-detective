import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api'
import type { GuestQuestionQuota } from '@/shared/api/generated'

export const guestQuotaKey = ['guest-quota'] as const

export function useGuestQuota(enabled: boolean) {
  return useQuery({
    queryKey: guestQuotaKey,
    queryFn: ({ signal }) =>
      apiClient.request<GuestQuestionQuota>('/agent/guest-quota', { signal }),
    enabled,
  })
}
