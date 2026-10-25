import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'

const clock = '2026-10-24T21:35:51Z'
const artifactDirectory = resolve('artifacts/detail-preview')
interface Snapshot {
  url: string
  captured_after_utc: string
  server_date: string
  sha256: string
  response: { data: { name: string; id: string } }
}
function snapshot(name: string): Snapshot {
  return JSON.parse(readFileSync(resolve(`preview/detail-${name}-public-snapshot.json`), 'utf8'))
}
const scenarios = {
  full: snapshot('full'),
  conflict: snapshot('conflict'),
  'long-reward': snapshot('long-reward'),
}
const activity = new WeakMap<Page, { errors: string[]; blocked: string[] }>()

test.beforeEach(async ({ page }) => {
  const log = { errors: [] as string[], blocked: [] as string[] }
  activity.set(page, log)
  page.on('pageerror', (error) => log.errors.push(error.message))
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://127.0.0.1:5186' || url.pathname.startsWith('/api/')) {
      log.blocked.push(url.href)
      await route.abort('blockedbyclient')
    } else {
      await route.continue()
    }
  })
  await page.clock.setFixedTime(new Date(clock))
})

test.afterEach(async ({ page }) => {
  expect(activity.get(page)?.errors, 'No browser runtime errors').toEqual([])
  expect(activity.get(page)?.blocked, 'Preview must not attempt external or API requests').toEqual(
    [],
  )
})

async function openPreview(page: Page, scenario: string, variant = 'library') {
  await page.goto(`/detail-preview.html?scenario=${scenario}&variant=${variant}`)
  const name =
    scenario === 'sparse'
      ? '信息待完善的比赛 · 预览样本'
      : scenarios[scenario as keyof typeof scenarios].response.data.name
  const dialog = page.getByRole('dialog', { name, exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(dialog.locator('.contest-detail-scroll')).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await dialog
    .locator('img')
    .filter({ visible: true })
    .evaluateAll(async (images) => {
      await Promise.all(images.map((image) => (image as HTMLImageElement).decode()))
    })
  if (page.viewportSize()!.width === 1440 && scenario !== 'sparse') {
    const cover = dialog.locator('img.contest-detail-cover')
    await expect(cover).toHaveCount(1)
    await expect(cover).toBeVisible()
    await expect(cover).toHaveJSProperty('complete', true)
    expect(
      await cover.evaluate((image) => (image as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0)
  }
  return dialog
}

async function verifyLayout(page: Page, dialog: Locator) {
  const viewport = page.viewportSize()!
  const box = await dialog.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(-1)
  expect(box!.y).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1)
  if (viewport.width === 390) {
    expect(box!.width).toBeCloseTo(390, 0)
    expect(box!.height).toBeCloseTo(844, 0)
  }
  const overflow = await dialog.evaluate((element) => {
    const scroll = element.querySelector<HTMLElement>('.contest-detail-scroll')!
    return {
      dialog: element.scrollWidth - element.clientWidth,
      content: scroll.scrollWidth - scroll.clientWidth,
      document: document.documentElement.scrollWidth - window.innerWidth,
    }
  })
  expect(overflow.dialog).toBeLessThanOrEqual(1)
  expect(overflow.content).toBeLessThanOrEqual(1)
  expect(overflow.document).toBeLessThanOrEqual(1)
  await expect(dialog.locator('.contest-detail-actions')).toBeInViewport()
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeInViewport()
}

async function capture(page: Page, info: TestInfo, name: string, scenario: string) {
  await mkdir(artifactDirectory, { recursive: true })
  const filename = `${info.project.name}-${name}.png`
  const path = resolve(artifactDirectory, filename)
  await page.screenshot({ path, animations: 'disabled', caret: 'hide' })
  await info.attach(filename, { path, contentType: 'image/png' })
  const source = scenario in scenarios ? scenarios[scenario as keyof typeof scenarios] : null
  await writeFile(
    resolve(artifactDirectory, `${info.project.name}-${name}.json`),
    JSON.stringify(
      {
        filename,
        scenario,
        label: source ? '界面预览 · 公开快照' : '边界测试样本',
        viewport: page.viewportSize(),
        snapshotClock: clock,
        capturedAt: new Date().toISOString(),
        commit: process.env.PREVIEW_HEAD_SHA ?? null,
        workflowMergeSha: process.env.GITHUB_SHA ?? null,
        runId: process.env.GITHUB_RUN_ID ?? null,
        source: source && {
          url: source.url,
          captured_after_utc: source.captured_after_utc,
          server_date: source.server_date,
          response_sha256: source.sha256,
        },
      },
      null,
      2,
    ) + '\n',
  )
}

async function expandSources(dialog: Locator) {
  const sources = dialog.locator('.contest-detail-sources')
  const summary = sources.locator('.contest-detail-sources-summary')
  await summary.click()
  await expect(sources).toHaveAttribute('open', '')
  await summary.evaluate((element) =>
    element.scrollIntoView({ block: 'start', behavior: 'instant' }),
  )
  await expect(sources.locator('.contest-detail-source-heading').first()).toBeInViewport()
  return sources
}

test('capture source-backed full detail and expanded bottom sources', async ({ page }, info) => {
  const dialog = await openPreview(page, 'full')
  await expect(dialog.getByRole('region', { name: '赛事介绍', exact: true })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '参赛条件', exact: true })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '提交与评审', exact: true })).toBeVisible()
  await expect(dialog.locator('.contest-detail-sources')).not.toHaveAttribute('open', '')
  await expect(dialog.getByText('查看覆盖证据', { exact: true })).toHaveCount(0)
  await expect(dialog.getByText('查看原文摘录', { exact: true })).toHaveCount(0)
  await verifyLayout(page, dialog)
  await capture(page, info, 'full', 'full')
  const sources = await expandSources(dialog)
  const urls = await sources
    .locator('a[href]')
    .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href))
  expect(urls.length).toBeGreaterThan(0)
  expect(urls.every((url) => /^https?:\/\//.test(url))).toBeTruthy()
  for (const group of await sources.locator('.contest-detail-source-group').all()) {
    const excerpts = await group
      .locator('.contest-detail-source-excerpt > p:first-child')
      .allTextContents()
    expect(new Set(excerpts).size, 'Each source excerpt is displayed only once').toBe(
      excerpts.length,
    )
  }
  await verifyLayout(page, dialog)
  await capture(page, info, 'full-sources', 'full')
})

