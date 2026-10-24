// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Button, Dialog, ErrorState, Input } from './index'
afterEach(cleanup)
it('keeps disabled actions inert', () => {
  const click = vi.fn()
  render(
    <>
      <Button disabled onClick={click}>
        保存
      </Button>
      <Input aria-label="关键词" />
    </>,
  )
  fireEvent.click(screen.getByRole('button'))
  expect(click).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: '关键词' })).toBeTruthy()
})
it('closes a centered dialog with Escape', () => {
  const close = vi.fn()
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  const view = render(
    <Dialog title="详情" onClose={close}>
      <a href="https://example.com">来源</a>
    </Dialog>,
  )
  expect(screen.getByRole('dialog', { name: '详情' }).contains(document.activeElement)).toBe(true)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(close).toHaveBeenCalledOnce()
  view.unmount()
  trigger.remove()
})
it('mounts dialog content only while open and resets its draft after closing', () => {
  const close = vi.fn()
  const content = (open: boolean) => (
    <Dialog open={open} title="画像" onClose={close}>
      <Input aria-label="临时草稿" defaultValue="" />
    </Dialog>
  )
  const view = render(content(false))
  expect(screen.queryByRole('dialog')).toBeNull()
  view.rerender(content(true))
  fireEvent.change(screen.getByRole('textbox', { name: '临时草稿' }), {
    target: { value: '未确认的内容' },
  })
  view.rerender(content(false))
  expect(screen.queryByRole('dialog')).toBeNull()
  view.rerender(content(true))
  expect((screen.getByRole('textbox', { name: '临时草稿' }) as HTMLInputElement).value).toBe('')
})
it('provides a retry action with an error', () => {
  const retry = vi.fn()
  render(<ErrorState error={new Error('网络断开')} retry={retry} />)
  expect(screen.getByRole('alert').textContent).toContain('网络断开')
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(retry).toHaveBeenCalledOnce()
})
