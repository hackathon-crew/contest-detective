import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

for (const verified of [true, false]) {
  test(`email push onboarding for ${verified ? 'verified' : 'unverified'} addresses`, async ({
    page,
  }) => {
    let settings = {
      enabled: false,
      new_matches: true,
      deadline_reminders: true,
      changes: true,
      tracking: true,
      frequency: 'weekly',
      weekday: 0,
      time: '08:00',
      timezone: 'Asia/Shanghai',
      reminder_days: [3, 1],
    }
    const writes: string[] = []
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('http://127.0.0.1:5186/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.slice(4)
      const method = route.request().method()
      if (method !== 'GET' && path !== '/match') writes.push(method + ' ' + path)
      if (path === '/account/push' && method === 'PUT') settings = route.request().postDataJSON()
      const data =
        path === '/account/watch'
          ? { items: [], notifications: [], has_more: false, has_more_notifications: false }
          : path === '/auth/me'
            ? { id: 'owner', username: 'owner@example.com', profile: {} }
            : path === '/account/push'
              ? {
                  settings,
                  email: 'owner@example.com',
                  email_verified: verified,
                  next_send_at: null,
                }
              : path === '/account/push/preview'
                ? {
                    subject: '下一封比赛推送',
                    html: '<p>目前没有新比赛。</p>',
                    text: '目前没有新比赛。',
                    sender: 'Inkpaw',
                    recipient: 'owner@example.com',
                  }
                : null
      await route.fulfill({
        json: { code: 200, message: 'ok', data },
      })
    })
    await page.goto('/account/push')
    const preview = page.getByRole('button', { name: '预览下一封', exact: true })
    const send = page.getByRole('button', { name: '发一封测试邮件', exact: true })
    const enable = page.getByRole('button', { name: '开启邮件推送', exact: true })
    await expect(preview).toHaveCSS('pointer-events', 'auto')
    await preview.click()
    const dialog = page.getByRole('dialog', { name: '下一封比赛推送' })
    await expect(dialog).toBeVisible()
    const previewSend = dialog.getByRole('button', { name: '发到我的邮箱' })
    if (!verified) await expect(previewSend).toBeDisabled()
    await dialog.getByRole('button', { name: '关闭', exact: true }).first().click()
    await expect(dialog).toBeHidden()
    if (verified) {
      await expect(send).toHaveCSS('pointer-events', 'auto')
      await send.click()
      await expect(page.getByText('测试邮件已发到 owner@example.com')).toBeVisible()
      await expect(page.getByRole('switch', { name: '邮件推送', exact: true })).not.toBeChecked()
      expect(writes).toEqual(['POST /account/push/test'])
      await enable.click()
      await expect(page.getByRole('switch', { name: '邮件推送', exact: true })).toBeChecked()
      await expect(enable).toHaveCount(0)
      expect(settings).toMatchObject({ enabled: true, frequency: 'weekly', reminder_days: [3, 1] })
      expect(writes).toEqual(['POST /account/push/test', 'PUT /account/push'])
    } else {
      await expect(enable).toBeDisabled()
      await expect(send).toBeDisabled()
      await expect(page.getByRole('switch', { name: '邮件推送', exact: true })).toBeDisabled()
      await expect(page.getByRole('link', { name: '去验证邮箱' })).toHaveAttribute(
        'href',
        '/account/settings#email',
      )
      expect(writes).toEqual([])
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
  })
}

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
  // Profile recommendations are debounced independently of the watch panel.
  await expect.poll(() => [...nonGetRequests]).toEqual(['POST /match'])
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
