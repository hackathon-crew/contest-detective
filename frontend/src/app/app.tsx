import { lazy, Suspense } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  matchPath,
  type Location,
} from 'react-router'

import { NuqsAdapter } from 'nuqs/adapters/react-router/v8'

import { AccountPage } from '@/pages/account/account-page'
import { HomePage } from '@/pages/home'
import { McpDialog } from '@/pages/home/mcp-dialog'
import { ContestsPage } from '@/pages/contests'
import { DetectivePage } from '@/pages/detective'
import { DetectiveProvider } from '@/features/detective'
import { useCurrentUser } from '@/entities/user'
import { AuthPage } from '@/features/auth'
import { AppearanceControl } from '@/features/appearance'
import { useLocale } from '@/shared/i18n/locale-context'
import { LocaleProvider } from '@/shared/i18n/locale-provider'
import { LanguageControl } from '@/shared/ui/language-control'
import { queryClient } from './query-client'
import { RouteMotionSurface } from './route-motion'

const LivePage = lazy(() => import('@/pages/live/live-page'))

export function App() {
  return (
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <NuqsAdapter>
            <AppRoutes />
          </NuqsAdapter>
        </BrowserRouter>
      </QueryClientProvider>
    </LocaleProvider>
  )
}

/** 路由表单独导出，测试用 MemoryRouter 验证直接打开某个地址的情况。 */
export function AppRoutes() {
  const { t } = useLocale()
  const location = useLocation()
  const background = location.state?.backgroundLocation as Location | undefined
  const contestId = matchPath('/contests/:contestId', location.pathname)?.params.contestId
  const { data: user, isPending } = useCurrentUser()
  if (location.pathname === '/login' || location.pathname === '/register') {
    return (
      <AuthPage
        key={location.pathname}
        mode={location.pathname === '/register' ? 'register' : 'login'}
        utilities={
          <div className="flex items-center gap-1">
            <LanguageControl />
            <AppearanceControl />
          </div>
        }
      />
    )
  }
  if (location.pathname === '/' && user) {
    return (
      <Navigate
        to={{ pathname: '/detective', search: location.search, hash: location.hash }}
        state={location.state}
        replace
      />
    )
  }
  if (/^\/(?:detective|live)(?:\/|$)/.test(location.pathname) && isPending) {
    return (
      <main aria-busy="true">
        <p role="status">{t('正在确认登录状态…')}</p>
      </main>
    )
  }
  return (
    <DetectiveProvider key={user?.id ?? 'guest'} scope={user?.id ?? 'guest'}>
      <RouteMotionSurface>
        <Routes location={background ?? location}>
          <Route path="/account" element={<Navigate to="/account/profile" replace />} />
          <Route path="/account/:tab" element={<AccountPage />} />
          <Route
            path="/live"
            element={
              <Suspense fallback={<main aria-busy="true" />}>
                <LivePage />
              </Suspense>
            }
          />
          <Route
            path="/live/:conversationId"
            element={
              <Suspense fallback={<main aria-busy="true" />}>
                <LivePage />
              </Suspense>
            }
          />
          <Route path="/detective" element={<DetectivePage />} />
          <Route path="/detective/:conversationId" element={<DetectivePage />} />
          <Route path="/contests" element={<ContestsPage contestId={contestId} />} />
          <Route path="/home" element={<HomePage contestId={contestId} />} />
          <Route path="/" element={<HomePage contestId={contestId} />}>
            {/*
             * 分享的详情地址落在首页；从卡片进入时，background 保留首页或赛事库的实例。
             * 弹窗开关只改变 contestId，筛选、日历月份和滚动位置继续保留。
             */}
            <Route path="contests/:contestId" element={null} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </RouteMotionSurface>
      <McpDialog />
    </DetectiveProvider>
  )
}
