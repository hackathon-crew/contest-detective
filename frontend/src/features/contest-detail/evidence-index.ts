import {
  coverageLabel,
  fieldNames,
  safeUrl,
  usableCitations,
  type ContentCitation,
  type ContestDetail,
  type CoverageObservation,
  type FieldValue,
  type PublicContestDocument,
  type Source,
} from '@/entities/contest'

export interface EvidenceUse {
  key: string
  label: string
  level?: FieldValue['level']
}

export interface EvidenceInstance {
  id: string
  kind: 'citation' | 'source' | 'document' | 'url'
  contentHash: string | null
  source?: Omit<Source, 'excerpt'>
  document?: Omit<PublicContestDocument, 'body' | 'excerpts'>
  excerptIds: string[]
  uses: EvidenceUse[]
}

export interface EvidenceExcerpt {
  id: string
  text: string
  evidenceIds: string[]
}

export interface EvidenceObservation {
  id: string
  state: CoverageObservation['state']
  label: string
  checkedAt?: string | null
  reason?: string | null
  uses: EvidenceUse[]
  evidenceIds: string[]
}

export interface EvidenceGroup {
  id: string
  number: number
  url: string
  title: string
  instances: EvidenceInstance[]
  excerpts: EvidenceExcerpt[]
  observations: EvidenceObservation[]
}

export interface EvidenceReference {
  groupId: string
  evidenceIds: string[]
}

export interface EvidenceIndex {
  contestId: string
  groups: EvidenceGroup[]
  refsByField: Record<string, EvidenceReference[]>
  introductionRefs: EvidenceReference[]
  themeRefs: EvidenceReference[]
  unlinkedObservations: EvidenceObservation[]
}

function addUse(uses: EvidenceUse[], use: EvidenceUse) {
  if (!uses.some((item) => item.key === use.key)) uses.push(use)
}

function evidenceKey(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
        )
      : item,
  )
}

function addReference(refs: EvidenceReference[], group: EvidenceGroup, evidenceId: string) {
  let ref = refs.find((item) => item.groupId === group.id)
  if (!ref) {
    ref = { groupId: group.id, evidenceIds: [] }
    refs.push(ref)
  }
  if (!ref.evidenceIds.includes(evidenceId)) ref.evidenceIds.push(evidenceId)
}

/**
 * A URL groups navigation, not truth. Identical prose is displayed once, but its
 * versioned and unversioned evidence instances remain separate. In particular,
 * Source has no content_hash: matching text must never bind it to a snapshot.
 */
