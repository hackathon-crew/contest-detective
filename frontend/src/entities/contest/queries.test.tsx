// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { useContest, useContestCollection, useContestLibrary } from './queries'

const items = ['one', 'two'].map((id) => ({
  id,
  name: id,
  cover_url: null,
  fields: {},
  status: 'upcoming',
}))
const clients: QueryClient[] = []
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})

it('loads only summaries and retrieves an individual detail only when opened', async () => {
  const fetch = vi.fn(async (input: string) => {
    const pathname = new URL(input, 'https://example.com').pathname
    return Response.json({
      code: 200,
      message: 'ok',
      data: pathname === '/api/contests' ? items : { ...items[0], summary: '历史内容' },
      total: items.length,
      page: 1,
      page_size: 100,
    })
  })
  vi.stubGlobal('fetch', fetch)
  const { result, rerender } = renderHook(
    ({ open }) => ({ list: useContestLibrary(), detail: useContest('one', open) }),
    { wrapper: wrapper(), initialProps: { open: false } },
  )
  await waitFor(() => expect(result.current.list.isSuccess).toBe(true))
  expect(result.current.list.data).toEqual(items)
  expect(fetch).toHaveBeenCalledTimes(1)
  rerender({ open: true })
  await waitFor(() => expect(result.current.detail.isSuccess).toBe(true))
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls[1]?.[0]).toBe('/api/contests/one')
  rerender({ open: false })
  rerender({ open: true })
  expect(result.current.detail.data?.summary).toBe('历史内容')
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('keeps a detail failure isolated from the library and permits explicit retry', async () => {
  let failed = true
  const requests: string[] = []
  vi.stubGlobal('fetch', async (input: string) => {
    requests.push(input)
    const list = new URL(input, 'https://example.com').pathname === '/api/contests'
    return Response.json(
      {
        code: list || !failed ? 200 : 503,
        message: list || !failed ? 'ok' : '单场详情暂时不可用',
        data: list ? items : failed ? null : { ...items[0], summary: null },
        total: items.length,
        page: 1,
        page_size: 100,
      },
      { status: list || !failed ? 200 : 503 },
    )
  })
  const { result } = renderHook(() => ({ list: useContestLibrary(), detail: useContest('one') }), {
    wrapper: wrapper(),
  })
  await waitFor(() => expect(result.current.detail.isError).toBe(true))
  expect(result.current.list.isSuccess).toBe(true)
  expect(result.current.list.data).toEqual(items)
  failed = false
  await act(async () => {
    await result.current.detail.refetch()
  })
  await waitFor(() => expect(result.current.detail.isSuccess).toBe(true))
  expect(requests.filter((url) => url.includes('/contests/one'))).toHaveLength(2)
  expect(requests.filter((url) => !url.includes('/contests/one'))).toHaveLength(1)
})

it('does not show a previous contest as the detail for a newly selected id', async () => {
  vi.stubGlobal('fetch', async (input: string) => {
    const id = input.split('/').at(-1)
    return Response.json({
      code: 200,
      message: 'ok',
      data: { ...items.find((item) => item.id === id), summary: null },
    })
  })
  const { result, rerender } = renderHook(({ id }) => useContest(id), {
    wrapper: wrapper(),
    initialProps: { id: 'one' },
  })
  await waitFor(() => expect(result.current.data?.id).toBe('one'))
  rerender({ id: 'two' })
  expect(result.current.data?.id).not.toBe('one')
  await waitFor(() => expect(result.current.data?.id).toBe('two'))
})

it('publishes the first page while the remaining page is still loading', async () => {
  let finish!: (response: Response) => void
  const remaining = new Promise<Response>((resolve) => {
    finish = resolve
  })
  const first = Array.from({ length: 100 }, (_, index) => ({ ...items[0], id: String(index) }))
  vi.stubGlobal('fetch', async (input: string) => {
    const page = new URL(input, 'https://example.com').searchParams.get('page')
    if (page === '2') return remaining
    return Response.json({
      code: 200,
      message: 'ok',
      data: first,
      total: 101,
      page: 1,
      page_size: 100,
    })
  })
  const { result } = renderHook(() => useContestLibrary(), { wrapper: wrapper() })
  try {
    await waitFor(() => expect(result.current.data).toHaveLength(100))
    expect(result.current.isFetching).toBe(true)
  } finally {
    finish(
      Response.json({
        code: 200,
        message: 'ok',
        data: [items[1]],
        total: 101,
        page: 2,
        page_size: 100,
      }),
    )
  }
  await waitFor(() => expect(result.current.data).toHaveLength(101))
})

it('shares the same request between the homepage collection and the library', async () => {
  let requests = 0
  vi.stubGlobal('fetch', async () => {
    requests++
    return Response.json({
      code: 200,
      message: 'ok',
      data: items,
      total: 2,
      page: 1,
      page_size: 100,
    })
  })
  const { result } = renderHook(
    () => ({ home: useContestCollection(), library: useContestLibrary() }),
    { wrapper: wrapper() },
  )
  await waitFor(() => expect(result.current.home.data?.items).toHaveLength(2))
  expect(result.current.library.data).toHaveLength(2)
  expect(requests).toBe(1)
})

it('aborts the collection request when its observer is removed', async () => {
  let requestSignal: AbortSignal | null | undefined
  vi.stubGlobal('fetch', (_input: string, init?: RequestInit) => {
    requestSignal = init?.signal
    return new Promise<Response>(() => {})
  })
  const hook = renderHook(() => useContestLibrary(), { wrapper: wrapper() })
  await waitFor(() => expect(requestSignal).toBeDefined())
  hook.unmount()
  expect(requestSignal?.aborted).toBe(true)
})
