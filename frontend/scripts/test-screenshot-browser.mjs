import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const base = 'http://127.0.0.1:4175'
const output = resolve('test-results/screenshot-ocr')
const fixtures = [
  'clean-light.png',
  'clean-light.jpg',
  'clean-light.webp',
  'clean-dark.png',
  'small-text.png',
  'mixed-language.png',
  'blank.png',
  'blurred.png',
]

/** 入口被产品有意禁用属于跳过，不是回归；入口缺失或状态不一致仍然失败。 */
class ScreenshotEntryDisabled extends Error {}
const correctedClaim = '海风创意编程赛报名截止是 2026 年 10 月 30 日'
// Deliberately synthetic: the browser integration never performs a provider query.
const report = {
  version: 1,
  mode: 'deep',
  status: 'incomplete',
  generated_at: '2026-10-25T05:00:00Z',
  plan: {
    mode: 'deep',
    steps: [
      {
        id: 'step-1',
        purpose: '测试替身：核对公开赛事截止',
        query: '海风创意编程赛报名截止',
        claim_ids: ['screenshot-1'],
      },
    ],
  },
  queries: [
    {
      id: 'query-1',
      step_id: 'step-1',
      round: 1,
      query: '海风创意编程赛报名截止',
      provider: 'yuanbao',
      status: 'success',
      executed_at: '2026-10-25T05:00:00Z',
      result_count: 1,
      error_code: null,
    },
  ],
  claims: [
    {
      id: 'screenshot-1',
      text: correctedClaim,
      verdict: 'insufficient',
      source_level: 'reposted',
      evidence_ids: ['evidence-1'],
      comparison: '测试替身只有一条转载线索，不能确认原始说法。',
      limitations: ['测试数据，不是真实查证结论。'],
    },
  ],
  evidence: [
    {
      id: 'evidence-1',
      title: '测试替身赛事规则',
      url: 'https://example.org/rules',
      excerpt: '测试摘录：需要核对主办方原文。',
      content_hash: null,
      retrieved_at: '2026-10-25T05:00:00Z',
      evidence_kind: 'search_snippet',
      provider: 'yuanbao',
      query_ids: ['query-1'],
      source_level: 'reposted',
      source_lineage: 'https://example.org',
      historical: false,
    },
  ],
  limitations: ['仅测试报告界面，未调用真实搜索。'],
}
await mkdir(output, { recursive: true })
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '4175',
    '--strictPort',
  ],
  { stdio: 'pipe' },
)
let browser
let page
const evidence = {
  runtime: 'Chromium, real self-hosted Tesseract WASM',
  synthetic_fixtures: true,
  provider_calls: 0,
  requests: [],
  results: [],
  errors: [],
}
try {
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(base)).ok) break
    } catch {
      /* Wait for the owned test server. */
    }
    if (attempt >= 60) throw new Error('Preview server failed to start')
    await new Promise((done) => setTimeout(done, 250))
  }
  browser = await chromium.launch()
  const context = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block',
  })
  const asks = []
  context.on('request', (request) =>
    evidence.requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData(),
    }),
  )
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== base) {
      await route.abort('blockedbyclient')
      throw new Error(`Unexpected external request: ${url.origin}`)
    }
    if (url.pathname === '/api/agent/ask') {
      asks.push(JSON.parse(request.postData()))
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `event: plan\ndata: ${JSON.stringify(report.plan)}\n\nevent: answer\ndata: ${JSON.stringify({ content: '仅测试报告', sources: [], report })}\n\n`,
      })
    } else if (url.pathname.startsWith('/api/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 200, message: 'ok', data: null }),
      })
    } else await route.continue()
  })
  page = await context.newPage()
  page.on('pageerror', (error) => evidence.errors.push(error.message))
  await page.goto(`${base}/detective`)
  const open = async () => {
    await page.getByRole('button', { name: '添加简历或参赛资料' }).click()
    const entry = page.getByRole('menuitem', { name: '截图查证' })
    await expect(entry).toBeVisible()
    if ((await entry.getAttribute('aria-disabled')) === 'true') {
      // 禁用状态与文案必须一致；否则说明产品状态处于半途，按失败处理。
      await expect(entry).toHaveText(/暂不可用/)
      await page.screenshot({ path: `${output}/disabled-entry.png`, fullPage: true })
      expect(evidence.requests.some((request) => request.url.includes('/ocr/'))).toBe(false)
      await page.keyboard.press('Escape')
      throw new ScreenshotEntryDisabled(
        '截图查证入口当前被禁用（aria-disabled=true）；恢复入口后脚本会自动执行完整 OCR 校验。',
      )
    }
    // 可点击却仍标注暂不可用，说明禁用状态和文案不一致，不能当成正常流程。
    await expect(entry).not.toHaveText(/暂不可用/)
    await entry.click()
    return page.getByRole('dialog', { name: '截图查证' })
  }
  for (const file of fixtures) {
    const fixture = file.replace(/\.[^.]+$/, '')
    const dialog = await open()
    await dialog
      .getByLabel('选择截图', { exact: true })
      .setInputFiles(resolve(`tests/fixtures/${file}`))
    if (fixture === 'blank') {
      await expect(dialog.getByText(/没有识别到可查证的文字/)).toBeVisible({ timeout: 60_000 })
      evidence.results.push({ fixture: file, text: '', no_text: true })
    } else {
      await expect(dialog.getByLabel('说法 1', { exact: true })).toBeVisible({ timeout: 60_000 })
      const text = await dialog
        .locator('textarea')
        .evaluateAll((items) => items.map((item) => item.value))
      const compact = text.join('').replace(/\s/g, '')
      if (fixture === 'clean-light' || fixture === 'clean-dark')
        expect(compact).toContain('2026年10月30日')
      if (fixture === 'mixed-language') expect(compact).toContain('USD5,000')
      if (fixture === 'blurred') await expect(dialog.getByText(/部分文字辨识度较低/)).toBeVisible()
      if (fixture === 'small-text') await expect(dialog.getByText(/截图中的文字较小/)).toBeVisible()
      evidence.results.push({ fixture: file, recognized_text: text })
    }
    expect(asks).toHaveLength(0)
    await expect(dialog.getByRole('button', { name: '确认文字并查证' })).toBeDisabled()
    if (fixture === 'clean-light') await page.screenshot({ path: `${output}/desktop-review.png` })
    if (file === 'clean-light.webp') await page.keyboard.press('Escape')
    else await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByRole('button', { name: '添加简历或参赛资料' })).toBeFocused()
    await expect.poll(() => page.workers().length).toBe(0)
  }
  // Only selected and corrected claims may leave the browser.
  const dialog = await open()
  await dialog
    .getByLabel('选择截图', { exact: true })
    .setInputFiles(resolve('tests/fixtures/clean-light.png'))
  await expect(dialog.getByLabel('说法 1', { exact: true })).toBeVisible({ timeout: 60_000 })
  await dialog
    .getByLabel('说法 1', { exact: true })
    .fill('海风创意编程赛报名截止是 2026 年 10 月 30 日')
  await dialog.getByLabel('查证这条说法 1', { exact: true }).check()
  await expect(dialog.getByRole('combobox')).toHaveCount(0)
  await dialog.getByRole('button', { name: '确认文字并查证' }).click()
  await expect.poll(() => asks.length).toBe(1)
  expect(asks[0]).toMatchObject({
    mode: 'deep',
    question: '海风创意编程赛报名截止是 2026 年 10 月 30 日',
    confirmed_claims: [
      {
        id: 'screenshot-1',
        text: '海风创意编程赛报名截止是 2026 年 10 月 30 日',
        origin: 'screenshot',
      },
    ],
  })
  expect(asks[0].confirmed_claims).toHaveLength(1)
  expect(JSON.stringify(asks)).not.toContain('clean-light.png')
  expect(JSON.stringify(asks)).not.toContain('团队')
  expect(evidence.requests.filter((request) => request.method !== 'GET')).toHaveLength(1)
  const panel = page.getByRole('complementary', { name: '研究面板' })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('查证未完成', { exact: true })).toBeVisible()
  await expect(panel.getByText('调查计划', { exact: true })).toBeVisible()
  const reportView = page
    .getByRole('log', { name: '对话内容' })
    .getByRole('region', { name: '查证报告' })
  await expect(reportView.getByRole('heading', { name: correctedClaim, exact: true })).toBeVisible()
  await expect(reportView.getByText('查证未完成', { exact: true })).toBeVisible()
  await expect(reportView.getByText('证据不足', { exact: true })).toBeVisible()
  await expect(reportView.getByText('查证完成', { exact: true })).toHaveCount(0)
  await expect(reportView.getByText('调查计划', { exact: true })).toBeVisible()
  await expect(
    reportView.getByRole('link', { name: '测试替身赛事规则', exact: true }),
  ).toHaveAttribute('href', 'https://example.org/rules')
  const downloaded = page.waitForEvent('download')
  await reportView.getByRole('button', { name: '下载 JSON', exact: true }).click()
  const download = await downloaded
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'))
  expect(exported).toEqual(report)
  evidence.report_export = exported
  await reportView
    .getByRole('heading', { name: '深度调查报告', exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${output}/report-review.png` })
  await panel.getByRole('button', { name: '关闭研究面板', exact: true }).click()
  // Close during model initialization, including the nested worker.
  let releaseLanguage
  const languageGate = new Promise((done) => {
    releaseLanguage = done
  })
  await context.route('**/ocr/lang/*', async (route) => {
    await languageGate
    await route.continue().catch(() => {})
  })
  const cancelDialog = await open()
  const loading = page.waitForRequest((request) => request.url().includes('/ocr/lang/'))
  await cancelDialog
    .getByLabel('选择截图', { exact: true })
    .setInputFiles(resolve('tests/fixtures/clean-light.png'))
  await loading
  await cancelDialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect.poll(() => page.workers().length).toBe(0)
  releaseLanguage()
  await context.unroute('**/ocr/lang/*')
  // A replacement cancels the old owner and its child before the next OCR finishes.
  let releaseReplacement
  const replacementGate = new Promise((done) => {
    releaseReplacement = done
  })
  await context.route('**/ocr/lang/*', async (route) => {
    await replacementGate
    await route.continue().catch(() => {})
  })
  const replaceDialog = await open()
  const firstLoading = page.waitForRequest((request) => request.url().includes('/ocr/lang/'))
  await replaceDialog
    .getByLabel('选择截图', { exact: true })
    .setInputFiles(resolve('tests/fixtures/clean-light.png'))
  await firstLoading
  const oldWorkers = [...page.workers()]
  await replaceDialog
    .getByLabel('选择截图', { exact: true })
    .setInputFiles(resolve('tests/fixtures/blank.png'))
  await expect.poll(() => oldWorkers.every((worker) => !page.workers().includes(worker))).toBe(true)
  releaseReplacement()
  await context.unroute('**/ocr/lang/*')
  await expect(replaceDialog.getByText(/没有识别到可查证的文字/)).toBeVisible({ timeout: 60_000 })
  await replaceDialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect.poll(() => page.workers().length).toBe(0)
  // Timeout must clean an initializing child, not just report an error to the UI.
  let releaseTimeout
  const timeoutGate = new Promise((done) => {
    releaseTimeout = done
  })
  await context.route('**/ocr/lang/*', async (route) => {
    await timeoutGate
    await route.continue().catch(() => {})
  })
  const timeoutDialog = await open()
  await timeoutDialog
    .getByLabel('选择截图', { exact: true })
    .setInputFiles(resolve('tests/fixtures/clean-light.png'))
  await expect(timeoutDialog.getByText(/图片识别超时/)).toBeVisible({ timeout: 55_000 })
  await expect.poll(() => page.workers().length).toBe(0)
  releaseTimeout()
  await context.unroute('**/ocr/lang/*')
  await timeoutDialog.getByRole('button', { name: '取消', exact: true }).click()
  // Resource failure remains a failure, with no synthesized text or leaked worker.
  await context.route('**/ocr/lang/*', (route) => route.abort('failed'))
  const errorDialog = await open()
  await errorDialog
    .getByLabel('选择截图', { exact: true })
    .setInputFiles(resolve('tests/fixtures/clean-light.png'))
  await expect(errorDialog.getByRole('alert')).toBeVisible({ timeout: 15_000 })
  await expect(errorDialog.getByRole('button', { name: '确认文字并查证' })).toBeDisabled()
  await expect.poll(() => page.workers().length).toBe(0)
  await errorDialog.getByRole('button', { name: '取消', exact: true }).click()
  await context.unroute('**/ocr/lang/*')
  const immediateDialog = await open()
  await immediateDialog
    .getByLabel('选择截图', { exact: true })
    .setInputFiles(resolve('tests/fixtures/clean-light.png'))
  await immediateDialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect.poll(() => page.workers().length).toBe(0)
  expect(asks).toHaveLength(1)
  // Narrow viewport: shared dialog scroll area must not hide confirmation/close.
  await page.setViewportSize({ width: 390, height: 844 })
  const mobile = await open()
  await mobile
    .getByLabel('选择截图', { exact: true })
    .setInputFiles(resolve('tests/fixtures/clean-light.png'))
  await expect(mobile.getByLabel('说法 1', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(mobile.getByRole('button', { name: '确认文字并查证' })).toBeInViewport()
  await expect(mobile.getByRole('button', { name: '关闭', exact: true })).toBeInViewport()
  await page.screenshot({ path: `${output}/mobile-review.png` })
  await mobile.getByRole('button', { name: '取消', exact: true }).click()
  const names = evidence.requests
    .filter((request) => request.url.includes('/ocr/'))
    .map((request) => new URL(request.url).pathname)
  expect(names.some((name) => name.endsWith('.wasm.js'))).toBe(true)
  expect(names.some((name) => name.endsWith('chi_sim.traineddata.gz'))).toBe(true)
  expect(names.some((name) => name.endsWith('eng.traineddata.gz'))).toBe(true)
  expect(evidence.errors).toEqual([])
  evidence.confirmation_payload = asks[0]
  evidence.status = 'passed'
} catch (error) {
  if (error instanceof ScreenshotEntryDisabled) {
    evidence.status = 'skipped'
    evidence.skip_reason = error.message
    evidence.skipped_fixtures = fixtures
  } else {
    evidence.status = 'failed'
    evidence.remaining_workers = page?.workers().map((worker) => worker.url())
    await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {})
    evidence.failure = String(error.stack ?? error)
    throw error
  }
} finally {
  await writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2) + '\n')
  await browser?.close()
  server.kill('SIGTERM')
}
