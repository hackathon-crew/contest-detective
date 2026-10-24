// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FollowButton, FOLLOW_STORAGE_KEY, useFollows } from './index'

function Harness() {
  const follows = useFollows()
  return (
    <>
      <FollowButton contestId="one" follows={follows} />
      <output>{follows.ids.join(',')}</output>
      {follows.error && <p role="alert">{follows.error}</p>}
    </>
  )
}

function setup() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Harness />
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    async () => new Response(JSON.stringify({ code: 200, message: 'ok', data: null })),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

it('关注集合去重、切换并在重新打开后恢复', async () => {
  localStorage.setItem(FOLLOW_STORAGE_KEY, JSON.stringify(['one', 'one', null, 3, 'two']))
  setup()
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  await waitFor(() => expect(screen.getByRole('button')).toHaveProperty('disabled', false))
  fireEvent.click(screen.getByRole('button'))
  expect(JSON.parse(localStorage.getItem(FOLLOW_STORAGE_KEY)!)).toEqual(['two'])
  cleanup()
  setup()
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
  expect(screen.getByRole('status').textContent).toBe('two')
})

it('存储写入失败时保留原状态并给出错误', async () => {
  setup()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  await waitFor(() => expect(screen.getByRole('button')).toHaveProperty('disabled', false))
  fireEvent.click(screen.getByRole('button'))
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
  expect(screen.getByRole('alert').textContent).toContain('无法保存关注')
})

it('损坏的浏览器数据不会让页面崩溃', () => {
  localStorage.setItem(FOLLOW_STORAGE_KEY, '{invalid')
  setup()
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
  expect(screen.getByRole('alert').textContent).toContain('无法读取关注')
})
