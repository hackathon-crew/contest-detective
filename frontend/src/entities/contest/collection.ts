import { listContests, type ContestFilters, type ContestSummary } from './api'

export async function loadContestCollection(
  query: Omit<ContestFilters, 'page' | 'page_size'> = {},
): Promise<{ items: ContestSummary[]; total: number }> {
  if (query.ids && !query.ids.length) return { items: [], total: 0 }
  const items = new Map<string, ContestSummary>()
  let total = 0
  for (let page = 1; ; page += 1) {
    const batch = await listContests({ ...query, page, page_size: 100 })
    total = batch.total
    for (const item of batch.items) items.set(item.id, item)
    if (!batch.items.length || page * 100 >= batch.total) break
  }
  return { items: [...items.values()], total }
}

export async function listAllContests(query: Omit<ContestFilters, 'page' | 'page_size'> = {}) {
  return (await loadContestCollection(query)).items
}

/** 赛事库只加载轻量列表；原文和详细证据在打开单场赛事时读取。 */
export function loadContestLibrary(): Promise<ContestSummary[]> {
  return listAllContests()
}
