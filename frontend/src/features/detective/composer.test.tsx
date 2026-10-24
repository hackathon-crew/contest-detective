// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DetectiveDock } from './detective-dock'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function show() {
  const onAddProfile = vi.fn()
  const fetch = vi.fn(
    async () =>
      new Response(
        `event: answer\ndata: ${JSON.stringify({ content: '已整理参赛条件。', sources: [] })}\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  )
  vi.stubGlobal('fetch', fetch)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DetectiveDock onAddProfile={onAddProfile} />
    </QueryClientProvider>,
  )
  return { fetch, onAddProfile, input: screen.getByRole('textbox', { name: '问侦探' }) }
}

describe('侦探输入口', () => {
  it('提供多行编辑与参赛资料入口，空问题无法发送', () => {
    const { input, onAddProfile } = show()
    expect(input.tagName).toBe('TEXTAREA')
    expect(input.getAttribute('maxlength')).toBe('500')
    expect((screen.getByRole('button', { name: '查证' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '添加简历或参赛资料' }))
    expect(onAddProfile).toHaveBeenCalledOnce()
  })

  it('Enter 发送完整的多行问题，并保留现有查证结果', async () => {
    const { fetch, input } = show()
    fireEvent.change(input, { target: { value: '  帮我找适合大学生的黑客松\n优先线上  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(init.body as string).question).toBe('帮我找适合大学生的黑客松\n优先线上')
    expect(await screen.findByText('已整理参赛条件。')).toBeTruthy()
  })

  it('Shift+Enter 和中文输入法确认选字都不发送', async () => {
    const { fetch, input } = show()
    fireEvent.change(input, { target: { value: '帮我查一下' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  })
})
