// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { AppearanceControl } from './appearance-control'

afterEach(() => {
  cleanup()
  localStorage.clear()
  delete document.documentElement.dataset.theme
})
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
