// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import { AppRoutes } from './app'

afterEach(cleanup)

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

describe('路由', () => {
  it('首页显示四个区块，不开详情', () => {
    renderAt('/')

    for (const name of ['本周值得看', '全部赛事', '赛事日历']) {
      expect(screen.getByRole('heading', { name })).toBeTruthy()
    }
    expect(screen.getByRole('region', { name: '侦探' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('直接打开详情地址时，首页和详情弹窗都在', () => {
    renderAt('/contests/tme-ai-hackathon')

    expect(screen.getByRole('dialog', { name: '赛事详情' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '全部赛事' })).toBeTruthy()
  })

  it('关闭详情回到首页，首页区块不重新挂载', () => {
    renderAt('/contests/tme-ai-hackathon')
    const list = screen.getByRole('heading', { name: '全部赛事' })

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { name: '全部赛事' })).toBe(list)
  })

  it('未知地址回到首页', () => {
    renderAt('/no-such-page')

    expect(screen.getByRole('heading', { name: '本周值得看' })).toBeTruthy()
  })
})
