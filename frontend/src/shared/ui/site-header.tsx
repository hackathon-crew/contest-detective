import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router'
import inkpawMark from '@/shared/assets/inkpaw-mark-56.webp'
import { Icon, SiteSymbols } from './site-icon'
import './site.css'
export function SiteBrand() {
  return (
    <Link to="/" className="site-brand" aria-label="Inkpaw 首页">
      <img src={inkpawMark} width={48} height={42} alt="" className="pixel-art" decoding="async" />
      <span>Inkpaw</span>
    </Link>
  )
}
export function SiteHeader({ actions, utilities }: { actions?: ReactNode; utilities?: ReactNode }) {
  return (
    <header className="site-header">
      <SiteSymbols />
      <div className="site-wrap">
        <SiteBrand />
        <nav className="site-nav" aria-label="主导航">
          <div className="site-links">
            <NavLink to="/contests" className="site-button site-button--ghost">
              赛事库
            </NavLink>
            <NavLink to="/detective" className="site-button site-button--ghost">
              侦探
            </NavLink>
            <Link to="/#mcp" className="site-button site-button--ghost">
              MCP
            </Link>
          </div>
          {actions}
          <a
            className="site-button site-button--ghost site-button--icon"
            href="https://github.com/hackathon-crew/contest-detective"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub 仓库"
          >
            <Icon name="github" large />
          </a>
          {utilities}
        </nav>
      </div>
    </header>
  )
}
