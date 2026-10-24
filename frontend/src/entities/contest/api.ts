import { apiClient } from '@/shared/api'
import type { ContestDetail, ContestSummary } from '@/shared/api/generated'

export type {
  ContestDetail,
  ContestSummary,
  FieldValue,
  Source,
  ContentCitation,
  ContestIntroduction,
  CoverageObservation,
  ContentCoverage,
  PublicContestDocument,
} from '@/shared/api/generated'
export interface ContestFilters {
  keyword?: string
  status?: 'upcoming' | 'ongoing' | 'ended'
  mode?: 'online' | 'offline' | 'hybrid'
  date_from?: string
  date_to?: string
  ids?: string[]
  sort?: 'deadline' | 'start'
  page?: number
  page_size?: number
}
export function listContests(query: ContestFilters = {}) {
  return apiClient.requestList<ContestSummary>('/contests', {
    query: { ...query, ids: query.ids?.join(',') },
  })
}
export function getContest(id: string) {
  return apiClient.request<ContestDetail>(`/contests/${encodeURIComponent(id)}`)
}
