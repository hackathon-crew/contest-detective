// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from './app'
import { queryClient } from './query-client'

vi.mock('@/shared/ui/octopus/inkpaw-octopus', () => ({ mountOctopus: () => null }))

beforeEach(() => {
  window.history.replaceState(null, '', '/login?next=contests')
  vi.stubGlobal('fetch', async () => Response.json({ code: 200, message: 'ok', data: null }))
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it.each([
  [['ja-JP', 'en-GB', 'zh-CN'], 'en'],
  [['zh-HK', 'en-US'], 'zh-CN'],
  [['fr-FR'], 'zh-CN'],
])('matches the first supported browser language in %j', (languages, locale) => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages)
  render(<App />)

  expect(document.documentElement.lang).toBe(locale)
  expect(screen.getByRole('heading', { name: locale === 'en' ? /sign in/i : /登录/ })).toBeTruthy()
})

it('keeps a draft during a language switch and remembers the choice on return', async () => {
  const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
  const page = render(<App />)

  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
    target: { value: 'draft@example.org' },
  })
  fireEvent.keyDown(screen.getByRole('button', { name: 'Interface language' }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitemradio', { name: '简体中文' }))

  expect(screen.getByRole('textbox', { name: '邮箱' })).toHaveProperty('value', 'draft@example.org')
  expect(window.location.pathname + window.location.search).toBe('/login?next=contests')
  page.unmount()
  render(<App />)
  expect(document.documentElement.lang).toBe('zh-CN')

  fireEvent.keyDown(screen.getByRole('button', { name: '界面语言' }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitemradio', { name: '跟随浏览器' }))
  expect(document.documentElement.lang).toBe('en')

  languages.mockReturnValue(['zh-CN'])
  act(() => window.dispatchEvent(new Event('languagechange')))
  expect(document.documentElement.lang).toBe('zh-CN')
})
