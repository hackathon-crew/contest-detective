// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { useFollows, FOLLOW_STORAGE_KEY } from './model'
const row = (id: string) => ({
  contest: { id, name: id, status: 'upcoming', cover_url: null, fields: {} },
  reminders: true,
  created_at: '2026-10-25T00:00:00Z',
})
function Harness() {
  const state = useFollows()
  return (
    <>
      <output>{state.ids.join(',')}</output>
      {state.error && <p role="alert">{state.error}</p>}
    </>
  )
}
function setup() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})
it('merges both local keys after login and clears them only after success', async () => {
  localStorage.setItem(FOLLOW_STORAGE_KEY, JSON.stringify(['old', 'old']))
  localStorage.setItem('inkpaw-follows', JSON.stringify(['mock-local']))
  const merged: string[][] = []
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          code: 200,
          message: 'ok',
          data: String(input).endsWith('/auth/me')
            ? { id: 'owner', username: 'owner@example.com', profile: {} }
            : String(input).endsWith('/merge')
              ? (merged.push(JSON.parse(String(init?.body)).ids),
                [row('remote'), row('old'), row('mock-local')])
              : [],
        }),
      ),
  )
  setup()
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('remote,old,mock-local'))
  expect(merged).toEqual([['old', 'mock-local']])
  expect(localStorage.getItem(FOLLOW_STORAGE_KEY)).toBeNull()
  expect(localStorage.getItem('inkpaw-follows')).toBeNull()
})
it('keeps the local list when the merge request fails', async () => {
  const saved = JSON.stringify(['old'])
  localStorage.setItem(FOLLOW_STORAGE_KEY, saved)
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(input).endsWith('/auth/me')
            ? {
                code: 200,
                message: 'ok',
                data: { id: 'owner', username: 'owner@example.com', profile: {} },
              }
            : { code: 503, message: '同步失败', data: null },
        ),
      ),
  )
  setup()
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '同步失败')
  expect(localStorage.getItem(FOLLOW_STORAGE_KEY)).toBe(saved)
})

it('still migrates a readable key when the other legacy record is damaged', async () => {
  localStorage.setItem(FOLLOW_STORAGE_KEY, '{invalid')
  localStorage.setItem('inkpaw-follows', JSON.stringify(['valid']))
  const requests: string[][] = []
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          code: 200,
          message: 'ok',
          data: String(input).endsWith('/auth/me')
            ? { id: 'owner', username: 'owner@example.com', profile: {} }
            : String(input).endsWith('/merge')
              ? (requests.push(JSON.parse(String(init?.body)).ids), [row('valid')])
              : [],
        }),
      ),
  )
  setup()
  await waitFor(() => expect(requests).toEqual([['valid']]))
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('valid'))
  expect(localStorage.getItem(FOLLOW_STORAGE_KEY)).toBe('{invalid')
})
