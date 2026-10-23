// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { ProfileMatchDialog, loadConfirmedProfile } from './index'

const profile = {
  identity: null,
  available_time: null,
  city: null,
  preferred_modes: [],
  identity_kind: null,
  github_evidence: [],
  language_repo_share: {},
  github_last_active_at: null,
  skills: ['Python'],
  topics: ['agent'],
  github: 'octocat',
  availability: { weekdays: [5, 6], windows: [], max_consecutive_days: 2 },
}
const recommendation = {
  contest: {
    id: 'weekend',
    name: '线上智能体周末',
    cover_url: null,
    status: 'upcoming',
    fields: {},
  },
  score: 5,
  reason: '你的 [agent 项目](https://github.com/octocat/agent) 与这场赛道相符。',
}
function envelope(data: unknown, code = 200, message = 'ok') {
  return new Response(JSON.stringify({ code, message, data }), {
    headers: { 'content-type': 'application/json' },
  })
}
function show(user = null as { id: string; username: string; profile: typeof profile } | null) {
  return render(
    <MemoryRouter>
      <ProfileMatchDialog user={user} onClose={vi.fn()} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('profile confirmation', () => {
  it('keeps a GitHub draft unsaved until edited and confirmed', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        calls.push({ url: String(url), init })
        if (String(url).endsWith('/profile/github')) return envelope(profile)
        if (String(url).endsWith('/match')) return envelope([recommendation])
        throw new Error('unexpected request')
      }),
    )
    show()
    fireEvent.change(screen.getByLabelText('GitHub 用户名'), { target: { value: 'octocat' } })
    fireEvent.click(screen.getByRole('button', { name: '读取 GitHub' }))
    await screen.findByRole('button', { name: '移除技能 Python' })
    expect(calls).toHaveLength(1)
    expect(loadConfirmedProfile()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '移除技能 Python' }))
    fireEvent.change(screen.getByRole('textbox', { name: '添加技能' }), {
      target: { value: 'TypeScript' },
    })
    fireEvent.click(screen.getByRole('button', { name: '添加技能' }))
    fireEvent.click(screen.getByRole('button', { name: '确认并挑比赛' }))
    await screen.findByRole('link', { name: '线上智能体周末' })
    expect(loadConfirmedProfile()?.skills).toEqual(['TypeScript'])
    expect(
      JSON.parse(String(calls.find((call) => call.url.endsWith('/match'))?.init?.body)).skills,
    ).toEqual(['TypeScript'])
    expect(screen.getByRole('link', { name: 'agent 项目' }).getAttribute('href')).toBe(
      'https://github.com/octocat/agent',
    )
  })

  it('confirms an account profile before requesting matches', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        calls.push(String(url))
        if (String(url).endsWith('/user/profile'))
          return envelope({ id: 'user', username: 'student@example.org', profile })
        return envelope([])
      }),
    )
    show({ id: 'user', username: 'student@example.org', profile })
    fireEvent.click(screen.getByRole('button', { name: '确认并挑比赛' }))
    await screen.findByText('没有找到符合条件的比赛，调整画像后再试。')
    expect(calls).toEqual(['/api/user/profile', '/api/match'])
    expect(loadConfirmedProfile()).toBeNull()
  })

  it('uploads raw bytes under a fixed filename and leaves the draft unconfirmed', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        calls.push({ url: String(url), init })
        return envelope(profile)
      }),
    )
    show()
    const file = new File(['Python'], 'private-personal-name.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByLabelText('上传简历'), { target: { files: [file] } })
    await screen.findByRole('button', { name: '移除技能 Python' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/profile/resume?filename=resume.txt')
    expect(calls[0].init?.body).toBe(file)
    expect(loadConfirmedProfile()).toBeNull()
  })

  it('shows draft errors and rejects oversized files before requesting', async () => {
    const fetch = vi.fn(async () => envelope(null, 429, 'GitHub 请求过于频繁，请稍后重试'))
    vi.stubGlobal('fetch', fetch)
    show()
    fireEvent.change(screen.getByLabelText('GitHub 用户名'), { target: { value: 'octocat' } })
    fireEvent.click(screen.getByRole('button', { name: '读取 GitHub' }))
    await screen.findByRole('alert')
    expect(screen.getByText('GitHub 请求过于频繁，请稍后重试')).toBeTruthy()
    const file = new File(['x'.repeat(2 * 1024 * 1024 + 1)], 'private.txt')
    fireEvent.change(screen.getByLabelText('上传简历'), { target: { files: [file] } })
    await screen.findByText('简历不能超过 2MiB')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('combines both draft sources while retaining confirmed city and identity', async () => {
    localStorage.setItem(
      'contest-detective.profile',
      JSON.stringify({ city: '北京', identity_kind: 'student' }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        String(url).endsWith('/profile/github')
          ? envelope(profile)
          : envelope({ ...profile, github: null, topics: [], skills: ['TypeScript'] }),
      ),
    )
    show()
    fireEvent.change(screen.getByLabelText('GitHub 用户名'), { target: { value: 'octocat' } })
    fireEvent.click(screen.getByRole('button', { name: '读取 GitHub' }))
    await screen.findByRole('button', { name: '移除技能 Python' })
    expect((screen.getByLabelText('城市') as HTMLInputElement).value).toBe('北京')
    fireEvent.change(screen.getByLabelText('上传简历'), {
      target: { files: [new File(['TypeScript'], 'private.txt')] },
    })
    await screen.findByRole('button', { name: '移除技能 TypeScript' })
    expect(screen.getByRole('button', { name: '移除技能 Python' })).toBeTruthy()
    expect(screen.getByText('GitHub：octocat', { exact: false })).toBeTruthy()
  })

  it('ignores corrupt local data and preserves confirmed data during editing', async () => {
    localStorage.setItem('contest-detective.profile', 'invalid')
    expect(loadConfirmedProfile()).toBeNull()
    localStorage.setItem('contest-detective.profile', JSON.stringify({ github: 12 }))
    expect(loadConfirmedProfile()).toBeNull()
    localStorage.setItem('contest-detective.profile', JSON.stringify(profile))
    show()
    fireEvent.click(screen.getByRole('button', { name: '移除技能 Python' }))
    await waitFor(() => expect(loadConfirmedProfile()?.skills).toEqual(['Python']))
  })
})
