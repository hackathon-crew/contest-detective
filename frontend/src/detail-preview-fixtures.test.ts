// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { publicConflict, publicFull, publicLongReward } from './detail-preview-fixtures'
import fullSnapshot from '../preview/detail-full-public-snapshot.json'
import conflictSnapshot from '../preview/detail-conflict-public-snapshot.json'
import longRewardSnapshot from '../preview/detail-long-reward-public-snapshot.json'
import provenance from '../preview/detail-preview-provenance.json'

const imagePattern = /(!\[[^\]]*\]\()([^)]+)(\))/g

describe('isolated preview image transport', () => {
  it.each([
    ['full', publicFull, fullSnapshot],
    ['conflict', publicConflict, conflictSnapshot],
    ['long-reward', publicLongReward, longRewardSnapshot],
  ] as const)('preserves public fields and evidence in the %s snapshot', (_name, rendered, raw) => {
    const { cover_url: renderedCover, summary: renderedSummary, ...renderedData } = rendered
    const {
      cover_url: originalCover,
      summary: originalSummary,
      ...originalData
    } = raw.response.data
    expect(renderedData).toEqual(originalData)
    expect(renderedCover).not.toBe(originalCover)
    expect(new URL(renderedCover!).origin).toBe(location.origin)
    const withoutImageAddresses = (summary: string | null) =>
      summary?.replace(imagePattern, '$1IMAGE$3')
    expect(withoutImageAddresses(renderedSummary)).toBe(withoutImageAddresses(originalSummary))
  })

  it('localizes every historical Markdown image, even while the section is collapsed', () => {
    const original = [...longRewardSnapshot.response.data.summary.matchAll(imagePattern)]
    const rendered = [...publicLongReward.summary!.matchAll(imagePattern)]
    expect(original).toHaveLength(4)
    expect(rendered).toHaveLength(original.length)
    expect(rendered.map((match) => match[1])).toEqual(original.map((match) => match[1]))
    for (const image of rendered) expect(new URL(image[2]!).origin).toBe(location.origin)
    for (const image of original) expect(publicLongReward.summary).not.toContain(image[2])
  })

  it('keeps image bytes consistent with the recorded public-source hashes', () => {
    const images = provenance.scenarios.flatMap((scenario) => [
      scenario.cover,
      ...('embedded_images' in scenario ? (scenario.embedded_images ?? []) : []),
    ])
    expect(images).toHaveLength(7)
    for (const image of images) {
      const content = readFileSync(resolve(import.meta.dirname, '../preview', image.file))
      expect(createHash('sha256').update(content).digest('hex')).toBe(image.sha256)
    }
  })
})
