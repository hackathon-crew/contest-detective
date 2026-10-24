// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppearanceControl } from './appearance-control'

afterEach(() => {
  cleanup()
  localStorage.clear()
  delete document.documentElement.dataset.theme
  vi.unstubAllGlobals()
})

function systemAppearance(dark: boolean) {
  const media = Object.assign(new EventTarget(), { matches: dark })
  vi.stubGlobal('matchMedia', () => media)
  return (value: boolean) => {
    media.matches = value
    act(() => media.dispatchEvent(new Event('change')))
  }
}
it('切换深浅色并在重新打开时保留选择', () => {
  localStorage.setItem('contest-detective.theme', 'dark')
  const first = render(<AppearanceControl />)
  expect(document.documentElement.dataset.theme).toBe('dark')
  fireEvent.click(screen.getByRole('button', { name: '切换到浅色' }))
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(localStorage.getItem('contest-detective.theme')).toBe('light')
  first.unmount()
  render(<AppearanceControl />)
  expect(screen.getByRole('button', { name: '切换到深色' })).toBeTruthy()
})

it('offers system appearance without losing persisted explicit preferences', () => {
  systemAppearance(true)
  localStorage.setItem('contest-detective.theme', 'light')
  render(
    <>
      <AppearanceControl segmented />
      <AppearanceControl />
    </>,
  )
  fireEvent.click(screen.getByRole('button', { name: /^深色$/ }))
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(screen.getByRole('button', { name: '切换到浅色' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '跟随系统' }))
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(localStorage.getItem('contest-detective.theme')).toBe('system')
  expect(screen.getByRole('button', { name: '跟随系统' }).getAttribute('aria-pressed')).toBe('true')
})

it('follows system changes on first visit and keeps the system preference selected', () => {
  const changeSystem = systemAppearance(false)
  render(
    <>
      <AppearanceControl segmented />
      <AppearanceControl />
    </>,
  )
  expect(document.documentElement.dataset.theme).toBe('light')
  changeSystem(true)
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(screen.getByRole('button', { name: '切换到浅色' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '跟随系统' }).getAttribute('aria-pressed')).toBe('true')
  changeSystem(false)
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(screen.getByRole('button', { name: '切换到深色' })).toBeTruthy()
})

it('keeps a manual preference when the system changes and resumes tracking when requested', () => {
  const changeSystem = systemAppearance(false)
  localStorage.setItem('contest-detective.theme', 'dark')
  render(<AppearanceControl segmented />)
  changeSystem(true)
  changeSystem(false)
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(localStorage.getItem('contest-detective.theme')).toBe('dark')
  fireEvent.click(screen.getByRole('button', { name: '跟随系统' }))
  expect(document.documentElement.dataset.theme).toBe('light')
  changeSystem(true)
  expect(document.documentElement.dataset.theme).toBe('dark')
})
