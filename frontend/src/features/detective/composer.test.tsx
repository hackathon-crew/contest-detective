// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderDetective } from './detective.test.utils'

afterEach(() => {
  cleanup()
  localStorage.clear()
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
  renderDetective({ onAddProfile })
  return { fetch, onAddProfile, input: screen.getByRole('textbox', { name: '问侦探' }) }
}

describe('侦探输入口', () => {
  it('加号先打开菜单，选择资料类型后才打开表单，空问题无法发送', async () => {
    const { input, onAddProfile } = show()
    expect(input.tagName).toBe('TEXTAREA')
    expect((screen.getByRole('button', { name: '查证' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(screen.getByRole('button', { name: '添加简历或参赛资料' }), { key: 'Enter' })
    expect(onAddProfile).not.toHaveBeenCalled()
    expect(await screen.findAllByRole('menuitem')).toHaveLength(4)
    fireEvent.click(screen.getByRole('menuitem', { name: '添加画像' }))
    expect(onAddProfile).toHaveBeenCalledWith('profile')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it.each([
    ['连接到 GitHub', 'GitHub 用户名', '城市'],
    ['添加画像', '上传简历', 'GitHub 用户名'],
    ['添加比赛筛选', '城市', '上传简历'],
  ])('%s 只打开对应的界面', async (entry, field, hiddenField) => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 200, data: null })))
    renderDetective({}, '/detective')
    const input = screen.getByRole('textbox', { name: '问侦探' })
    fireEvent.change(input, { target: { value: '周末线上比赛' } })
    fireEvent.keyDown(screen.getByRole('button', { name: '添加简历或参赛资料' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: entry }))
    expect(await screen.findByRole('dialog', { name: entry })).toBeTruthy()
    expect(screen.getByLabelText(field)).toBeTruthy()
    expect(screen.queryByLabelText(hiddenField)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect((input as HTMLTextAreaElement).value).toBe('周末线上比赛')
  })

  it('Enter 发送完整的多行问题，并保留现有查证结果', async () => {
    const { fetch, input } = show()
    const question = '帮我找适合大学生的黑客松\n' + '详细参赛条件。'.repeat(100) + '优先线上'
    fireEvent.change(input, { target: { value: `  ${question}  ` } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(init.body as string).question).toBe(question)
    expect(JSON.parse(init.body as string).mode).toBe('deep')
    expect(await screen.findByText('已整理参赛条件。')).toBeTruthy()
  })

  it('直接使用深度调查，不再要求选择查证方式', async () => {
    const { fetch, input } = show()
    expect(screen.queryByRole('combobox', { name: '查证方式' })).toBeNull()
    fireEvent.change(input, { target: { value: '公开编程比赛报名截止' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
    const payload = JSON.parse(init.body as string)
    expect(payload.mode).toBe('deep')
    expect(payload.confirmed_claims).toBeUndefined()
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
