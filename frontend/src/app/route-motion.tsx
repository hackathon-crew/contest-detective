import type { ReactNode } from 'react'
import { useLocation } from 'react-router'

import './route-motion.css'

/** 详情属于浏览页，会话地址属于侦探页；这些地址变化不能重建整页或重播入场。 */
export function RouteMotionSurface({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const page = /^\/detective(?:\/|$)/.test(pathname) ? 'detective' : 'home'

  return (
    <div key={page} className="route-motion-surface" data-route-motion={page}>
      {children}
    </div>
  )
}
