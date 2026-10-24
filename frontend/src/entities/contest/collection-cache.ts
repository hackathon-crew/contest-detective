import type { ContestSummary } from './api'
import type { ContestCollection } from './collection'

const cacheName = 'inkpaw-public-contests-v1'
const snapshotKey = '/api/contests?inkpaw_snapshot=1'
const maxAge = 24 * 60 * 60 * 1000

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function citations(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        record(item) &&
        typeof item.url === 'string' &&
        typeof item.excerpt === 'string' &&
        typeof item.content_hash === 'string',
    )
  )
}
function sources(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (item) =>
          record(item) &&
          ['url', 'title', 'site', 'value', 'excerpt'].every(
            (key) => typeof item[key] === 'string',
          ) &&
          typeof item.is_official === 'boolean',
      ))
  )
}
function contest(value: unknown): value is ContestSummary {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !(value.cover_url === null || typeof value.cover_url === 'string') ||
    !['upcoming', 'ongoing', 'ended'].includes(String(value.status)) ||
    !record(value.fields)
  )
    return false
  if (
    !Object.values(value.fields).every(
      (field) =>
        record(field) &&
        (field.value === null || typeof field.value === 'string') &&
        ['official', 'reposted', 'conflict', 'not_found'].includes(String(field.level)) &&
        (field.precision === undefined ||
          field.precision === 'day' ||
          field.precision === 'datetime') &&
        sources(field.sources),
    )
  )
    return false
  if (
    value.themes !== undefined &&
    (!Array.isArray(value.themes) || !value.themes.every((theme) => typeof theme === 'string'))
  )
    return false
  if (!sources(value.theme_sources)) return false
  if (
    value.introduction !== undefined &&
    value.introduction !== null &&
    (!record(value.introduction) ||
      typeof value.introduction.text !== 'string' ||
      !citations(value.introduction.citations))
  )
    return false
  return true
}

/** 只持久化完整的公开列表。Cache Storage 异步读写，避免数 MB JSON 占用 localStorage。 */
export async function readContestSnapshot(): Promise<ContestCollection | undefined> {
  try {
    if (typeof caches === 'undefined') return
    const response = await (await caches.open(cacheName)).match(snapshotKey)
    if (!response) return
    const value: unknown = await response.json()
    if (
      !record(value) ||
      value.version !== 1 ||
      typeof value.savedAt !== 'number' ||
      !Number.isFinite(value.savedAt) ||
      value.savedAt > Date.now() ||
      Date.now() - value.savedAt > maxAge
    )
      return
    const collection = value.collection
    if (
      !record(collection) ||
      collection.complete !== true ||
      !Array.isArray(collection.items) ||
      !Number.isInteger(collection.total) ||
      collection.total !== collection.items.length ||
      !collection.items.every(contest) ||
      new Set(collection.items.map((item) => item.id)).size !== collection.total
    )
      return
    return collection as unknown as ContestCollection
  } catch {
    // 浏览器禁用存储、过期结构或损坏 JSON 时仍从网络读取。
    return
  }
}

export async function writeContestSnapshot(collection: ContestCollection): Promise<void> {
  if (!collection.complete || collection.items.length !== collection.total) return
  try {
    if (typeof caches === 'undefined') return
    const cache = await caches.open(cacheName)
    await cache.put(snapshotKey, Response.json({ version: 1, savedAt: Date.now(), collection }))
  } catch {
    // 存储不可用不影响本次成功的网络结果。
  }
}
