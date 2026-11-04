import { expect, test, type Page } from '@playwright/test'
import type { ContestRecommendation } from '../src/shared/api/generated/types.gen.js'

const recommendations: ContestRecommendation[] = Array.from({ length: 5 }, (_, index) => ({
  contest: {
    id: `live-${index + 1}`,
    name: `测试赛事 ${index + 1}`,
    cover_url: null,
    status: 'upcoming',
    summary: null,
    fields: {
      submission_deadline: {
        value: '2026-12-01',
        level: 'official',
        precision: 'day',
        sources: [
          {
            url: `https://contest.example/${index + 1}`,
            site: '官方站点',
            title: '规则',
            is_official: true,
            value: '2026-12-01',
            excerpt: '作品提交截至12月1日',
          },
        ],
      },
    },
  },
  reason: '来自本轮查到的赛事资料。',
}))

async function intercept(
  page: Page,
  content: string,
  cards: ContestRecommendation[],
  search = true,
) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/guest/ask')) {
        const events = [
          ...(search
            ? [
                { type: 'step', data: { tool: 'search_contests', label: '查询比赛库' } },
                {
                  type: 'observation',
                  data: {
                    tool: 'search_contests',
                    summary: `找到 ${cards.length} 场比赛，本页 ${cards.length} 场`,
                    sources: [],
                  },
                },
              ]
            : []),
          { type: 'answer', data: { content, sources: [], recommendations: cards } },
        ]
        await route.fulfill({
          contentType: 'text/event-stream',
          body: events
            .map(
              (event, index) =>
                `id: ${index + 1}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
            )
            .join(''),
        })
        return
      }
      await route.fulfill({
        json: {
          code: 200,
          message: 'ok',
          data: path.endsWith('/auth/me')
            ? null
            : path.endsWith('/guest-quota')
              ? { limit: 3, remaining: 3, resets_at: '2026-12-01T00:00:00+08:00' }
              : [],
        },
      })
    },
  )
  return errors
}

test('五张卡完成递送、换焦点、翻面和持久收下，舞台持续运行且没有逐帧异常', async ({ page }) => {
  const errors = await intercept(page, '找到五场比赛，逐张看来源。', recommendations)
  await page.goto('/live')
  await page.getByRole('textbox', { name: '问八爪鱼' }).fill('找五场比赛')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('button', { name: '全部收下' })).toBeVisible()
  await expect(page.locator('#stage canvas.stage-px')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await page.getByRole('button', { name: '翻面', exact: true }).click()
  await expect(page.locator('.live-source-links a').first()).toHaveAttribute(
    'href',
    'https://contest.example/2',
  )
  await page.getByRole('button', { name: '全部收下' }).click()
  await expect(page.getByRole('button', { name: /卡册\s*5/ })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: /卡册\s*5/ })).toBeVisible()
  await page.getByRole('button', { name: /卡册\s*5/ }).click()
  await expect(
    page.getByRole('dialog', { name: '卡册' }).getByRole('button', { name: /^测试赛事/ }),
  ).toHaveCount(5)
  expect(errors).toEqual([])
})

test('无推荐的长 Markdown 不递卡，完整回答可以在记录读取', async ({ page }) => {
  const content = `## 说明\n\n${'这段解释没有比赛推荐。'.repeat(60)}\n\n全文末尾`
  const errors = await intercept(page, content, [], false)
  await page.goto('/live')
  await page.getByRole('textbox', { name: '问八爪鱼' }).fill('解释一下')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('button', { name: '点一下看完这句' })).toBeVisible()
  await expect(page.getByRole('button', { name: '收下', exact: true })).toBeHidden()
  await page.getByRole('button', { name: '记录', exact: true }).click()
  await expect(page.locator('#log').getByText('全文末尾', { exact: true })).toBeVisible()
  await expect(page.locator('#log').getByRole('button', { name: /项检索/ })).toHaveCount(0)
  expect(errors).toEqual([])
})
