import { describe, expect, it } from 'vitest'
import type { ContestDetail, PublicContestDocument, Source } from '@/entities/contest'
import { buildEvidenceIndex } from './evidence-index'

const url = 'https://organizer.example/rules'
const hash = 'a'.repeat(64)
const quote = '每队最多四人，可以个人参赛。'
const citation = { url, content_hash: hash, excerpt: quote }
const source: Source = {
  url,
  title: '官方规则',
  site: '主办方',
  is_official: true,
  value: '最多四人',
  excerpt: quote,
}
const document: PublicContestDocument = {
  url,
  title: '官方规则',
  site: '主办方',
  is_official: true,
  content_hash: hash,
  kind: 'page',
  representation: 'extracted_text',
  completeness: 'partial',
  fetch_method: 'http',
  retrieved_at: '2026-10-24T00:00:00Z',
  extractor_version: 'v1',
  excerpts: [quote],
  body: '第三方完整正文，不可直接展示。',
}
function contest(extra: Partial<ContestDetail> = {}): ContestDetail {
  return {
    id: 'contest',
    name: '测试赛事',
    status: 'upcoming',
    cover_url: null,
    fields: {},
    summary: null,
    ...extra,
  }
}

describe('source evidence index', () => {
  it('deduplicates identical prose without binding unversioned sources to snapshots', () => {
    const index = buildEvidenceIndex(
      contest({
        introduction: { text: '赛事介绍', citations: [citation, { ...citation }] },
        fields: {
          team_size: { value: '最多四人', level: 'official', sources: [source, { ...source }] },
        },
        coverage: {
          introduction: { state: 'found', citations: [citation], urls: [url] },
          fields: { team_size: { state: 'found', citations: [citation] } },
        },
        documents: [document, { ...document }],
      }),
    )
    expect(index.groups).toHaveLength(1)
    const group = index.groups[0]!
    expect(group.excerpts).toHaveLength(1)
    expect(group.excerpts[0]!.text).toBe(quote)
    expect(group.instances.map((item) => item.kind)).toEqual(['citation', 'source', 'document'])
    expect(group.excerpts[0]!.evidenceIds).toHaveLength(3)
    expect(group.instances.find((item) => item.kind === 'source')!.contentHash).toBeNull()
    expect(group.instances.find((item) => item.kind === 'source')!.source).not.toHaveProperty(
      'content_hash',
    )
    const fieldRef = index.refsByField.team_size![0]!
    const bound = group.instances.filter((item) => fieldRef.evidenceIds.includes(item.id))
    expect(bound.map((item) => item.kind)).toEqual(['citation', 'source'])
    expect(bound.some((item) => item.kind === 'document')).toBe(false)
    expect(index.introductionRefs).toHaveLength(1)
  })

  it('retains different hashes, representations, extractors and completeness independently', () => {
    const variants: PublicContestDocument[] = [
      document,
      { ...document, content_hash: 'b'.repeat(64) },
      { ...document, representation: 'markdown' },
      { ...document, extractor_version: 'v2' },
      { ...document, completeness: 'full' },
      { ...document, kind: 'search_snippet' },
    ]
    const index = buildEvidenceIndex(contest({ documents: variants }))
    expect(index.groups).toHaveLength(1)
    expect(index.groups[0]!.instances).toHaveLength(6)
    expect(index.groups[0]!.excerpts).toHaveLength(1)
    expect(index.groups[0]!.excerpts[0]!.evidenceIds).toHaveLength(6)
    expect(index.groups[0]!.instances.map((item) => item.document)).toEqual(
      variants.map(({ body, excerpts, ...metadata }) => {
        void body
        void excerpts
        return metadata
      }),
    )
  })

  it('does not merge different citation versions just because URL and prose match', () => {
    const index = buildEvidenceIndex(
      contest({
        introduction: {
          text: '介绍',
          citations: [citation, { ...citation, content_hash: 'b'.repeat(64) }],
        },
        fields: { team_size: { value: '四人', level: 'official', sources: [source] } },
      }),
    )
    const group = index.groups[0]!
    expect(group.excerpts).toHaveLength(1)
    expect(group.instances.map((instance) => instance.contentHash)).toEqual([
      hash,
      'b'.repeat(64),
      null,
    ])
    expect(index.introductionRefs[0]!.evidenceIds).toHaveLength(2)
    expect(index.refsByField.team_size![0]!.evidenceIds).toEqual([group.instances[2]!.id])
  })

  it('preserves same-URL contradictory values, official flags and stale evidence', () => {
    const index = buildEvidenceIndex(
      contest({
        fields: {
          team_size: {
            value: null,
            level: 'conflict',
            sources: [
              source,
              {
                ...source,
                is_official: false,
                value: '两至四人',
                excerpt: '每队必须两至四人。',
                stale: true,
              },
            ],
          },
        },
      }),
    )
    const group = index.groups[0]!
    expect(group.instances).toHaveLength(2)
    expect(group.excerpts.map((item) => item.text)).toEqual([quote, '每队必须两至四人。'])
    expect(group.instances.map((item) => item.source?.is_official)).toEqual([true, false])
    expect(group.instances[1]!.source?.stale).toBe(true)
    expect(group.instances.every((item) => item.uses[0]?.level === 'conflict')).toBe(true)
    expect(index.refsByField.team_size![0]!.evidenceIds).toHaveLength(2)
  })

  it('deduplicates structurally identical Source records regardless of object key order', () => {
    const reordered = Object.fromEntries(Object.entries(source).reverse()) as Source
    const index = buildEvidenceIndex(
      contest({
        fields: { eligibility: { value: '学生', level: 'official', sources: [source, reordered] } },
      }),
    )
    expect(index.groups[0]!.instances).toHaveLength(1)
  })

  it('keeps field, introduction and theme bindings explicit, including shared excerpts', () => {
    const index = buildEvidenceIndex(
      contest({
        introduction: { text: '介绍', citations: [citation] },
        fields: { team_size: { value: '最多四人', level: 'official', sources: [source] } },
        themes: ['AI'],
        theme_sources: [source],
        documents: [document],
      }),
    )
    const group = index.groups[0]!
    const sourceInstance = group.instances.find((item) => item.kind === 'source')!
    expect(sourceInstance.uses.map((use) => use.key)).toEqual(['field:team_size', 'themes'])
    expect(index.refsByField.team_size![0]!.evidenceIds).toEqual([sourceInstance.id])
    expect(index.themeRefs[0]!.evidenceIds).toEqual([sourceInstance.id])
    expect(index.introductionRefs[0]!.evidenceIds).not.toContain(sourceInstance.id)
  })

  it('retains a readable source even when public excerpts are missing', () => {
    const index = buildEvidenceIndex(contest({ documents: [{ ...document, excerpts: [] }] }))
    expect(index.groups[0]!.url).toBe(url)
    expect(index.groups[0]!.excerpts).toEqual([])
    expect(index.groups[0]!.instances[0]!.document).not.toHaveProperty('body')
    expect(JSON.stringify(index)).not.toContain(document.body)
  })

  it('does not republish body even when full-text publication is permitted', () => {
    const index = buildEvidenceIndex(
      contest({ documents: [{ ...document, publication: 'full_text_allowed' }] }),
    )
    expect(JSON.stringify(index)).not.toContain(document.body)
    expect(index.groups[0]!.instances[0]!.document?.publication).toBe('full_text_allowed')
  })

  it('filters every unsafe URL source and invalid citation before indexing', () => {
    const unsafe = 'javascript:alert(1)'
    const index = buildEvidenceIndex(
      contest({
        introduction: {
          text: '无效介绍',
          citations: [
            { ...citation, url: unsafe },
            { ...citation, content_hash: 'invalid' },
          ],
        },
        fields: {
          team_size: { value: '四人', level: 'official', sources: [{ ...source, url: unsafe }] },
        },
        theme_sources: [{ ...source, url: 'data:text/html,hello' }],
        documents: [{ ...document, url: unsafe }],
        coverage: {
          fields: {
            team_size: {
              state: 'source_unpublished',
              citations: [{ ...citation, url: unsafe }],
              urls: [unsafe],
            },
          },
          sources: { [unsafe]: { state: 'fetch_failed' } },
        },
      }),
    )
    expect(index.groups).toEqual([])
    expect(index.introductionRefs).toEqual([])
    expect(index.themeRefs).toEqual([])
    expect(index.refsByField.team_size).toEqual([])
    expect(index.unlinkedObservations.map((item) => item.label)).toEqual(['未核实', '来源读取失败'])
  })

  it.each([
    ['not_fetched', '尚未抓取'],
    ['fetch_failed', '来源读取失败'],
    ['extract_failed', '内容提取失败'],
    ['not_found_in_source', '已查来源中未找到'],
  ] as const)('keeps %s as collection metadata, not organizer nonpublication', (state, label) => {
    const index = buildEvidenceIndex(
      contest({ coverage: { fields: { entry_fee: { state, urls: [url] } } } }),
    )
    expect(index.groups[0]!.observations[0]!.label).toBe(label)
    expect(index.groups[0]!.instances[0]!.kind).toBe('url')
    expect(index.groups[0]!.excerpts).toEqual([])
    expect(JSON.stringify(index)).not.toContain('来源明确未公布')
  })

  it('requires a usable citation to label an explicit source omission', () => {
    const index = buildEvidenceIndex(
      contest({
        coverage: {
          fields: {
            entry_fee: { state: 'source_unpublished', citations: [citation] },
            team_size: { state: 'source_unpublished', urls: [url] },
          },
        },
      }),
    )
    expect(index.groups[0]!.observations.map((item) => item.label)).toEqual([
      '来源明确未公布',
      '未核实',
    ])
  })

  it('keeps exact URL boundaries and different prose rather than guessing equivalence', () => {
    const index = buildEvidenceIndex(
      contest({
        documents: [
          document,
          { ...document, url: `${url}/` },
          { ...document, excerpts: [` ${quote}`] },
        ],
      }),
    )
    expect(index.groups).toHaveLength(2)
    expect(index.groups[0]!.excerpts.map((item) => item.text)).toEqual([quote, ` ${quote}`])
  })

  it('is deterministic and leaves the input unchanged', () => {
    const input = contest({
      documents: [document],
      fields: { team_size: { value: '四人', level: 'official', sources: [source] } },
    })
    const before = JSON.stringify(input)
    expect(buildEvidenceIndex(input)).toEqual(buildEvidenceIndex(input))
    expect(JSON.stringify(input)).toBe(before)
  })
})
