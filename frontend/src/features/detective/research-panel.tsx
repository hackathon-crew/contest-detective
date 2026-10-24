import { useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { CheckCircle2, ChevronRight, CircleAlert, LoaderCircle, X } from 'lucide-react'
import { safeUrl } from '@/entities/contest'
import type { DetectiveTurn } from './conversation'
import type { TraceSource } from './events'
import { SourceIcon } from './source-icon'
import './research-panel.css'

interface Activity {
  id: string
  tool: string
  label: string
  summary?: string
  status: 'running' | 'completed' | 'interrupted'
}

function researchFor(turns: readonly DetectiveTurn[]) {
  const sources = new Map<string, TraceSource>()
  const activities = turns.flatMap((turn) => {
    const steps: Activity[] = []
    for (const [index, event] of turn.trace.entries()) {
      if (event.type === 'step') {
        steps.push({
          id: `${turn.id}:${index}`,
          tool: event.tool,
          label: event.label,
          status: turn.status === 'running' ? 'running' : 'interrupted',
        })
      } else {
        const step = steps.findLast(
          (item) => item.tool === event.tool && item.summary === undefined,
        )
        if (step) {
          step.summary = event.summary
          step.status = 'completed'
        } else {
          steps.push({
            id: `${turn.id}:${index}`,
            tool: event.tool,
            label: event.tool,
            summary: event.summary,
            status: 'completed',
          })
        }
        for (const source of event.sources) {
          if (!safeUrl(source.url)) continue
          // 搜索和正文读取没有核实身份，和后端 remember 一样保留已知来源的等级。
          if (
            (event.tool === 'web_search' || event.tool === 'fetch_page') &&
            sources.has(source.url)
          )
            continue
          sources.set(source.url, source)
        }
      }
    }
    // 最终回答携带这一轮确定的来源等级，覆盖检索过程中同一 URL 的旧状态。
    for (const source of turn.sources) if (safeUrl(source.url)) sources.set(source.url, source)
    return steps
  })
  const all = [...sources.values()]
  return {
    official: all.filter((source) => source.is_official === true && !source.stale),
    clues: all.filter((source) => source.is_official !== true || source.stale),
    activities,
  }
}

// 沿用 Everplain 的独立分区状态；流式更新不会把用户折起的分区重新展开。
function RailSection({
  title,
  count,
  index,
  empty,
  children,
}: {
  title: string
  count: number
  index: number
  empty: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  const bodyId = useId()
  return (
    <>
      <button
        type="button"
        className="detective-research__section-head"
        aria-controls={bodyId}
        aria-expanded={open}
        style={
          { '--rail-sticky-top': `${index * 44}px`, '--rail-layer': 9 - index } as CSSProperties
        }
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight aria-hidden="true" strokeWidth={1.5} />
        <span>{title}</span>
        <b>{count}</b>
      </button>
      <div
        id={bodyId}
        className="detective-research__section-body"
        role="group"
        aria-label={title}
        hidden={!open}
      >
        {count ? children : <p className="detective-research__empty">{empty}</p>}
      </div>
    </>
  )
}

function Sources({ sources }: { sources: TraceSource[] }) {
  return sources.map((source) => (
    <a
      className="detective-research__source"
      key={source.url}
      href={source.url}
      target="_blank"
      rel="noreferrer"
    >
      <SourceIcon url={source.url} />
      <span>
        <strong>{source.title || source.site || new URL(source.url).hostname}</strong>
        <small>{new URL(source.url).hostname.replace(/^www\./u, '')}</small>
        {source.stale ? <em>来源已过期</em> : !source.is_official ? <em>待核实</em> : null}
      </span>
    </a>
  ))
}

export function ResearchPanel({ turns, onClose }: { turns: DetectiveTurn[]; onClose: () => void }) {
  const { official, clues, activities } = useMemo(() => researchFor(turns), [turns])
  return (
    <>
      <header className="detective-research__header">
        <h2>研究面板</h2>
        <button
          type="button"
          className="detective-icon"
          aria-label="关闭研究面板"
          onClick={onClose}
        >
          <X aria-hidden="true" strokeWidth={1.5} />
        </button>
      </header>
      <div className="detective-research__body">
        <RailSection
          title="赛事官网"
          count={official.length}
          index={0}
          empty="查证到的官方出处会列在这里。"
        >
          <Sources sources={official} />
        </RailSection>
        <RailSection
          title="网页线索"
          count={clues.length}
          index={1}
          empty="搜索到的网页线索会列在这里。"
        >
          <Sources sources={clues} />
        </RailSection>
        <RailSection
          title="工作流程"
          count={activities.length}
          index={2}
          empty="侦探开始查证后，这里会显示工具步骤。"
        >
          {activities.map((activity) => (
            <article className="detective-research__activity" key={activity.id}>
              {activity.status === 'running' ? (
                <LoaderCircle className="detective-spin" aria-label="进行中" />
              ) : activity.status === 'completed' ? (
                <CheckCircle2 aria-label="已完成" />
              ) : (
                <CircleAlert aria-label="已中断" />
              )}
              <div>
                <strong>{activity.label}</strong>
                <small>{activity.tool}</small>
                {activity.summary && <p>{activity.summary}</p>}
              </div>
              <span>
                {activity.status === 'running'
                  ? '进行中'
                  : activity.status === 'completed'
                    ? '已完成'
                    : '已中断'}
              </span>
            </article>
          ))}
        </RailSection>
      </div>
    </>
  )
}
