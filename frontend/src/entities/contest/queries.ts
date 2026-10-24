import { useQuery } from '@tanstack/react-query'
import { loadContestLibrary } from './collection'
import { getContest, listContests, type ContestFilters } from './api'
import type { LibraryContest } from './library'
export function useContests(query: ContestFilters = {}) {
  return useQuery({ queryKey: ['contests', query], queryFn: () => listContests(query) })
}
export function useContest(id: string, enabled = true) {
  return useQuery({
    queryKey: ['contest', id],
    queryFn: () => getContest(id),
    enabled: Boolean(id) && enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}
export function useContestLibrary() {
  return useQuery<LibraryContest[]>({
    queryKey: ['contest-library'],
    queryFn: loadContestLibrary,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}
