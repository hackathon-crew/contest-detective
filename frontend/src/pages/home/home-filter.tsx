import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TZDate } from '@date-fns/tz'
import { addDays, endOfDay, startOfDay } from 'date-fns'
import { Link } from 'react-router'
import ReactMarkdown from 'react-markdown'
import { ContestPreview, useContests, type ContestFilters } from '@/entities/contest'
import { matchProfile } from '@/features/profile-match'
import type { Profile } from '@/shared/api'
import { EmptyState, ErrorState, Skeleton } from '@/shared/ui'
import { Icon } from '@/shared/ui/site-icon'
import peer from '@/shared/assets/mascot/octo-peer.png'
import trophy from '@/shared/assets/stickers/trophy.png'

function Segments<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: ReadonlyArray<readonly [T, string]>
  onChange: (value: T) => void
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([key, title]) => (
        <button type="button" key={key} aria-pressed={value === key} onClick={() => onChange(key)}>
          {title}
        </button>
      ))}
    </div>
  )
}
export function HomeFilter({
  profile,
  total,
  onAddProfile,
}: {
  profile: Profile | null
  total?: number
  onAddProfile: () => void
}) {
  const [tab, setTab] = useState<'filter' | 'match'>('filter')
  const [mode, setMode] = useState('all')
  const [range, setRange] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [today] = useState(() => startOfDay(TZDate.tz('Asia/Shanghai')))
  const filters: ContestFilters = {
    mode: mode === 'all' ? undefined : (mode as ContestFilters['mode']),
    date_from: today.toISOString(),
    date_to: range === 'all' ? undefined : endOfDay(addDays(today, Number(range))).toISOString(),
    keyword: keyword.trim() || undefined,
    sort: 'deadline',
    page_size: 6,
  }
  const contests = useContests(filters)
  const matches = useQuery({
    queryKey: ['home-matches', profile],
    queryFn: ({ signal }) => matchProfile(profile!, signal),
    enabled: tab === 'match' && profile !== null,
  })
  const tags = [
    profile?.identity,
    ...(profile?.skills ?? []),
    ...(profile?.preferred_modes ?? []).map(
      (mode) => ({ online: '只看线上', offline: '线下', hybrid: '线上+线下' })[mode],
    ),
  ].filter(Boolean)
  return (
    <div className="stage">
      <img
        className="stk px x2"
        src={trophy}
        width={152}
        height={158}
        alt=""
        style={{ left: '-44px', bottom: '-104px' }}
      />
      <div className="win" id="finder" aria-label="筛选比赛">
        <img
          className="perch px x2"
          src={peer}
          width={202}
          height={164}
          alt=""
          style={{ right: '28px', bottom: 'calc(100% - 14px)' }}
        />
        <div className="win-bar">
          <Segments
            label="筛选方式"
            value={tab}
            onChange={setTab}
            options={[
              ['filter', '按条件'],
              ['match', '按我的情况'],
            ]}
          />
        </div>
        {tab === 'filter' ? (
          <>
            <div className="fbar">
              <Segments
                label="参赛形式"
                value={mode}
                onChange={setMode}
                options={[
                  ['all', '全部'],
                  ['online', '线上'],
                  ['offline', '线下'],
                  ['hybrid', '线上+线下'],
                ]}
              />
              <Segments
                label="截止时间"
                value={range}
                onChange={setRange}
                options={[
                  ['all', '不限'],
                  ['7', '一周内'],
                  ['30', '一个月内'],
                ]}
              />
              <label className="fsearch">
                <Icon name="search" />
                <input
                  type="search"
                  placeholder="关键词，比如 AI、硬件"
                  aria-label="关键词"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
              </label>
            </div>
            <div className="rows">
              {contests.isPending ? (
                <Skeleton />
              ) : contests.isError ? (
                <ErrorState error={contests.error} retry={() => void contests.refetch()} />
              ) : contests.data.items.length ? (
                contests.data.items.map((contest) => (
                  <ContestPreview key={contest.id} contest={contest} />
                ))
              ) : (
                <p className="empty">没有符合条件的比赛，放宽截止时间试试</p>
              )}
            </div>
            <div className="win-foot">
              <span>{contests.data ? `找到 ${contests.data.total} 场` : '正在读取比赛'}</span>
              <Link to="/contests">
                在赛事库里看全部 {total ?? '—'} 场 <Icon name="arrow-right" />
              </Link>
            </div>
          </>
        ) : (
          <>
            {profile ? (
              <>
                <div className="profile">
                  <Icon name="user" />
                  你确认的参赛条件：
                  {tags.map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                  <button type="button" onClick={onAddProfile}>
                    编辑画像
                  </button>
                </div>
                <div className="rows">
                  {matches.isPending ? (
                    <Skeleton />
                  ) : matches.isError ? (
                    <ErrorState error={matches.error} retry={() => void matches.refetch()} />
                  ) : matches.data.length ? (
                    matches.data.map((item) => (
                      <ContestPreview
                        key={item.contest.id}
                        contest={item.contest}
                        extra={
                          <span className="reasons">
                            <Icon name="check" />
                            <ReactMarkdown
                              components={{
                                p: ({ children }) => <span>{children}</span>,
                                a: ({ children }) => <span>{children}</span>,
                              }}
                            >
                              {item.reason}
                            </ReactMarkdown>
                          </span>
                        }
                      />
                    ))
                  ) : (
                    <EmptyState>没有找到符合条件的比赛，调整画像后再试。</EmptyState>
                  )}
                </div>
              </>
            ) : (
              <div className="profile-empty">
                <p>连接 GitHub 或上传简历，确认画像后挑比赛。</p>
                <button type="button" className="btn btn-outline" onClick={onAddProfile}>
                  添加参赛资料
                </button>
              </div>
            )}
            <div className="win-foot">
              <span>按技能、形式和截止时间排序</span>
              <Link to="/detective">
                让侦探再查一遍 <Icon name="arrow-right" />
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
