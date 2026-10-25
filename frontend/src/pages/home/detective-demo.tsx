import type { VerificationOptions } from '@/features/detective/verification-contracts'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ContestPreview,
  formatDate,
  nextDeadline,
  safeUrl,
  type ContestSummary,
} from '@/entities/contest'
import { DetectiveComposer } from '@/features/detective'
import { Icon } from '@/shared/ui/site-icon'
import read from '@/shared/assets/mascot/octo-read.png'
import mark from '@/shared/assets/inkpaw-mark-32.webp'
import stamp from '@/shared/assets/stickers/stamp.png'
const question = '我会 Python，想找 11 月截止、线上能参加的 AI 黑客松，奖金高一点的'
export function DetectiveDemo({
  contests,
  onAsk,
  onAddProfile,
}: {
  contests: ContestSummary[]
  onAsk: (question: string, verification?: VerificationOptions) => void
  onAddProfile: (section: 'github' | 'profile' | 'filters') => void
}) {
  const picks = [
    'PayPal AI Hackathon',
    'UGREEN Hackathon 2026 on AI NAS',
    'Codex x TwitchCon Hackathon',
  ].flatMap((name) => {
    const contest = contests.find((c) => c.name.startsWith(name))
    return contest ? [contest] : []
  })
  const first = picks[0] && nextDeadline(picks[0])
  const registrationUrl = safeUrl(picks[0]?.fields.registration_url?.value)
  const steps = [
    ['database', '查比赛库', 'search_contests', '线上、11 月截止，找到 4 场'],
    ['file', '读取出处', 'get_contest × 4', '4 场的截止时间都来自 Devpost 主办方页面'],
    ['globe', '联网核对', 'web_search', '没有搜到延期或改期的公告'],
    [
      'link',
      '读原文',
      'fetch_page ' + (registrationUrl ? new URL(registrationUrl).host : ''),
      first
        ? '提交截止 ' + formatDate(first.info.value, first.info.precision) + '，和库里一致'
        : '读取比赛的日期和出处',
    ],
  ]
  const [completed, setCompleted] = useState(5)
  const [input, setInput] = useState('')
  const stepHost = useRef<HTMLOListElement>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const replay = useCallback(() => {
    timers.current.forEach(clearTimeout)
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    setCompleted(0)
    timers.current = Array.from({ length: 5 }, (_, index) =>
      setTimeout(() => setCompleted(index + 1), 500 + index * 700),
    )
  }, [])
  useEffect(() => {
    if (!stepHost.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          replay()
          observer.disconnect()
        }
      },
      { threshold: 0.4 },
    )
    observer.observe(stepHost.current)
    return () => {
      observer.disconnect()
      timers.current.forEach(clearTimeout)
    }
  }, [replay])
  return (
    <div className="stage">
      <img
        className="stk px x2"
        src={stamp}
        width={152}
        height={146}
        alt=""
        style={{ right: '-32px', bottom: '-44px' }}
      />
      <div className="win">
        <img
          className="perch px x2"
          src={read}
          width={202}
          height={172}
          alt=""
          style={{ left: '28px', bottom: 'calc(100% - 14px)' }}
        />
        <div className="win-bar">
          <div className="win-title">
            <img className="px" src={mark} width={30} height={26} alt="" />
            侦探<small>新对话</small>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-hide-sm"
            style={{ height: '32px', fontSize: '13px' }}
            onClick={replay}
          >
            再查一遍
          </button>
        </div>
        <div className="chat-body">
          <div className="me">{question}</div>
          <ol className="steps" ref={stepHost}>
            {steps.map(([icon, title, tool, output], index) => (
              <li key={tool} className={'step' + (completed <= index ? ' pending' : '')}>
                <span className="dot">
                  <Icon name={icon} />
                  <span className="spin" />
                </span>
                <span className="step-head">
                  {title} <code>{tool}</code>
                </span>
                <span className="step-out">{output}</span>
              </li>
            ))}
          </ol>
          <div className={'answer' + (completed < 5 ? ' wait' : '')}>
            <p>按奖金排，这三场最合适，截止时间都对过官方原文：</p>
            <div className="picks">
              {picks.map((contest) => (
                <ContestPreview key={contest.id} contest={contest} />
              ))}
            </div>
            <p>Meta VR Start 奖金最高，但方向是 VR，和 AI 关系不大，先没放进来。要看的话跟我说。</p>
          </div>
        </div>
        <DetectiveComposer
          value={input}
          pending={false}
          onChange={setInput}
          onSubmit={(event, verification) => {
            event.preventDefault()
            if (input.trim()) onAsk(input.trim(), verification)
          }}
          onStop={() => {}}
          onAddProfile={onAddProfile}
          onVerifyScreenshot={({ question, ...verification }) => onAsk(question, verification)}
        />
      </div>
    </div>
  )
}
