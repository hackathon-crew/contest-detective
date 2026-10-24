import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { addDays } from 'date-fns'
import { TZDate } from '@date-fns/tz'
import { deadlineDays, formatDate, nextDeadline, type ContestSummary } from '@/entities/contest'
import { Icon } from '@/shared/ui/site-icon'
import plug from '@/shared/assets/stickers/plug.png'
const endpoint = 'http://43.142.60.212/mcp'
const config = {
  cc: 'claude mcp add --transport http inkpaw ' + endpoint,
  cursor:
    '// ~/.cursor/mcp.json\n{\n  "mcpServers": {\n    "inkpaw": { "url": "' +
    endpoint +
    '" }\n  }\n}',
  other:
    '// 支持 Streamable HTTP 的客户端都能用\n{\n  "mcpServers": {\n    "inkpaw": {\n      "type": "http",\n      "url": "' +
    endpoint +
    '"\n    }\n  }\n}',
}
export function McpPanel({ contests }: { contests?: ContestSummary[] }) {
  const [tab, setTab] = useState<keyof typeof config>('cc')
  const [copied, setCopied] = useState(false)
  const pre = useRef<HTMLPreElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  async function copy() {
    try {
      await navigator.clipboard.writeText(config[tab].replace(/^\/\/.*\n/, ''))
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1400)
    } catch {
      if (pre.current) {
        const range = document.createRange()
        range.selectNodeContents(pre.current)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
    }
  }
  const week = (contests ?? []).filter((contest) => {
    const deadline = nextDeadline(contest)
    return contest.fields.mode?.value === 'online' && deadline && deadlineDays(deadline) <= 7
  })
  const first = week[0] && nextDeadline(week[0])
  return (
    <div className="stage">
      <img
        className="stk px x2"
        src={plug}
        width={158}
        height={118}
        alt=""
        style={{ left: '-40px', top: '-48px' }}
      />
      <div className="win">
        <div className="win-bar">
          <div className="seg" role="group" aria-label="客户端">
            {(
              [
                ['cc', 'Claude Code'],
                ['cursor', 'Cursor'],
                ['other', '其他客户端'],
              ] as const
            ).map(([key, label]) => (
              <button
                type="button"
                key={key}
                aria-pressed={tab === key}
                onClick={() => {
                  setTab(key)
                  setCopied(false)
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="copy-btn"
            onClick={() => void copy()}
            aria-label={copied ? '已复制配置' : '复制配置'}
          >
            <Icon name={copied ? 'check' : 'copy'} />
          </button>
        </div>
        <div className="code">
          <pre ref={pre}>
            {config[tab].split(/("[a-zA-Z]+"(?=\s*:)|^claude)/).map((part, index) =>
              /^("[a-zA-Z]+"|claude)$/.test(part) ? (
                <span className="k" key={index}>
                  {part}
                </span>
              ) : (
                part
              ),
            )}
          </pre>
        </div>
        <div className="mcp-demo">
          <div className="q">用 inkpaw 查一下下周截止、线上能参加的比赛</div>
          <div className="call">
            <Icon name="database" />
            <code>
              search_contests{' '}
              {JSON.stringify({
                mode: 'online',
                date_to: format(addDays(TZDate.tz('Asia/Shanghai'), 7), 'yyyy-MM-dd'),
              })}
            </code>
          </div>
          <div className="call">
            <Icon name="check" />
            <span>
              {contests ? `返回 ${week.length} 场` : '接入后，AI 会返回赛事、截止时间和出处'}
              {week[0] && first
                ? `，最近的是 ${week[0].name}（${formatDate(first.info.value, first.info.precision)}）`
                : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
