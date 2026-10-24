// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { PushPanel } from './push-panel'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('persists frequency and shows a failed test delivery as an error', async () => {
  let settings = {
    enabled: true,
    new_matches: true,
    deadline_reminders: true,
    changes: true,
    tracking: true,
    frequency: 'weekly',
    weekday: 0,
    time: '08:00',
    timezone: 'Asia/Shanghai',
    reminder_days: [3, 1],
  }
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url)
    if (path.endsWith('/push') && init?.method === 'PUT') settings = JSON.parse(String(init.body))
    const fail = path.endsWith('/push/test')
    return new Response(
      JSON.stringify({
        code: fail ? 503 : 200,
        message: fail ? '邮件服务尚未配置' : 'ok',
        data: path.endsWith('/push')
          ? { settings, email: 'owner@example.com', email_verified: true, next_send_at: null }
          : path.endsWith('/auth/me')
            ? { id: 'owner', username: 'owner@example.com', profile: {} }
            : [],
      }),
    )
  })
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PushPanel />
      </QueryClientProvider>
    </MemoryRouter>,
  )
  fireEvent.click(await screen.findByRole('button', { name: '每天' }))
  await waitFor(() => expect(settings.frequency).toBe('daily'))
  fireEvent.click(screen.getByRole('button', { name: '发一封测试邮件' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '邮件服务尚未配置')
})