export function buildEvidenceIndex(contest: ContestDetail): EvidenceIndex {
  const index: EvidenceIndex = {
    contestId: contest.id,
    groups: [],
    refsByField: {},
    introductionRefs: [],
    themeRefs: [],
    unlinkedObservations: [],
  }
  const groups = new Map<string, EvidenceGroup>()
  const instances = new Map<string, EvidenceInstance>()
  const observations = new Map<string, EvidenceObservation>()

  function groupFor(url: string, title?: string): EvidenceGroup | undefined {
    if (!safeUrl(url)) return
    let group = groups.get(url)
    if (!group) {
      const number = index.groups.length + 1
      group = {
        id: `source-${number}`,
        number,
        url,
        title: title?.trim() || new URL(url).hostname,
        instances: [],
        excerpts: [],
        observations: [],
      }
      groups.set(url, group)
      index.groups.push(group)
    } else if (title?.trim() && group.title === new URL(url).hostname) {
      group.title = title.trim()
    }
    return group
  }

  function addInstance(
    url: string,
    data: Omit<EvidenceInstance, 'id' | 'excerptIds' | 'uses'>,
    excerpts: string[],
    use: EvidenceUse,
    refs?: EvidenceReference[],
  ) {
    const group = groupFor(url, data.source?.title || data.document?.title)
    if (!group) return
    // Include all metadata, not merely URL/hash: representations, stale values,
    // extraction versions, and contradictory official flags must survive.
    const key = evidenceKey([url, data, excerpts])
    let instance = instances.get(key)
    if (!instance) {
      instance = {
        ...data,
        id: `${group.id}-e${group.instances.length + 1}`,
        excerptIds: [],
        uses: [],
      }
      instances.set(key, instance)
      group.instances.push(instance)
      for (const text of excerpts) {
        if (!text.trim()) continue
        let excerpt = group.excerpts.find((item) => item.text === text)
        if (!excerpt) {
          excerpt = { id: `${group.id}-q${group.excerpts.length + 1}`, text, evidenceIds: [] }
          group.excerpts.push(excerpt)
        }
        if (!excerpt.evidenceIds.includes(instance.id)) excerpt.evidenceIds.push(instance.id)
        if (!instance.excerptIds.includes(excerpt.id)) instance.excerptIds.push(excerpt.id)
      }
    }
    addUse(instance.uses, use)
    if (refs) addReference(refs, group, instance.id)
    return { group, instance }
  }

  function addCitations(
    citations: ContentCitation[] | undefined,
    use: EvidenceUse,
    refs: EvidenceReference[],
  ) {
    for (const citation of usableCitations(citations)) {
      addInstance(
        citation.url,
        { kind: 'citation', contentHash: citation.content_hash },
        [citation.excerpt],
        use,
        refs,
      )
    }
  }

  function addSources(sources: Source[] | undefined, use: EvidenceUse, refs: EvidenceReference[]) {
    for (const source of sources ?? []) {
      const { excerpt, ...metadata } = source
      addInstance(
        source.url,
        { kind: 'source', contentHash: null, source: metadata },
        excerpt ? [excerpt] : [],
        use,
        refs,
      )
    }
  }

  function addObservation(
    observation: CoverageObservation | undefined,
    use: EvidenceUse,
    refs: EvidenceReference[],
    sourceUrl?: string,
  ) {
    if (!observation) return
    const observationRefs: EvidenceReference[] = []
    addCitations(observation.citations, use, observationRefs)
    for (const url of new Set([...(observation.urls ?? []), ...(sourceUrl ? [sourceUrl] : [])])) {
      if (observationRefs.some((ref) => groups.get(url)?.id === ref.groupId)) continue
      // URL-only availability is a separate record, not evidence for a value.
      addInstance(url, { kind: 'url', contentHash: null }, [], use, observationRefs)
    }
    for (const ref of observationRefs) {
      const group = index.groups.find((item) => item.id === ref.groupId)!
      ref.evidenceIds.forEach((id) => addReference(refs, group, id))
    }
    const destinations = observationRefs.length
      ? observationRefs.map((ref) => ({
          ref,
          list: index.groups.find((group) => group.id === ref.groupId)!.observations,
        }))
      : [{ ref: undefined, list: index.unlinkedObservations }]
    for (const { ref, list } of destinations) {
      const key = evidenceKey([ref?.groupId ?? null, observation])
      let item = observations.get(key)
      if (!item) {
        item = {
          id: `observation-${observations.size + 1}`,
          state: observation.state,
          label: coverageLabel(observation),
          checkedAt: observation.checked_at,
          reason: observation.reason,
          uses: [],
          evidenceIds: [...(ref?.evidenceIds ?? [])],
        }
        observations.set(key, item)
        list.push(item)
      }
      addUse(item.uses, use)
    }
  }

  addCitations(
    contest.introduction?.citations,
    { key: 'introduction', label: '赛事介绍' },
    index.introductionRefs,
  )
  for (const [field, value] of Object.entries(contest.fields)) {
    const refs = (index.refsByField[field] = [])
    addSources(
      value.sources,
      { key: `field:${field}`, label: fieldNames[field] ?? field, level: value.level },
      refs,
    )
  }
  addSources(contest.theme_sources, { key: 'themes', label: '赛事主题' }, index.themeRefs)
  addObservation(
    contest.coverage?.introduction,
    { key: 'coverage:introduction', label: '介绍采集记录' },
    index.introductionRefs,
  )
  for (const [field, observation] of Object.entries(contest.coverage?.fields ?? {})) {
    const refs = (index.refsByField[field] ??= [])
    addObservation(
      observation,
      { key: `coverage:${field}`, label: `${fieldNames[field] ?? field}采集记录` },
      refs,
    )
  }
  for (const [url, observation] of Object.entries(contest.coverage?.sources ?? {})) {
    addObservation(observation, { key: `coverage:source:${url}`, label: '来源读取记录' }, [], url)
  }
  for (const document of contest.documents ?? []) {
    // Deliberately project metadata. Even full_text_allowed must not opt this UI
    // into republishing body, and body must not affect displayed deduplication.
    const metadata: NonNullable<EvidenceInstance['document']> = {
      url: document.url,
      site: document.site,
      title: document.title,
      is_official: document.is_official,
      published_at: document.published_at,
      kind: document.kind,
      representation: document.representation,
      fetch_method: document.fetch_method,
      completeness: document.completeness,
      publication: document.publication,
      publication_license_url: document.publication_license_url,
      content_hash: document.content_hash,
      retrieved_at: document.retrieved_at,
      extractor_version: document.extractor_version,
    }
    addInstance(
      document.url,
      { kind: 'document', contentHash: document.content_hash, document: metadata },
      document.excerpts ?? [],
      { key: 'document', label: '公开来源资料' },
    )
  }
  return index
}
