import {
  getContest,
  listContests,
  type ContestDetail,
  type ContestFilters,
  type ContestSummary,
} from './api'

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

/** 列表尚不返回摘要和出处；限定六个并发补齐，成功详情交给调用方复用。 */
export async function loadContestLibrary(
  onDetail?: (detail: ContestDetail) => void,
  onList?: (items: ContestSummary[]) => void,
) {
  const items = await listAllContests()
  onList?.(items)
  const details: ContestDetail[] = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(6, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++
        const detail = await getContest(items[index]!.id)
        details[index] = detail
        onDetail?.(detail)
      }
    }),
  )
  return details
}
