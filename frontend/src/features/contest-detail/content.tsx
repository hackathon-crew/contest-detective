import { useState } from 'react'
import { groundedIntroduction, type ContestDetail } from '@/entities/contest'
import type { EvidenceIndex } from './evidence-index'
import { SourceReferences } from './sources'
import { useLocale } from '@/shared/i18n/locale-context'

export function ContestIntroductionSection({
  contest,
  index,
}: {
  contest: ContestDetail
  index: EvidenceIndex
}) {
  const { t } = useLocale()
  const [expanded, setExpanded] = useState(false)
  const introduction = groundedIntroduction(contest)
  if (!introduction) return null
  const long = introduction.text.length > 150
  return (
    <section className="contest-detail-introduction" aria-label={t('赛事介绍')}>
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
            {expanded ? t('收起介绍') : t('展开介绍')}
          </button>
        )}
        <SourceReferences index={index} refs={index.introductionRefs} label={t('赛事介绍')} />
      </div>
    </section>
  )
}
