import { useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { Eye } from 'lucide-react'
import type { ProfileMatchSection } from '@/features/profile-match'
import { useScrollProgress } from '@/shared/lib/use-scroll-progress'
import { Icon } from '@/shared/ui/site-icon'
import note from '@/shared/assets/stickers/note.png'
import search from '@/shared/assets/mascot/octo-search.png'
import read from '@/shared/assets/mascot/octo-read.png'
import peer from '@/shared/assets/mascot/octo-peer.png'
import happy from '@/shared/assets/mascot/octo-happy.png'
import mark from '@/shared/assets/inkpaw-mark-32.webp'
import { usePreviewReveal } from './home-content'
import { useLocale } from '@/shared/i18n/locale-context'

const paypalCover =
  'https://d112y698adiu2z.cloudfront.net/photos/production/challenge_thumbnails/005/288/985/datas/medium_square.png'
const paypalUrl = 'https://paypalaihackathon.devpost.com/'

function Demo({ kind, mascot, children }: { kind: string; mascot: string; children: ReactNode }) {
  const { host, visible } = usePreviewReveal()
  useScrollProgress(host, 'window')
  return (
    <div className="stagebox" ref={host}>
      <img className="peek pixel-art" src={mascot} alt="" width={120} height={120} />
      <div className="demo" data-demo={kind} data-playing={visible}>
        <div className="win">{children}</div>
      </div>
    </div>
  )
}

export function HomeFeatures({
  onAsk,
  onAddProfile,
}: {
  onAsk: () => void
  onAddProfile: (section: ProfileMatchSection) => void
}) {
  const { t } = useLocale()
  const location = useLocation()
  const [copied, setCopied] = useState(false)
  const endpoint = new URL('/mcp', window.location.origin).href
  async function copyEndpoint() {
    await navigator.clipboard.writeText(endpoint)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  return (
    <section className="feats" aria-label={t('Inkpaw 能做的事')}>
      <div className="feat" id="research">
        <div>
          <h2>{t('一句话，查清一场比赛')}</h2>
          <p>{t('去读主办方原文，说法打架就把两边都摆出来。')}</p>
          <div className="acts">
            <button type="button" className="btn primary" onClick={onAsk}>
              {t('问侦探')}
              <Icon name="arrow-right" />
            </button>
            <Link className="btn quiet" to="/contests">
              {t('浏览赛事库')}
            </Link>
          </div>
          <img className="stk pixel-art" src={note} alt="" width={158} height={134} />
        </div>
        <Demo kind="verify" mascot={search}>
          <div className="q">
            <span>{t('Cal Hacks 可以一个人参加吗？')}</span>
            <i />
          </div>
          <ul className="steps">
            <li className="demo-reveal step-one">{t('查询比赛库里的队伍要求')}</li>
            <li className="demo-reveal step-two">{t('读取主办方 FAQ')}</li>
            <li className="demo-reveal step-three">{t('和报名平台原文对照')}</li>
          </ul>
          <div className="mini demo-reveal step-four">
            <div className="r">
              <s>{t('报名平台：2 至 4 人组队')}</s>
              <a href="https://cal-hacks-13-0.devpost.com/" target="_blank" rel="noreferrer">
                {t('平台原文')}
              </a>
            </div>
            <div className="r">
              <span>{t('主办方：可以单人参加')}</span>
              <a href="https://calhacks.io/" target="_blank" rel="noreferrer">
                {t('主办方')}
              </a>
            </div>
            <div className="r">
              <b>{t('主办方 FAQ 允许单人或组队')}</b>
            </div>
          </div>
        </Demo>
      </div>
      <div className="feat flip" id="personalized">
        <div>
          <h2>{t('按你做过的项目挑')}</h2>
          <p>{t('连上 GitHub 或传一份简历，推荐写明为什么适合你。')}</p>
          <div className="acts">
            <button type="button" className="btn primary" onClick={() => onAddProfile('github')}>
              <Icon name="github" />
              {t('读取我的 GitHub')}
            </button>
            <button type="button" className="btn quiet" onClick={() => onAddProfile('profile')}>
              {t('从简历开始')}
              <Icon name="arrow-right" />
            </button>
          </div>
        </div>
        <Demo kind="profile" mascot={read}>
          <div className="mini demo-reveal step-one">
            {['pitchcraft', 'Cove', 'tiny-lm'].map((name) => (
              <div className="repo" key={name}>
                <Icon name="github" />
                {name}
              </div>
            ))}
          </div>
          <div className="tags">
            {['TypeScript', 'Python', 'Swift', t('做过 Agent')].map((tag) => (
              <span className="demo-reveal step-two" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          <div className="pick demo-reveal step-three">
            <img src={paypalCover} alt="" width={64} height={48} />
            <div>
              <a href={paypalUrl} target="_blank" rel="noreferrer">
                <b>PayPal AI Hackathon</b>
              </a>
              <small>{t('pitchcraft 做过 Agent 流程，题目对口')}</small>
            </div>
          </div>
        </Demo>
      </div>
      <div className="feat" id="watch">
        <div>
          <h2>{t('关注一场，变了就告诉你')}</h2>
          <p>{t('截止延期、规则更新，发邮件告诉你。')}</p>
          <div className="acts">
            <Link className="btn primary" to="/account/push">
              {t('设置邮件盯梢')}
              <Icon name="arrow-right" />
            </Link>
            <Link className="btn quiet" to="/account/follows">
              {t('查看我的关注')}
            </Link>
          </div>
        </div>
        <Demo kind="watch" mascot={peer}>
          <div className="pick">
            <img src={paypalCover} alt="" width={64} height={48} />
            <div>
              <a href={paypalUrl} target="_blank" rel="noreferrer">
                <b>PayPal AI Hackathon</b>
              </a>
              <small>{t('作品提交截止 11 月 12 日')}</small>
              <br />
              <span className="eye">
                <Eye size={14} aria-hidden="true" />
                <span className="watch-before">{t('帮我盯着')}</span>
                <span className="watch-after">{t('已盯上')}</span>
              </span>
            </div>
          </div>
          <div className="mail demo-reveal step-three">
            <small>{t('Inkpaw · 邮件盯梢')}</small>
            <b>{t('有新的主办方公告，发邮件告诉你')}</b>
          </div>
        </Demo>
      </div>
      <div className="feat flip" id="mcp-feature">
        <div>
          <h2>{t('在你常用的 AI 里直接查')}</h2>
          <p>{t('Claude Code、Cursor 里加一行配置就能用。')}</p>
          <div className="mcp-url">
            <code>{endpoint}</code>
            <button type="button" className="btn line" onClick={() => void copyEndpoint()}>
              {copied ? t('已复制') : t('复制')}
            </button>
          </div>
          <div className="acts">
            <Link
              className="btn quiet"
              to={{ pathname: location.pathname, search: location.search, hash: '#mcp' }}
              state={location.state}
            >
              {t('查看接入说明')}
              <Icon name="arrow-right" />
            </Link>
          </div>
        </div>
        <Demo kind="mcp" mascot={happy}>
          <div className="chat-u demo-reveal step-one">{t('帮我找几场黑客松，附上主办方原文')}</div>
          <div className="tool demo-reveal step-two">
            <img className="pixel-art" src={mark} alt="" width={16} height={16} />
            <code>search_contests</code> {t('· 3 条')}
          </div>
          <div className="rows demo-reveal step-three">
            <div>
              <a href={paypalUrl} target="_blank" rel="noreferrer">
                PayPal AI Hackathon
              </a>
              <small>{t('11 月 12 日 · 官网')}</small>
            </div>
            <div>
              <a href="https://qloo.devpost.com/" target="_blank" rel="noreferrer">
                Qloo Agentic Hackathon
              </a>
              <small>{t('10 月 30 日 · 官网')}</small>
            </div>
            <div>
              <a href="https://calhacks.io/" target="_blank" rel="noreferrer">
                Cal Hacks 13.0
              </a>
              <small>{t('资格说明 · 官网')}</small>
            </div>
          </div>
        </Demo>
      </div>
    </section>
  )
}

export function HomeClosing({ onAsk }: { onAsk: () => void }) {
  const { t } = useLocale()
  return (
    <section className="closing" aria-label={t('问侦探')}>
      <img className="pixel-art" src={happy} alt="" width={120} height={120} />
      <div>
        <h2>{t('把你的条件告诉侦探')}</h2>
        <p>{t('线上还是线下、什么时候有空、会什么技能，说清楚它就去查。')}</p>
      </div>
      <div className="acts">
        <button type="button" className="btn primary" onClick={onAsk}>
          {t('问侦探')}
        </button>
        <Link className="btn line" to="/contests">
          {t('浏览赛事库')}
        </Link>
      </div>
    </section>
  )
}
