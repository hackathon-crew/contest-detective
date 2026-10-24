// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
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
