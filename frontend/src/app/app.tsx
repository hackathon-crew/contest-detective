import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import { NuqsAdapter } from 'nuqs/adapters/react-router/v8'

import { HomePage } from '@/pages/home'
import { DetectivePage } from '@/pages/detective'
import { DetectiveProvider } from '@/features/detective'
import { useCurrentUser } from '@/entities/user'
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
  const { data: user } = useCurrentUser()
  return (
    <DetectiveProvider key={user?.id ?? 'guest'} scope={user?.id ?? 'guest'}>
      <RouteMotionSurface>
        <Routes>
          <Route path="/detective" element={<DetectivePage />} />
          <Route path="/detective/:conversationId" element={<DetectivePage />} />
          <Route path="/" element={<HomePage />}>
            {/*
             * 详情是首页上的弹窗，不是独立页面。子路由只负责让地址可分享，首页按地址决定开不开详情；
             * 放在首页下面而不是并列，开关详情时首页不会被卸载，列表的筛选和滚动位置都还在。
             */}
            <Route path="contests/:contestId" element={null} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </RouteMotionSurface>
    </DetectiveProvider>
  )
}
