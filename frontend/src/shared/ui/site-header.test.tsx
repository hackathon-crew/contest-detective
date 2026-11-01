// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, expect, it } from 'vitest'
import { SiteHeader } from './site-header'
afterEach(cleanup)
it('connects site navigation to the library, detective and MCP section', () => {
  render(
    <MemoryRouter>
      <SiteHeader utilities={<button>登录</button>} />
    </MemoryRouter>,
  )
  expect(screen.getByRole('link', { name: '赛事库' }).getAttribute('href')).toBe('/contests')
  expect(screen.getByRole('link', { name: '侦探' }).getAttribute('href')).toBe('/detective')
  expect(screen.getByRole('link', { name: 'MCP' }).getAttribute('href')).toBe('/#mcp')
  expect(screen.getByRole('link', { name: 'GitHub 仓库' }).getAttribute('href')).toBe(
    'https://github.com/hackathon-crew/contest-detective',
  )
})

it('opens the navigation menu and closes it after choosing a destination', async () => {
  function CurrentPath() {
    return <output>{useLocation().pathname}</output>
  }
  render(
    <MemoryRouter>
      <SiteHeader utilities={<button>登录</button>} />
      <CurrentPath />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: '打开导航菜单' }))
  const menu = await screen.findByRole('dialog', { name: '导航菜单' })
  expect(within(menu).getByRole('link', { name: 'GitHub 仓库' }).getAttribute('href')).toBe(
    'https://github.com/hackathon-crew/contest-detective',
  )
  fireEvent.click(within(menu).getByRole('link', { name: '侦探' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '导航菜单' })).toBeNull())
  expect(screen.getByRole('status').textContent).toBe('/detective')
})
