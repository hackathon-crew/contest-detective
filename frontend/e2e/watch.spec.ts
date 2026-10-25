import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

test('private watch preserves paused status, evidence precision and working controls', async ({
  page,
}, info) => {
  let enabled = false
  let readAt: string | null = null
  const errors: string[] = []
  const nonGetRequests: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  function field(value: string, precision = 'datetime') {
    return {
      value,
      precision,
      level: 'official',
      sources: [
        {
          url: 'https://organizer.example/rules',
          site: '主办方',
          title: '官方赛事规则',
          is_official: true,
          value,
          precision,
          excerpt: value,
        },
      ],
    }
  }
  const before = {
    name: '公开赛事演示',
    fields: {
      registration_deadline: field('2026-11-01T00:00:00Z', 'day'),
      prize: field('1000 元'),
    },
  }
  const after = {
    name: '公开赛事演示',
    fields: {
      registration_deadline: field('2026-11-05T00:00:00Z', 'day'),
      prize: field('2000 元'),
    },
  }
  const contest = {
    id: 'demo',
    name: after.name,
    status: 'upcoming',
    fields: after.fields,
    summary: null,
    cover_url: null,
    themes: [],
    theme_sources: [],
    coverage: { fields: {}, sources: {} },
    documents: [],
    introduction: null,
  }
  function status() {
    return {
      contest_id: 'demo',
      contest_name: contest.name,
      enabled,
      state: enabled ? 'scheduler_paused' : 'paused',
      last_check: {
        contest_id: 'demo',
        checked_at: '2026-10-25T03:00:00Z',
        completed_at: '2026-10-25T03:00:01Z',
        outcome: 'changed',
        source_url: 'https://organizer.example/rules',
        error_type: null,
      },
      last_success_at: '2026-10-25T03:00:01Z',
      next_check_at: null,
    }
  }
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://127.0.0.1:5186') return route.abort('blockedbyclient')
    if (!url.pathname.startsWith('/api/')) return route.continue()
    const path = url.pathname.slice(4)
    const method = route.request().method()
    let data: unknown = null
    if (method !== 'GET') nonGetRequests.push(method + ' ' + path)
    if (path === '/auth/me') data = { id: 'owner', username: 'demo@example.com', profile: {} }
    else if (path === '/match' && method === 'POST') data = []
    else if (path === '/account/summary') data = { follows: 1, tracks: 0 }
    else if (path === '/account/follows')
      data = [{ contest, reminders: false, created_at: '2026-10-25T00:00:00Z' }]
    else if (path === '/account/calendar') data = { url: 'webcal://example.org/synthetic-calendar' }
    else if (path === '/account/push')
      data = { settings: { enabled: false, reminder_days: [3, 1] } }
    else if (path === '/account/watch')
      data = {
        items: [status()],
        notifications: [
          {
            event_id: 2,
            contest_id: 'demo',
            occurred_at: '2026-10-25T03:00:01Z',
            change: { before, after },
            read_at: readAt,
          },
        ],
        has_more: false,
        has_more_notifications: false,
      }
    else if (path === '/account/watch/demo' && method === 'PUT') {
      enabled = route.request().postDataJSON().enabled
      data = status()
    } else if (path === '/account/watch/notifications/2/read') readAt = '2026-10-25T04:00:00Z'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 200, message: 'ok', data }),
    })
  })
  await page.goto('/account/follows')
  const panel = page.getByRole('region', { name: '比赛盯梢', exact: true })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('已暂停盯梢', { exact: true })).toBeVisible()
  await panel.getByRole('switch', { name: '盯梢「公开赛事演示」' }).click()
  await expect(panel.getByText('订阅已开启，自动检查暂停', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: /标记「公开赛事演示」.*的变动已读/ }).click()
  await expect(panel.getByText('已加载 0 条未读', { exact: true })).toBeVisible()
  await expect(panel.getByText(/变更前：2026年11月1日（时刻未核实）/)).toBeVisible()
  await expect(panel.getByText(/变更后：2026年11月5日（时刻未核实）/)).toBeVisible()
  await expect(panel.getByText(/T00:00:00Z/)).toHaveCount(0)
  await expect(panel.getByText(/预计下次/)).toHaveCount(0)
  await expect(panel.getByRole('link', { name: '官方赛事规则' })).toHaveCount(4)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  // The existing account profile tab requests recommendations on initial mount.
  expect(nonGetRequests).toEqual([
    'POST /match',
    'PUT /account/watch/demo',
    'POST /account/watch/notifications/2/read',
  ])
  expect(errors).toEqual([])
  await mkdir(resolve('artifacts/detail-preview'), { recursive: true })
  await page.screenshot({
    path: resolve(`artifacts/detail-preview/watch-${info.project.name}.png`),
    fullPage: true,
  })
})
