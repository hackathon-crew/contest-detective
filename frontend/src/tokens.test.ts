// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { checkTokens } from '@huyanxius/ui/checks'
import { expect, it } from 'vitest'

it('uses semantic colors and the shared size scale', () => {
  expect(checkTokens(import.meta.dirname, { semanticRadii: true })).toEqual([])
})

// Older stylesheets have a fixed allowance until they migrate to the shared tokens.
const legacyCssLiterals: Record<string, [colors: number, radii: number]> = {
  'features/auth/auth-controls.css': [0, 1],
  'features/contest-detail/contest-detail.css': [2, 1],
  'features/detective/detective-conversation.css': [0, 2],
  'features/detective/detective-workspace.css': [3, 2],
  'features/detective/live/live.css': [32, 0],
  'features/detective/research-panel.css': [1, 0],
  'pages/contests/contests-page.css': [3, 25],
  'pages/home/home-page.css': [9, 21],
  'pages/home/home-refresh.css': [0, 9],
}

const commentsAndStrings = /\/\*[\s\S]*?\*\/|url\([^)]*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/giu
const declaration = /(?:^|[;{}])\s*([\w-]+)\s*:\s*([^;{}]+)(?=[;}])/gu
const colorLiteral =
  /#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})(?![\w-])|(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|device-cmyk)\(/giu
const identifier = /(?<![\w-])[a-z]+(?![\w(-])/giu
const colorProperty = /^(?:--|.*(?:color|background|border|shadow|fill|stroke|outline))/u
const radiusProperty = /^(?:border(?:-[a-z]+)*-radius|--radius-|--r-)/u
const length = /(?<![\w.-])(\d+\.?\d*|\.\d+)(?:[a-z]+|%)(?![\w-])/giu
const allowedColors = new Set([
  'transparent',
  'currentcolor',
  'inherit',
  'initial',
  'unset',
  'revert',
])
const colorProbe = document.createElement('span').style

function isColorKeyword(value: string) {
  if (allowedColors.has(value.toLowerCase())) return false
  colorProbe.color = ''
  colorProbe.color = value
  return colorProbe.color !== ''
}

function findCssLiterals(source: string) {
  const colors: string[] = []
  const radii: string[] = []
  for (const [, property, value] of source.replace(commentsAndStrings, '').matchAll(declaration)) {
    const rawColors = [...value.matchAll(colorLiteral)]
    const names = colorProperty.test(property)
      ? [...value.matchAll(identifier)].filter(([name]) => isColorKeyword(name))
      : []
    for (const [color] of [...rawColors, ...names]) {
      colors.push(`${property}: ${color}`)
    }
    if (
      radiusProperty.test(property) &&
      [...value.matchAll(length)].some(([, size]) => Number(size))
    ) {
      radii.push(`${property}: ${value.trim()}`)
    }
  }
  return { colors, radii }
}

it('keeps hardcoded colors and radii out of application CSS', () => {
  const root = import.meta.dirname
  const violations = readdirSync(root, { recursive: true, withFileTypes: true }).flatMap(
    (entry) => {
      if (!entry.isFile() || !entry.name.endsWith('.css')) return []
      const path = join(entry.parentPath, entry.name)
      const file = relative(root, path)
      const { colors, radii } = findCssLiterals(readFileSync(path, 'utf8'))
      const [allowedColors, allowedRadii] = legacyCssLiterals[file] ?? [0, 0]
      return [
        ...(colors.length > allowedColors
          ? [
              `${file} has ${colors.length} hardcoded colors (limit ${allowedColors}): ${colors.join(', ')}`,
            ]
          : []),
        ...(radii.length > allowedRadii
          ? [`${file} has ${radii.length} fixed radii (limit ${allowedRadii}): ${radii.join(', ')}`]
          : []),
      ]
    },
  )
  expect(violations).toEqual([])
})
