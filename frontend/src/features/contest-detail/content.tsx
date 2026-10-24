import { useState } from 'react'
import { groundedIntroduction, type ContestDetail } from '@/entities/contest'
import type { EvidenceIndex } from './evidence-index'
import { SourceReferences } from './sources'

export function ContestIntroductionSection({
  contest,
  index,
}: {
  contest: ContestDetail
  index: EvidenceIndex
}) {
  const [expanded, setExpanded] = useState(false)
  const introduction = groundedIntroduction(contest)
  if (!introduction) return null
  const long = introduction.text.length > 150
  return (
    <section className="contest-detail-introduction" aria-label="赛事介绍">
      <p className={'contest-detail-about' + (long && !expanded ? ' is-clamped' : '')}>
        {introduction.text}
      </p>
      <div className="contest-detail-introduction-tools">
        {long && (
          <button
            type="button"
            className="contest-detail-text-button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '收起介绍' : '展开介绍'}
          </button>
        )}
        <SourceReferences index={index} refs={index.introductionRefs} label="赛事介绍" />
      </div>
    </section>
  )
}
