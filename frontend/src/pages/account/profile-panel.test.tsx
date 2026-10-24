// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { ProfilePanel } from './profile-panel'

vi.mock('@/shared/ui/octopus/inkpaw-octopus', () => ({ mountOctopus: () => null }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('saves only dirty profiles and uses the matching response count', async () => {
  const profile = {
    skills: ['Python'],
    skill_sources: { Python: ['github'] },
    topics: [],
    preferred_modes: [],
    identity: '学生',
    city: '上海',
    availability: { weekdays: [], windows: [], max_consecutive_days: null },
    github_evidence: [],
    language_repo_share: {},
  }
  const user = { id: 'u1', username: 'person@example.com', profile }
  let saved: unknown = null
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith('/user/profile')) {
      saved = JSON.parse(String(init?.body))
      user.profile = saved as typeof profile
    }
    return new Response(
      JSON.stringify({
        code: 200,
        message: 'ok',
        data: String(url).endsWith('/match')
          ? [{ contest: { id: 'a' } }, { contest: { id: 'b' } }]
          : user,
      }),
    )
  })
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ProfilePanel />
      </QueryClientProvider>
    </MemoryRouter>,
  )
  const city = await screen.findByRole('textbox', { name: '所在城市' })
  await waitFor(() => expect(screen.getByText('2')).toBeTruthy())
  expect(screen.getByRole('region', { name: '保存画像' }).className).not.toContain('show')
  fireEvent.change(city, { target: { value: '杭州' } })
  expect(screen.getByRole('region', { name: '保存画像' }).className).toContain('show')
  fireEvent.click(screen.getByRole('button', { name: '撤销' }))
  expect((city as HTMLInputElement).value).toBe('上海')
  fireEvent.change(city, { target: { value: '北京' } })
  fireEvent.click(screen.getByRole('button', { name: '保存画像' }))
  await waitFor(() =>
    expect(saved).toMatchObject({ city: '北京', skill_sources: { Python: ['github'] } }),
  )
  await waitFor(() =>
    expect(screen.getByRole('region', { name: '保存画像' }).className).not.toContain('show'),
  )
})

it('keeps edits made while an earlier save is in flight', async () => {
  const profile = {
    skills: [],
    skill_sources: {},
    topics: [],
    preferred_modes: [],
    city: '上海',
    availability: { weekdays: [], windows: [] },
    github_evidence: [],
    language_repo_share: {},
  }
  const user = { id: 'u1', username: 'person@example.com', profile }
  let finish: () => void = () => {}
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith('/user/profile')) {
      const submitted = JSON.parse(String(init?.body))
      await pending
      return new Response(
        JSON.stringify({ code: 200, message: 'ok', data: { ...user, profile: submitted } }),
      )
    }
    return new Response(
      JSON.stringify({
        code: 200,
        message: 'ok',
        data: String(url).endsWith('/match') ? [] : user,
      }),
    )
  })
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ProfilePanel />
      </QueryClientProvider>
    </MemoryRouter>,
  )
  const city = await screen.findByRole('textbox', { name: '所在城市' })
  fireEvent.change(city, { target: { value: '杭州' } })
  fireEvent.click(screen.getByRole('button', { name: '保存画像' }))
  fireEvent.change(city, { target: { value: '北京' } })
  finish()
  await waitFor(() => expect(screen.queryByRole('button', { name: '保存中' })).toBeNull())
  expect((city as HTMLInputElement).value).toBe('北京')
  expect(screen.getByRole('region', { name: '保存画像' }).className).toContain('show')
})
