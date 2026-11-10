// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ErrorState } from './index'

afterEach(cleanup)

it('provides a retry action with an error', () => {
  const retry = vi.fn()
  render(<ErrorState error={new Error('网络断开')} retry={retry} />)
  expect(screen.getByRole('alert').textContent).toContain('网络断开')
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(retry).toHaveBeenCalledOnce()
})
