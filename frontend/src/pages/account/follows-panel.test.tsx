// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { FollowsPanel } from './follows-panel'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})
it('does not label a known start date as an unknown deadline', async () => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const path = String(input)
    return new Response(
      JSON.stringify({
        code: 200,
        message: 'ok',
        data: path.endsWith('/auth/me')
          ? { id: 'owner', username: 'owner@example.com', profile: {} }
          : path.endsWith('/account/follows')
            ? [
                {
                  contest: {
                    id: 'one',
                    name: '仅公布开赛日',
                    status: 'upcoming',
                    cover_url: null,
                    fields: {
                      start_at: {
                        value: '2027-11-01T00:00:00Z',
                        precision: 'day',
                        level: 'official',
                        sources: [],
                      },
                    },
                  },
                  reminders: true,
                  created_at: '2026-10-25T00:00:00Z',
                },
              ]
            : path.endsWith('/account/calendar')
              ? { url: 'webcal://example.com/calendar/random.ics' }
              : { settings: { reminder_days: [3, 1] } },
      }),
    )
  })
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FollowsPanel />
    </QueryClientProvider>,
  )
  expect(await screen.findByText('仅公布开赛日')).toBeTruthy()
  expect(screen.getByText('没写截止')).toBeTruthy()
})
