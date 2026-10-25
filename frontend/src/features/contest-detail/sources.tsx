import { useEffect, useRef, useState, type MouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import { safeUrl, VerificationLevel, type ContestDetail } from '@/entities/contest'
import type {
  EvidenceGroup,
  EvidenceIndex,
  EvidenceInstance,
  EvidenceObservation,
  EvidenceReference,
} from './evidence-index'

const activateSourceEvent = 'contest-source-activate'

interface ReadingPosition {
  trigger: HTMLButtonElement
  contestId: string
  groupId: string
  scroll: { element: HTMLElement; top: number; left: number }[]
}

function restoreReadingPosition(
  position: ReadingPosition | null,
  dialog: Element | null | undefined,
) {
  if (!position?.trigger.isConnected || position.trigger.closest('[role="dialog"]') !== dialog)
    return false
  position.trigger.focus({ preventScroll: true })
  for (const { element, top, left } of position.scroll) {
    if (element.isConnected) {
      element.scrollTop = top
      element.scrollLeft = left
    }
  }
  return true
}

function openSource(
  event: MouseEvent<HTMLButtonElement>,
  index: EvidenceIndex,
  ref: EvidenceReference,
) {
  const trigger = event.currentTarget
  const dialog = trigger.closest<HTMLElement>('[role="dialog"]')
  if (!dialog) return
  const sources = Array.from(
    dialog.querySelectorAll<HTMLDetailsElement>('[data-contest-sources]'),
  ).find((element) => element.dataset.contestSources === index.contestId)
  const group = Array.from(
    sources?.querySelectorAll<HTMLElement>('[data-source-group]') ?? [],
  ).find((element) => element.dataset.sourceGroup === ref.groupId)
  if (!sources || !group) return
  const position: ReadingPosition = {
    trigger,
    contestId: index.contestId,
    groupId: ref.groupId,
    scroll: [],
  }
  for (
    let element: HTMLElement | null = trigger.parentElement;
    element;
    element = element.parentElement
  ) {
    position.scroll.push({ element, top: element.scrollTop, left: element.scrollLeft })
    if (element === dialog) break
  }
  sources.open = true
  sources.dispatchEvent(new CustomEvent<ReadingPosition>(activateSourceEvent, { detail: position }))
  const quote = Array.from(
    group.querySelectorAll<HTMLElement>('[data-source-excerpt-evidence]'),
  ).find((element) =>
    element.dataset.sourceExcerptEvidence?.split(' ').some((id) => ref.evidenceIds.includes(id)),
  )
  const target =
    quote ??
    Array.from(group.querySelectorAll<HTMLElement>('[data-source-evidence]')).find((element) =>
      ref.evidenceIds.includes(element.dataset.sourceEvidence ?? ''),
    ) ??
    group
  for (
    let ancestor = target.parentElement;
    ancestor && sources.contains(ancestor);
    ancestor = ancestor.parentElement
  ) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
  }
  target.focus({ preventScroll: true })
  target.scrollIntoView?.({ block: 'nearest' })
}

export function SourceReferences({
  index,
  refs,
  label = '信息',
}: {
  index: EvidenceIndex
  refs: EvidenceReference[] | undefined
  label?: string
}) {
  const unique = new Map<string, EvidenceReference>()
  for (const ref of refs ?? []) {
    const group = index.groups.find((item) => item.id === ref.groupId)
    if (!group) continue
    const evidenceIds = ref.evidenceIds.filter((id) =>
      group.instances.some((instance) => instance.id === id),
    )
    if (!evidenceIds.length) continue
    const existing = unique.get(ref.groupId)
    unique.set(ref.groupId, {
      groupId: ref.groupId,
      evidenceIds: [...new Set([...(existing?.evidenceIds ?? []), ...evidenceIds])],
    })
  }
  if (!unique.size) return null
  return (
    <span className="contest-detail-source-references">
      {[...unique.values()].map((ref) => {
        const group = index.groups.find((item) => item.id === ref.groupId)!
        return (
          <button
            key={ref.groupId}
            type="button"
            className="contest-detail-source-ref"
            aria-label={`查看${label}的信息来源 ${group.number}`}
            onClick={(event) => openSource(event, index, ref)}
          >
            [{group.number}]
          </button>
        )
      })}
    </span>
  )
}

