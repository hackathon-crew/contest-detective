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

import { HomePage } from '@/pages/home'
import { McpDialog } from '@/pages/home/mcp-dialog'
import { ContestsPage } from '@/pages/contests'
import { DetectivePage } from '@/pages/detective'
import { DetectiveProvider } from '@/features/detective'
import { useCurrentUser } from '@/entities/user'
import { AuthPage } from '@/features/auth'
import { AppearanceControl } from '@/features/appearance'
import { queryClient } from './query-client'
import { RouteMotionSurface } from './route-motion'

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <NuqsAdapter>
          <AppRoutes />
        </NuqsAdapter>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

/** 路由表单独导出，测试用 MemoryRouter 验证直接打开某个地址的情况。 */
export function AppRoutes() {
  const location = useLocation()
  const background = location.state?.backgroundLocation as Location | undefined
  const contestId = matchPath('/contests/:contestId', location.pathname)?.params.contestId
  const { data: user } = useCurrentUser()
  if (location.pathname === '/login' || location.pathname === '/register') {
    return (
      <AuthPage
        key={location.pathname}
        mode={location.pathname === '/register' ? 'register' : 'login'}
        utilities={<AppearanceControl />}
      />
    )
  }
  return (
    <DetectiveProvider key={user?.id ?? 'guest'} scope={user?.id ?? 'guest'}>
      <RouteMotionSurface>
        <Routes location={background ?? location}>
          <Route path="/detective" element={<DetectivePage />} />
          <Route path="/detective/:conversationId" element={<DetectivePage />} />
          <Route path="/contests" element={<ContestsPage contestId={contestId} />} />
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
