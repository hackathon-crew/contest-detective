// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

it('关注集合去重、切换并在重新打开后恢复', () => {
  localStorage.setItem(FOLLOW_STORAGE_KEY, JSON.stringify(['one', 'one', null, 3, 'two']))
  render(<Harness />)
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button'))
  expect(JSON.parse(localStorage.getItem(FOLLOW_STORAGE_KEY)!)).toEqual(['two'])
  cleanup()
  render(<Harness />)
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
  expect(screen.getByRole('status').textContent).toBe('two')
})

it('存储写入失败时保留原状态并给出错误', () => {
  render(<Harness />)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  fireEvent.click(screen.getByRole('button'))
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
  expect(screen.getByRole('alert').textContent).toContain('无法保存关注')
})

it('损坏的浏览器数据不会让页面崩溃', () => {
  localStorage.setItem(FOLLOW_STORAGE_KEY, '{invalid')
  render(<Harness />)
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
  expect(screen.getByRole('alert').textContent).toContain('无法读取关注')
})