function InstanceMetadata({
  instance,
  number,
  valueIsExcerpt,
}: {
  instance: EvidenceInstance
  number: number
  valueIsExcerpt: boolean
}) {
  const source = instance.source
  const document = instance.document
  const official = source?.is_official ?? document?.is_official
  const labels = instance.uses.map((use) => use.label)
  const conflicts = instance.uses.filter((use) => use.level === 'conflict').map((use) => use.label)
  return (
    <li className="contest-detail-source-meta" tabIndex={-1} data-source-evidence={instance.id}>
      <p>
        <span>
          记录 {number} ·{' '}
          {instance.kind === 'citation'
            ? '版本引用'
            : instance.kind === 'document'
              ? '公开资料'
              : instance.kind === 'source'
                ? '字段引用'
                : '来源链接'}
        </span>
        {typeof official === 'boolean' && (
          <VerificationLevel level={official ? 'official' : 'reposted'} />
        )}
        {source?.stale && <span>可能过期</span>}
      </p>
      <p className="contest-detail-source-uses">
        对应：{labels.join('、')}
        {conflicts.length ? `；${conflicts.join('、')}的来源说法不一` : ''}
      </p>
      {source?.value && !valueIsExcerpt && <p>记录值：{source.value}</p>}
      {(source?.title || document?.title) && <p>来源标题：{source?.title || document?.title}</p>}
      <p>
        {instance.contentHash ? (
          <span title={instance.contentHash} aria-label={`内容版本 ${instance.contentHash}`}>
            内容版本 {instance.contentHash.slice(0, 12)}
          </span>
        ) : (
          '未标注内容版本'
        )}
        {document &&
          ` · ${document.kind === 'search_snippet' ? '搜索摘要' : document.kind === 'structured' ? '结构化来源' : '页面来源'} · ${document.completeness === 'partial' ? '部分内容' : '完整采集，仅展示摘录'}`}
      </p>
      {document && (
        <p>
          表示形式：{document.representation ?? '未标注'} · 提取版本：{document.extractor_version} ·
          获取方式：{document.fetch_method}
          {document.retrieved_at && ` · 读取时间：${document.retrieved_at}`}
        </p>
      )}
      {!instance.excerptIds.length && <p>此记录没有可展示的摘录，请查看来源链接。</p>}
    </li>
  )
}

function SourceObservations({ observations }: { observations: EvidenceObservation[] }) {
  if (!observations.length) return null
  return (
    <div className="contest-detail-source-observations">
      <p>采集状态，不等同于主办方是否公布</p>
      {observations.map((observation) => (
        <p className="contest-detail-coverage" key={observation.id}>
          {observation.uses.map((use) => use.label).join('、')}：{observation.label}
          {observation.checkedAt && <span> · 检查时间：{observation.checkedAt}</span>}
        </p>
      ))}
    </div>
  )
}

function SourceGroup({
  group,
  canReturn,
  onReturn,
}: {
  group: EvidenceGroup
  canReturn: boolean
  onReturn: () => void
}) {
  const conflictFields = [
    ...new Set([
      ...group.instances.flatMap((instance) =>
        instance.uses.filter((use) => use.level === 'conflict').map((use) => use.label),
      ),
      ...group.observations
        .filter((observation) => observation.state === 'conflict')
        .flatMap((observation) =>
          observation.uses.map((use) => use.label.replace(/采集记录$/, '')),
        ),
    ]),
  ]
  const sourceTypes = [
    ...new Set(
      group.instances
        .map((instance) => instance.source?.is_official ?? instance.document?.is_official)
        .filter((value) => typeof value === 'boolean'),
    ),
  ]
  return (
    <li
      className="contest-detail-source-group"
      data-source-group={group.id}
      tabIndex={-1}
      aria-label={`信息来源 ${group.number}：${group.title}`}
    >
      <div className="contest-detail-source-heading">
        <a href={safeUrl(group.url)} target="_blank" rel="noopener noreferrer">
          [{group.number}] {group.title}
        </a>
        {canReturn && (
          <button type="button" className="contest-detail-source-return" onClick={onReturn}>
            返回阅读处
          </button>
        )}
      </div>
      <p className="contest-detail-source-meta">{group.url}</p>
      {!!sourceTypes.length && (
        <p className="contest-detail-source-uses">
          {sourceTypes.length > 1
            ? '来源类型标注不一，见核验记录。'
            : `记录标注：${sourceTypes[0] ? '官方原文' : '转载'}`}
        </p>
      )}
      {!!conflictFields.length && (
        <p className="contest-detail-coverage">
          {conflictFields.join('、')}：来源说法不一，保留各方摘录，未做取舍。
        </p>
      )}
      {group.instances.some((instance) => instance.source?.stale) && (
        <p className="contest-detail-coverage">含可能过期的引用，版本与状态见核验记录。</p>
      )}
      {group.excerpts.map((excerpt) => (
        <div
          className="contest-detail-source-excerpt"
          key={excerpt.id}
          tabIndex={-1}
          data-source-excerpt-evidence={excerpt.evidenceIds.join(' ')}
        >
          <p>{excerpt.text}</p>
          <p className="contest-detail-source-meta">
            对应记录{' '}
            {excerpt.evidenceIds
              .map((id) => group.instances.findIndex((instance) => instance.id === id) + 1)
              .join('、')}
          </p>
        </div>
      ))}
      {!group.excerpts.length && (
        <p className="contest-detail-empty">没有可展示的摘录，来源链接仍可查看。</p>
      )}
      <details className="contest-detail-source-versions">
        <summary>核验记录与版本（{group.instances.length + group.observations.length}）</summary>
        <ul>
          {group.instances.map((instance, index) => (
            <InstanceMetadata
              key={instance.id}
              instance={instance}
              number={index + 1}
              valueIsExcerpt={group.excerpts.some(
                (excerpt) =>
                  excerpt.evidenceIds.includes(instance.id) &&
                  excerpt.text === instance.source?.value,
              )}
            />
          ))}
        </ul>
        <SourceObservations observations={group.observations} />
      </details>
    </li>
  )
}

