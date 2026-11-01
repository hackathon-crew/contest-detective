import { useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { Popover } from 'radix-ui'
import { Menu } from 'lucide-react'
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

function SiteLinks() {
  const location = useLocation()
  return (
    <div className="site-links">
      <NavLink to="/contests" className="site-button site-button--ghost">
        赛事库
      </NavLink>
      <NavLink to="/detective" className="site-button site-button--ghost">
        侦探
      </NavLink>
      <Link
        to={{ pathname: location.pathname, search: location.search, hash: '#mcp' }}
        state={location.state}
        className="site-button site-button--ghost"
        aria-haspopup="dialog"
      >
        MCP
      </Link>
      <a
        className="site-button site-button--ghost site-button--icon"
        href="https://github.com/hackathon-crew/contest-detective"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="GitHub 仓库"
      >
        <Icon name="github" large />
      </a>
    </div>
  )
}

export function SiteHeader({ actions, utilities }: { actions?: ReactNode; utilities?: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <header className="site-header">
      <SiteSymbols />
      <div className="site-wrap">
        <SiteBrand />
        <nav className="site-nav" aria-label="主导航">
          <SiteLinks />
          {actions}
          {utilities}
          <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                className="site-button site-button--ghost site-menu-toggle"
                aria-label={menuOpen ? '关闭导航菜单' : '打开导航菜单'}
              >
                <Menu aria-hidden="true" size={18} strokeWidth={1.75} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                sideOffset={12}
                collisionPadding={24}
                className="site-mobile-menu"
                aria-label="导航菜单"
              >
                <nav aria-label="手机导航" onClick={() => setMenuOpen(false)}>
                  <SiteLinks />
                </nav>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </nav>
      </div>
    </header>
  )
}
