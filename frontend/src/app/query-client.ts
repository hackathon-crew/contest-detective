import { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/shared/api'

/**
 * 只重试可能自己恢复的失败（网络断开、5xx），最多两次。业务错误和格式错误重试也是同样结果，
 * 直接交给页面提示。staleTime 一分钟：赛事库每天同步一次，切回页面不必每次重新请求。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: (failureCount, error) =>
        failureCount < 2 && (!(error instanceof ApiError) || error.retryable),
    },
  },
})
