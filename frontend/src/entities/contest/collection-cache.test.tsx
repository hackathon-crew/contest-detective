// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { useContestLibrary } from './queries'

const items = ['one', 'two'].map((id) => ({
  id,
  name: id,
  cover_url: null,
  status: 'upcoming',
  fields: { city: { value: 'Shanghai', level: 'official', sources: [] } },
}))
const clients: QueryClient[] = []
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}
function cacheStorage() {
  let saved: Response | undefined
  vi.stubGlobal('caches', {
    open: async () => ({
      match: async () => saved?.clone(),
      put: async (_key: unknown, response: Response) => {
        saved = response.clone()
      },
    }),
  })
  return {
    read: () => saved?.clone(),
    replace: (response: Response) => {
      saved = response
    },
  }
}
function envelope(data = items, total = data.length, page = 1) {
  return Response.json({ code: 200, message: 'ok', data, total, page, page_size: 100 })
}
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})

it('restores the complete snapshot in a new client while a refresh is pending or failing', async () => {
  const storage = cacheStorage()
  vi.stubGlobal('fetch', async () => envelope())
  const first = renderHook(() => useContestLibrary(), { wrapper: wrapper() })
  await waitFor(() => expect(first.result.current.data).toHaveLength(2))
  await waitFor(() => expect(storage.read()).toBeDefined())
  first.unmount()
  let fail!: (response: Response) => void
  vi.stubGlobal(
    'fetch',
    () =>
      new Promise<Response>((resolve) => {
        fail = resolve
      }),
  )
  const second = renderHook(() => useContestLibrary(), { wrapper: wrapper() })
  await waitFor(() =>
    expect(second.result.current.data?.map((item) => item.id)).toEqual(['one', 'two']),
  )
  expect(second.result.current.isFetching).toBe(true)
  await act(async () => {
    fail(Response.json({ code: 503, message: 'refresh failed', data: null }, { status: 503 }))
  })
  await waitFor(() => expect(second.result.current.isError).toBe(true))
  expect(second.result.current.data?.map((item) => item.id)).toEqual(['one', 'two'])
  expect((await storage.read()!.json()).collection.items).toHaveLength(2)
  vi.stubGlobal('fetch', async () => envelope([items[1]!]))
  await act(async () => {
    await second.result.current.refetch()
  })
  await waitFor(() => expect(second.result.current.data?.map((item) => item.id)).toEqual(['two']))
  await waitFor(async () => expect((await storage.read()!.json()).collection.items).toHaveLength(1))
})

it('keeps a full snapshot during a partial refresh and never replaces it with a failed page', async () => {
  const storage = cacheStorage()
  vi.stubGlobal('fetch', async () => envelope())
  const first = renderHook(() => useContestLibrary(), { wrapper: wrapper() })
  await waitFor(() => expect(storage.read()).toBeDefined())
  first.unmount()
  let fail!: (response: Response) => void
  vi.stubGlobal('fetch', async (input: string) => {
    if (new URL(input, 'https://example.com').searchParams.get('page') === '2')
      return new Promise<Response>((resolve) => {
        fail = resolve
      })
    return envelope([items[0]!], 101)
  })
  const second = renderHook(() => useContestLibrary(), { wrapper: wrapper() })
  await waitFor(() => expect(fail).toBeTypeOf('function'))
  expect(second.result.current.data).toHaveLength(2)
  await act(async () => {
    fail(Response.json({ code: 503, message: 'failed', data: null }, { status: 503 }))
  })
  await waitFor(() => expect(second.result.current.isError).toBe(true))
  expect(second.result.current.data).toHaveLength(2)
  expect((await storage.read()!.json()).collection.items).toHaveLength(2)
})

it.each(['expired', 'version', 'malformed', 'invalid-fields', 'incomplete'])(
  'ignores a %s snapshot and loads from the network',
  async (kind) => {
    const storage = cacheStorage()
    vi.stubGlobal('fetch', async () => envelope())
    const first = renderHook(() => useContestLibrary(), { wrapper: wrapper() })
    await waitFor(() => expect(storage.read()).toBeDefined())
    const value = await storage.read()!.json()
    first.unmount()
    if (kind === 'expired') value.savedAt = Date.now() - 25 * 60 * 60 * 1000
    if (kind === 'version') value.version = -1
    if (kind === 'invalid-fields') value.collection.items[0].fields = null
    if (kind === 'incomplete') value.collection.total = 100
    storage.replace(kind === 'malformed' ? new Response('broken') : Response.json(value))
    let finish!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    const second = renderHook(() => useContestLibrary(), { wrapper: wrapper() })
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(second.result.current.data).toBeUndefined()
    await act(async () => {
      finish(envelope([items[1]!]))
    })
    await waitFor(() => expect(second.result.current.data?.map((item) => item.id)).toEqual(['two']))
  },
)

it('loads normally when browser storage cannot be opened or written', async () => {
  vi.stubGlobal('caches', {
    open: async () => {
      throw new Error('storage disabled')
    },
  })
  vi.stubGlobal('fetch', async () => envelope())
  const { result } = renderHook(() => useContestLibrary(), { wrapper: wrapper() })
  await waitFor(() => expect(result.current.data).toHaveLength(2))
  expect(result.current.isError).toBe(false)
})

it('keeps first-visit partial data on failure without persisting an incomplete collection', async () => {
  const storage = cacheStorage()
  vi.stubGlobal('fetch', async (input: string) =>
    new URL(input, 'https://example.com').searchParams.get('page') === '2'
      ? Response.json({ code: 503, message: 'failed', data: null }, { status: 503 })
      : envelope([items[0]!], 101),
  )
  const { result } = renderHook(() => useContestLibrary(), { wrapper: wrapper() })
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.data?.map((item) => item.id)).toEqual(['one'])
  expect(storage.read()).toBeUndefined()
})

it('does not turn a successful fetch into an error when storage is full', async () => {
  vi.stubGlobal('caches', {
    open: async () => ({
      match: async () => undefined,
      put: async () => {
        throw new Error('quota exceeded')
      },
    }),
  })
  vi.stubGlobal('fetch', async () => envelope())
  const { result } = renderHook(() => useContestLibrary(), { wrapper: wrapper() })
  await waitFor(() => expect(result.current.isFetching).toBe(false))
  expect(result.current.data).toHaveLength(2)
  expect(result.current.isError).toBe(false)
})
