import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { LibraryRows } from '@/features/contest-browser'
import { ContestDetail } from '@/features/contest-detail'
import { FollowButton, type FollowController } from '@/features/follow'
import { libraryDate, type LibraryRow } from '@/entities/contest'
import { SiteHeader } from '@/shared/ui/site-header'
import { detailPreviewScenarios, type DetailPreviewScenario } from './detail-preview-fixtures'
import './index.css'
import './pages/contests/contests-page.css'
import './detail-preview.css'

// This isolated Vite entry is not referenced by main.tsx or the production build.
const requested = new URLSearchParams(location.search).get('scenario')
const scenario: DetailPreviewScenario =
  requested && requested in detailPreviewScenarios ? (requested as DetailPreviewScenario) : 'full'
const variant =
  new URLSearchParams(location.search).get('variant') === 'default' ? 'default' : 'library'
const contests = Object.values(detailPreviewScenarios)
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
for (const contest of contests) client.setQueryData(['contest', contest.id], contest)

// Even if a query becomes stale while someone inspects the preview, it stays local.
// Unknown API paths fail closed rather than reaching a backend, profile or model.
const originalFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    location.origin,
  )
  if (url.pathname.startsWith('/api/')) {
    const contest = contests.find((item) => url.pathname === `/api/contests/${item.id}`)
    if (!contest || (init?.method && init.method !== 'GET'))
      throw new Error('Read-only detail preview does not call this API.')
    return Response.json({ code: 200, message: 'Preview snapshot', data: contest })
  }
  return originalFetch(input, init)
}

export function DetailPreview() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [question, setQuestion] = useState('')
  const [followed, setFollowed] = useState<string[]>([])
  const follows: FollowController = {
    ids: followed,
    pending: false,
    error: null,
    toggle: (id) =>
      setFollowed((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])),
  }
  const selected = contests.find((contest) => pathname === `/contests/${contest.id}`)
  const rows: LibraryRow[] = contests.map((contest) => ({
    type: 'one',
    id: contest.id,
    contests: [contest],
    key: libraryDate(contest),
    start: null,
  }))
  return (
    <div className="contests-page detail-preview-page">
      <SiteHeader
        actions={
          <span className="detail-preview-badge">
            {selected?.id === 'preview-sparse-only' ? '边界测试样本' : '界面预览 · 公开快照'}
          </span>
        }
      />
      <main className="site-wrap detail-preview-main">
        <h1>赛事库</h1>
        <p className="detail-preview-note">
          公开数据快照：2026-10-24。此预览仅展示界面，不发起报名、搜索或模型请求。
        </p>
        <LibraryRows
          rows={rows}
          renderAction={(id) => <FollowButton contestId={id} follows={follows} iconOnly />}
        />
        {question && <p role="status">预览已记录问题，不发起真实请求：{question}</p>}
      </main>
      {selected && (
        <ContestDetail
          key={selected.id}
          contestId={selected.id}
          variant={variant}
          onClose={() => void navigate('/contests')}
          onAsk={(contest) => setQuestion(contest.name)}
          action={<FollowButton contestId={selected.id} follows={follows} />}
        />
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[`/contests/${detailPreviewScenarios[scenario].id}`]}>
      <DetailPreview />
    </MemoryRouter>
  </QueryClientProvider>,
)