test('capture real conflicting participation requirements without choosing a winner', async ({
  page,
}, info) => {
  const dialog = await openPreview(page, 'conflict')
  await expect(dialog.getByText(/来源说法不一|来源有分歧|说法不一/).first()).toBeVisible()
  await verifyLayout(page, dialog)
  await capture(page, info, 'conflict', 'conflict')
  await expandSources(dialog)
  await verifyLayout(page, dialog)
  await capture(page, info, 'conflict-sources', 'conflict')
})

test('capture explicitly synthetic sparse state without empty optional sections', async ({
  page,
}, info) => {
  const dialog = await openPreview(page, 'sparse')
  for (const name of ['参赛条件', '提交与评审', '详细日程'])
    await expect(dialog.getByRole('heading', { name, exact: true })).toHaveCount(0)
  await expect(dialog.getByText(/尚未抓取/).filter({ visible: true })).toHaveCount(0)
  await expect(dialog.getByText(/来源明确未公布/)).toHaveCount(0)
  await expect(dialog.getByRole('link', { name: /报名/ })).toHaveCount(0)
  await verifyLayout(page, dialog)
  await capture(page, info, 'sparse', 'sparse')
})

test('capture a real long reward without horizontal overflow', async ({ page }, info) => {
  const dialog = await openPreview(page, 'long-reward')
  await expect(dialog.getByText(/巨无霸汉堡/).first()).toBeVisible()
  await verifyLayout(page, dialog)
  await capture(page, info, 'long-reward', 'long-reward')
})