export function ContestSources({
  contest,
  index,
}: {
  contest: ContestDetail
  index: EvidenceIndex
}) {
  const details = useRef<HTMLDetailsElement>(null)
  const readingPosition = useRef<ReadingPosition | null>(null)
  const [returnGroup, setReturnGroup] = useState<{ contestId: string; groupId: string } | null>(
    null,
  )
  useEffect(() => {
    const element = details.current
    const receive = (event: Event) => {
      readingPosition.current = (event as CustomEvent<ReadingPosition>).detail
      setReturnGroup({
        contestId: readingPosition.current.contestId,
        groupId: readingPosition.current.groupId,
      })
    }
    element?.addEventListener(activateSourceEvent, receive)
    return () => element?.removeEventListener(activateSourceEvent, receive)
  }, [index.contestId])

  function returnToReading() {
    const dialog = details.current?.closest('[role="dialog"]')
    if (readingPosition.current?.contestId !== index.contestId) return
    if (!restoreReadingPosition(readingPosition.current, dialog)) return
    readingPosition.current = null
    setReturnGroup(null)
  }

  return (
    <>
      <details
        ref={details}
        className="contest-detail-sources"
        data-contest-sources={index.contestId}
      >
        <summary className="contest-detail-sources-summary">
          信息来源（{index.groups.length}）
        </summary>
        <div className="contest-detail-sources-body">
          <p className="contest-detail-empty">
            引用与摘录集中列在这里，完整内容请查看原文。相同摘录只展示一次；不同版本和未标注版本的记录分别保留，不视为同一份证据。
          </p>
          {!!index.groups.length && (
            <ol className="contest-detail-source-list">
              {index.groups.map((group) => (
                <SourceGroup
                  key={group.id}
                  group={group}
                  canReturn={
                    returnGroup?.contestId === index.contestId && returnGroup.groupId === group.id
                  }
                  onReturn={returnToReading}
                />
              ))}
            </ol>
          )}
          {!index.groups.length && (
            <p className="contest-detail-empty">暂时没有可打开的信息来源。</p>
          )}
          <SourceObservations observations={index.unlinkedObservations} />
        </div>
      </details>
      {contest.summary?.trim() && (
        <details className="contest-detail-history">
          <summary>历史资料（未核实）</summary>
          <p className="contest-detail-empty">保留的历史摘要，不代表本次来源核实结果。</p>
          <ReactMarkdown
            urlTransform={(url) => safeUrl(url) ?? ''}
            components={{
              a: ({ children, href }) =>
                safeUrl(href) ? (
                  <a href={safeUrl(href)} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ) : (
                  <span>{children}</span>
                ),
            }}
          >
            {contest.summary}
          </ReactMarkdown>
        </details>
      )}
    </>
  )
}
