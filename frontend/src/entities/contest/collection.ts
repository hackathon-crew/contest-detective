import { listContests, type ContestFilters, type ContestSummary } from './api'

export async function listAllContests(
  query: Omit<ContestFilters, 'page' | 'page_size'> = {},
): Promise<ContestSummary[]> {
  if (query.ids && !query.ids.length) return []
  const items = new Map<string, ContestSummary>()
  for (let page = 1; ; page += 1) {
    const batch = await listContests({ ...query, page, page_size: 100 })
    for (const item of batch.items) items.set(item.id, item)
    if (!batch.items.length || page * 100 >= batch.total) break
  }
  return [...items.values()]
}
