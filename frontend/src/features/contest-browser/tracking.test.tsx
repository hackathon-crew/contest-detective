// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { useContestBrowser } from './browser-state'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('keeps a tracking result restriction while the library loads all contests', async () => {
  const items = ['tracked', 'unrelated'].map((id) => ({
    id,
    name: id,
    fields: {},
    status: 'upcoming',
    cover_url: null,
    summary: null,
  }))
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL) =>
      new Response(
        JSON.stringify({
          code: 200,
          message: 'ok',
          data: String(input).match(/\/contests\/([^?]+)/)
            ? items.find((item) => String(input).endsWith('/' + item.id))
            : items,
          total: 2,
          page: 1,
          page_size: 100,
        }),
      ),
  )
  function Results() {
    const browser = useContestBrowser([], null, ['tracked'])
    return (
      <div>
        {browser.base.map((item) => (
          <span key={item.id}>{item.name}</span>
        ))}
      </div>
    )
  }
  render(
    <MemoryRouter>
      <NuqsAdapter>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <Results />
        </QueryClientProvider>
      </NuqsAdapter>
    </MemoryRouter>,
  )
  expect(await screen.findByText('tracked')).toBeTruthy()
  expect(screen.queryByText('unrelated')).toBeNull()
})
