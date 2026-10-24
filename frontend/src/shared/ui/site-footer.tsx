import type { ReactNode } from 'react'
import { Link } from 'react-router'
import folder from '@/shared/assets/stickers/folder.png'
import { SiteBrand } from './site-header'
import './site.css'
const year = new Date().getFullYear()
const github = 'https://github.com/hackathon-crew/contest-detective'
const groups = [
  [
    '产品',
    [
      ['赛事库', '/contests'],
      ['问侦探', '/detective'],
      ['画像匹配', '/#filter'],
      ['MCP 接入', '/#mcp'],
    ],
  ],
  [
    '资源',
    [
      ['使用说明', github + '#readme'],
      ['更新记录', github + '/releases'],
      ['问题反馈', github + '/issues'],
      ['参与开发', github + '/blob/main/CONTRIBUTING.md'],
    ],
  ],
  [
    '团队',
    [
      ['黑客松', 'https://github.com/hackathon-crew'],
      ['huyan', 'https://github.com/huyanxius'],
      ['SilasVista', 'https://github.com/xiaocheny214'],
    ],
  ],
  [
    '联系',
    [
      ['【团队邮箱】', ''],
      ['提交问题', github + '/issues/new'],
      ['GitHub 仓库', github],
    ],
  ],
] as const
export function SiteFooter({ appearance }: { appearance: ReactNode }) {
  return (
    <footer className="site-footer">
      <img
        className="site-folder pixel-art pixel-double"
        src={folder}
        width={158}
        height={150}
        alt=""
      />
      <div className="site-wrap">
        <div className="site-foot">
          <div className="site-foot-brand">
            <SiteBrand />
            <p>帮大学生找比赛、核对截止时间的侦探。每条信息都附原文链接。</p>
          </div>
          {groups.map(([title, links]) => (
            <div className="site-foot-col" key={title}>
              <h3>{title}</h3>
              <ul>
                {links.map(([label, href]) => (
                  <li key={label}>
                    {href.startsWith('/') ? (
                      <Link to={href}>{label}</Link>
                    ) : href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {label}
                      </a>
                    ) : (
                      <span className="select-all">{label}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="site-foot-bottom">
          <span>
            © {year} Inkpaw · {import.meta.env.VITE_BUILD_VERSION}
          </span>
          <span className="site-source">
            赛事信息整理自 Devpost、ETHGlobal、HackerTrip、活动行、WaytoAGI 和主办方公众号
          </span>
          {appearance}
        </div>
      </div>
    </footer>
  )
}
