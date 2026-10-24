import { useQuery, useQueryClient } from '@tanstack/react-query'
import { loadContestCollection, type ContestCollection } from './collection'
import { readContestSnapshot, writeContestSnapshot } from './collection-cache'
import { getContest, listContests, type ContestFilters } from './api'
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
const collectionKey = ['contests', 'collection'] as const

export function useContestCollection(enabled = true) {
  const client = useQueryClient()
  return useQuery<ContestCollection>({
    queryKey: collectionKey,
    queryFn: async ({ signal }) => {
      if (!client.getQueryData(collectionKey)) {
        const saved = await readContestSnapshot()
        signal.throwIfAborted()
        if (saved) client.setQueryData(collectionKey, saved)
      }
      const previous = client.getQueryData<ContestCollection>(collectionKey)
      const collection = await loadContestCollection(
        {},
        {
          signal,
          onProgress: (batch) => {
            // 刷新时保留完整旧列表，避免先缩成一页或混入已删除的赛事。
            if (!previous?.complete) client.setQueryData(collectionKey, batch)
          },
        },
      )
      signal.throwIfAborted()
      void writeContestSnapshot(collection)
      return collection
    },
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}

export function useContestLibrary() {
  const query = useContestCollection()
  return { ...query, data: query.data?.items, complete: query.data?.complete ?? false }
}
