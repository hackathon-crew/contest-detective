import { useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ChevronDown, Check } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Badge } from '@/shared/ui'
import type { FieldValue } from './api'
import { formatDate, modeNames, safeUrl, statusNames } from './format'
import { groundedIntroduction } from './content'
import { ContestCover, VerificationLevel } from './preview'
import {
  contestCity,
  contestAbout,
  contestThemes,
  dateText,
  fieldDay,
  libraryDate,
  monthDay,
  normalizedPrize,
  seriesCity,
  type LibraryContest,
  type LibraryDate,
  type LibraryRow,
} from './library'

export function LevelBadge({ level }: { level: FieldValue['level'] }) {
  const names = { official: '官方', reposted: '仅转载', conflict: '冲突', not_found: '未找到' }
  const colors = {
    official: 'text-level-official',
    reposted: 'text-level-reposted',
    conflict: 'text-level-conflict',
    not_found: 'text-level-not-found',
  }
  return (
    <Badge variant="outline" className={colors[level]}>
      {names[level]}
    </Badge>
  )
}
export function LibraryDateColumn({ date }: { date: LibraryDate | null }) {
  if (!date)
    return (
      <div className="item-date">
        <b className="none">日期未核实</b>
      </div>
    )
  const labels: Record<string, string> = {
    registration_deadline: '报名截止',
    submission_deadline: '作品提交截止',
    deadline_unspecified: '截止（类型待确认）',
    start_at: '开赛',
  }
  const text = date.start
    ? date.left < 0
      ? ''
      : date.left === 0
        ? '今天开赛'
        : date.left + ' 天后开赛'
    : date.left < 0
      ? '已截止'
      : date.left === 0
        ? '今天截止'
        : '还有 ' + date.left + ' 天'
  const source = safeUrl(date.info.sources?.[0]?.url)
  const level = <VerificationLevel level={date.info.level} />
  if (date.info.level === 'conflict')
    return (
      <div className="item-date">
        <b className="none">日期有冲突</b>
        <span className="k">{labels[date.field]}</span>
        <span className="s">{level}</span>
      </div>
    )
  return (
    <div className="item-date">
      <b title={formatDate(date.info.value, date.info.precision)}>{dateText(date.info)}</b>
      <span className="k">{labels[date.field]}</span>
      <span className="s">
        {source ? (
          <a
            href={source}
            target="_blank"
            rel="noreferrer"
            aria-label={'查看' + labels[date.field] + '来源'}
          >
            {level}
          </a>
        ) : (
          level
        )}
        {text && (
          <span
            className={'soon-tag' + (!date.start && date.left >= 0 && date.left <= 2 ? ' hot' : '')}
          >
            {text}
          </span>
        )}
      </span>
    </div>
  )
}
export function ContestCard({
  contest,
  action,
  reason,
  index = 0,
}: {
  contest: LibraryContest
  action?: ReactNode
  reason?: string
  index?: number
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const date = libraryDate(contest)
  const displayDate =
    date && contest.coverage?.fields?.[date.field]?.state === 'conflict'
      ? { ...date, info: { ...date.info, level: 'conflict' as const } }
      : date
  const conditionsConflict = ['eligibility', 'team_size', 'entry_fee'].some(
    (field) =>
      contest.fields[field]?.level === 'conflict' ||
      contest.coverage?.fields?.[field]?.state === 'conflict',
  )
  const themes = contestThemes(contest)
  const themeSource = contest.theme_sources?.find((source) => safeUrl(source.url))
  const introduction = groundedIntroduction(contest)
  const prizeConflict =
    contest.fields.prize?.level === 'conflict' ||
    contest.coverage?.fields?.prize?.state === 'conflict'
  const prize = prizeConflict ? null : normalizedPrize(contest.fields.prize?.value)
  const mode = contest.fields.mode?.value
  const meta = [
    contest.fields.organizer?.value,
    mode === 'hybrid' ? '线上+线下' : modeNames[mode ?? ''],
    contestCity(contest),
  ]
    .filter(Boolean)
    .join(' · ')
  const to = '/contests/' + encodeURIComponent(contest.id) + location.search
  return (
    <article
      className={'item' + (contest.status === 'ended' ? ' ended' : '')}
      style={{ '--i': Math.min(index, 12) } as CSSProperties}
      onClick={(event) => {
        if (!(event.target as Element).closest('a,button'))
          void navigate(to, { state: { backgroundLocation: location } })
      }}
    >
      <ContestCover contest={contest} className="item-cover" />
      <div className="item-main">
        <Link className="item-name" to={to} state={{ backgroundLocation: location }}>
          {contest.name}
        </Link>
        <p className="item-meta">{meta}</p>
        {!reason && introduction && (
          <p className="item-description">
            <Link
              className="about"
              to={to}
              state={{ backgroundLocation: location }}
              title={introduction.text}
            >
              {contestAbout(contest)}
            </Link>
            <a
              className="item-source-link"
              href={safeUrl(introduction.citations[0]?.url)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="查看介绍来源"
            >
              来源
            </a>
          </p>
        )}
        {reason ? (
          <div className="item-extra">
            <div className="reasons">
              <Check className="ic" />
              <ReactMarkdown
                urlTransform={(url) => safeUrl(url) ?? ''}
                components={{
                  p: ({ children }) => <span>{children}</span>,
                  a: ({ children, ...props }) => (
                    <a {...props} target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {reason}
              </ReactMarkdown>
            </div>
          </div>
        ) : (
          <div className="item-extra">
            {contest.status !== 'upcoming' && (
              <span className={'tag' + (contest.status === 'ongoing' ? ' live' : '')}>
                {statusNames[contest.status]}
              </span>
            )}
            {prize && (
              <span className="prize-t">
                奖励 <b>{prize}</b>
              </span>
            )}
            {prizeConflict && <span className="prize-t conflict">奖励有冲突</span>}
            {conditionsConflict && <span className="tag conflict">参赛条件有冲突</span>}
            {themes.slice(0, 3).map((theme) =>
              themeSource ? (
                <a
                  className="tag"
                  key={theme}
                  href={safeUrl(themeSource.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={'主题来源：' + (themeSource.title || themeSource.site)}
                >
                  {theme}
                </a>
              ) : (
                <span className="tag" key={theme}>
                  {theme}
                </span>
              ),
            )}
          </div>
        )}
      </div>
      <LibraryDateColumn date={displayDate} />
      {action}
    </article>
  )
}

export function ContestSeriesRow({ row, index = 0 }: { row: LibraryRow; index?: number }) {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const kids = row.contests,
    first = kids[0]!
  const starts = kids
    .map((c) => fieldDay(c.fields.start_at))
    .filter((s): s is string => !!s)
    .sort()
  const ends = kids
    .map((c) => fieldDay(c.fields.end_at))
    .filter((s): s is string => !!s)
    .sort()
  const a = starts[0],
    b = ends.at(-1)
  const range = a
    ? monthDay(a) +
      (b && b !== a
        ? '–' + (b.slice(5, 7) === a.slice(5, 7) ? Number(b.slice(8, 10)) + '日' : monthDay(b))
        : '')
    : '日期未核实'
  const offline = new Set(
    kids.filter((c) => c.fields.mode?.value !== 'online').map((c) => seriesCity(c).city),
  ).size
  const sorted = [...kids].sort((x, y) =>
    seriesCity(x).city.localeCompare(seriesCity(y).city, 'zh'),
  )
  return (
    <article
      className={'item' + (open ? ' open' : '')}
      style={{ '--i': Math.min(index, 12) } as CSSProperties}
      onClick={(event) => {
        if (!(event.target as Element).closest('a,button')) setOpen(!open)
      }}
    >
      <ContestCover contest={first} className="item-cover" />
      <div className="item-main">
        <button
          className="item-name"
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          AI 切磋大会 · 1024 超能 Coding 周末
        </button>
        <p className="item-meta">
          WaytoAGI · {offline} 座城市线下
          {kids.some((c) => c.fields.mode?.value === 'online') ? ' + 线上会场' : ''}
        </p>
        <div className="item-extra">
          {kids.some((c) => c.status === 'ongoing') && <span className="tag live">进行中</span>}
          <span className="about">
            {kids
              .slice(0, 8)
              .map((c) => seriesCity(c).city)
              .join('、')}{' '}
            等 {kids.length} 场
          </span>
        </div>
      </div>
      <div className="item-date">
        <b>{range}</b>
        <span className="k">各城市同场</span>
        <span className="s">
          <VerificationLevel level={first.fields.start_at?.level ?? 'not_found'} />
        </span>
      </div>
      <button
        className="follow expand"
        type="button"
        aria-expanded={open}
        aria-label={'展开 ' + kids.length + ' 个城市'}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown className="ic" />
      </button>
      <div className="series-body" aria-hidden={!open} inert={!open}>
        <div>
          <div className="city-grid">
            {sorted.map((contest) => {
              const city = seriesCity(contest)
              return (
                <Link
                  key={contest.id}
                  className="city-link"
                  to={'/contests/' + encodeURIComponent(contest.id) + location.search}
                  state={{ backgroundLocation: location }}
                >
                  <b>{city.city}</b>
                  <span>
                    {city.venue || (contest.fields.mode?.value === 'online' ? '线上' : '线下')}
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </article>
  )
}