test('numbered evidence navigation returns to the same reading position', async ({ page }) => {
  const dialog = await openPreview(page, 'full')
  const scroll = dialog.locator('.contest-detail-scroll')
  const reference = dialog.getByRole('button', { name: /查看.*的信息来源/ }).first()
  await reference.scrollIntoViewIfNeeded()
  const initialPosition = await scroll.evaluate((element) => element.scrollTop)
  await reference.click()
  await expect(dialog.locator('.contest-detail-sources')).toHaveAttribute('open', '')
  const back = dialog.getByRole('button', { name: '返回阅读处', exact: true })
  await back.click()
  await expect(reference).toBeFocused()
  await expect
    .poll(() => scroll.evaluate((element) => element.scrollTop))
    .toBeCloseTo(initialPosition, 0)
  await verifyLayout(page, dialog)
})

test('close and reopen through the real list after snapshot staleness stays network-free', async ({
  page,
}) => {
  let dialog = await openPreview(page, 'full')
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.clock.setFixedTime(new Date('2026-10-24T21:38:51Z'))
  await page.getByRole('link', { name: scenarios.full.response.data.name, exact: true }).click()
  dialog = page.getByRole('dialog', { name: scenarios.full.response.data.name, exact: true })
  await expect(dialog.getByRole('region', { name: '赛事介绍', exact: true })).toBeVisible()
  await verifyLayout(page, dialog)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('default detail entry uses the same consolidated source interaction', async ({ page }) => {
  const dialog = await openPreview(page, 'full', 'default')
  await expect(dialog.locator('.contest-detail-sources')).toHaveCount(1)
  await expect(dialog.getByText('查看覆盖证据', { exact: true })).toHaveCount(0)
  await expandSources(dialog)
  await verifyLayout(page, dialog)
})

test('real follow action toggles locally without account requests', async ({ page }) => {
  const dialog = await openPreview(page, 'full')
  await dialog.getByRole('button', { name: '关注', exact: true }).click()
  const followed = dialog.getByRole('button', { name: '已关注', exact: true })
  await expect(followed).toHaveAttribute('aria-pressed', 'true')
  await followed.click()
  await expect(dialog.getByRole('button', { name: '关注', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await verifyLayout(page, dialog)
})

test('preserves original actions and plain metadata without new warning or icon controls', async ({
  page,
}) => {
  const dialog = await openPreview(page, 'conflict')
  const actions = dialog.locator('.contest-detail-actions')
  await expect(actions.locator(':scope > *')).toHaveText(['去报名', '问侦探这场比赛', '关注'])
  const registration = actions.getByRole('link', { name: '去报名', exact: true })
  await expect(registration).toHaveCSS('height', '40px')
  await expect(registration).toHaveCSS('font-size', '14px')
  await expect(registration.locator('svg.ic')).toHaveCSS('width', '16px')
  await expect(registration.locator('svg use')).toHaveAttribute('href', '#i-arrow-right')
  const ask = actions.getByRole('button', { name: '问侦探这场比赛', exact: true })
  await expect(ask).toHaveClass('site-button site-button--outline')
  await expect(ask).toHaveCSS('height', '40px')
  await expect(ask.locator('svg')).toHaveCount(0)
  await expect(actions.getByRole('button', { name: '关注', exact: true })).toHaveCSS(
    'height',
    '32px',
  )
  await expect(dialog).toHaveCSS('font-family', /Inkpaw Contest Sans/)
  await expect(dialog.locator('.contest-detail-notice')).toHaveCount(0)
  await expect(
    dialog.locator(
      '.lucide-sparkles, .lucide-calendar-days, .lucide-map-pin, .lucide-circle-alert',
    ),
  ).toHaveCount(0)
  const pending = dialog.getByLabel('参赛前待确认')
  await expect(pending).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(pending).toHaveCSS('border-left-width', '0px')
  await expect(pending).toHaveCSS('padding-left', '0px')
  await expect(dialog.getByText('来源说法不一，待核实', { exact: true }).first()).toBeVisible()
  await verifyLayout(page, dialog)
})
