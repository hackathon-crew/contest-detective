import { useQuery } from '@tanstack/react-query'
import { getContest, listContests, type ContestFilters } from './api'
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
