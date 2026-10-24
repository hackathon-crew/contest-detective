import { useEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router'

import './route-motion.css'

/** 详情属于浏览页，会话地址属于侦探页；这些地址变化不能重建整页或重播入场。 */
export function RouteMotionSurface({ children }: { children: ReactNode }) {
  const location = useLocation()
  const pathname = location.state?.backgroundLocation?.pathname ?? location.pathname
  const page = /^\/detective(?:\/|$)/.test(pathname)
    ? 'detective'
    : pathname === '/contests'
      ? 'contests'
      : 'home'
  useEffect(() => {
    // 换页面从顶部开始；详情和查询条件仍属于原页，保留它们的滚动位置。
    document.documentElement.scrollTop = 0
  }, [page])

  return (
    <div key={page} className="route-motion-surface" data-route-motion={page}>
      {children}
    </div>
  )
}
