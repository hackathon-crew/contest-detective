// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { KeysPanel } from './keys-panel'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('keeps saved credentials masked and reveals a regenerated token only in the panel', async () => {
  const metadata = {
    prefix: 'ink_pt_',
    last_four: 'ABCD',
    created_at: '2026-10-24T00:00:00Z',
    last_used_at: null,
  }
  const request = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = String(input)
    return new Response(
      JSON.stringify({
        code: 200,
        message: 'ok',
        data: path.endsWith('/auth/me')
          ? { id: 'one', username: 'one@example.com' }
          : path.endsWith('/providers')
            ? {
                llm_vendor: 'deepseek',
                llm_base_url: 'https://api.deepseek.com',
                llm_model: 'deepseek-flash',
                secrets: { tavily_api_key: { last_four: '7Qx2' } },
              }
            : path.endsWith('/regenerate')
              ? { token: 'ink_pt_new-secret-ABCD', metadata }
              : path.endsWith('/token')
                ? metadata
                : path.endsWith('/quota')
                  ? { unlimited: true }
                  : { scope: 'all', exclude_ended: true, blocked_domains: [] },
      }),
    )
  })
  vi.stubGlobal('fetch', request)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <MemoryRouter initialEntries={['/account/keys']}>
      <QueryClientProvider client={client}>
        <KeysPanel />
      </QueryClientProvider>
    </MemoryRouter>,
  )
  expect(await screen.findByText(/末 4 位 7Qx2/)).toBeTruthy()
  const token = screen.getByLabelText('个人令牌') as HTMLInputElement
  await waitFor(() => expect(token.value).toBe('ink_pt_••••••••••••ABCD'))
  expect((screen.getByRole('button', { name: /^复制$/ }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
  await waitFor(() => expect(token.value).toBe('ink_pt_new-secret-ABCD'))
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
    ),
  ).not.toContain('new-secret')
  expect(
    request.mock.calls.some(
      ([url, init]) => String(url).endsWith('/regenerate') && init?.method === 'POST',
    ),
  ).toBe(true)
})
