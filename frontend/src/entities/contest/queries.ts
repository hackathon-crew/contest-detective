import { useQuery, useQueryClient } from '@tanstack/react-query'
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
  })
}
export function useContestLibrary() {
  const client = useQueryClient()
  return useQuery<LibraryContest[]>({
    queryKey: ['contest-library'],
    queryFn: () =>
      loadContestLibrary(
        (detail) => client.setQueryData(['contest', detail.id], detail),
        (items) => client.setQueryData(['contest-library'], items),
      ),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}
