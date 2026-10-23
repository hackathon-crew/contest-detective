import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 分层规则：app → pages → features → entities → shared，只能引用比自己低的层。
 * pages、features、entities 里每个子目录是一个切片，同层切片之间不互相引用，需要共用的东西往下放一层。
 * app 和 shared 内部不分切片，层内可以互相引用。src 根下的 main.tsx 是入口，不受限制。
 */
const LAYERS = ['shared', 'entities', 'features', 'pages', 'app']
const SLICED_LAYERS = new Set(['entities', 'features', 'pages'])

const SRC = resolve(import.meta.dirname)

interface SourceFile {
  /** 相对 src 的路径，用 / 分隔 */
  path: string
  source: string
}

interface Position {
  rank: number
  layer: string
  slice: string | null
}

function positionOf(pathFromSrc: string): Position | null {
  const [layer = '', slice = null] = pathFromSrc.split('/')
  const rank = LAYERS.indexOf(layer)
  if (rank < 0) return null
  return { rank, layer, slice: SLICED_LAYERS.has(layer) ? slice : null }
}

/** 静态 import、export from、副作用 import 和动态 import() 的模块路径。 */
function specifiersOf(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\1/gu)].map(
    (match) => match[2]!,
  )
}

/** 解析成相对 src 的路径；第三方包返回 null。 */
function targetOf(fromPath: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return specifier.slice(2)
  if (!specifier.startsWith('.')) return null
  return relative(SRC, resolve(SRC, dirname(fromPath), specifier))
    .split(sep)
    .join('/')
}

function findViolations(files: SourceFile[]): string[] {
  const violations: string[] = []
  for (const file of files) {
    const from = positionOf(file.path)
    if (!from) continue

    for (const specifier of specifiersOf(file.source)) {
      const target = targetOf(file.path, specifier)
      if (target === null) continue
      const to = positionOf(target)
      const where = `${file.path} 引用 ${specifier}`

      if (!to) violations.push(`${where}：分层里的代码不能引用 src 根下的入口文件`)
      else if (to.rank > from.rank)
        violations.push(`${where}：${from.layer} 不能依赖上层的 ${to.layer}`)
      else if (to.rank === from.rank && to.slice !== from.slice)
        violations.push(
          `${where}：${from.layer}/${from.slice} 和 ${to.layer}/${to.slice} 是同层切片`,
        )
    }
  }
  return violations
}

function sourceFiles(directory: string): SourceFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(absolute)
    if (!/\.tsx?$/u.test(entry.name) || entry.name.includes('.test.')) return []
    return [
      {
        path: relative(SRC, absolute).split(sep).join('/'),
        source: readFileSync(absolute, 'utf8'),
      },
    ]
  })
}

describe('分层依赖方向', () => {
  it('src 里没有违反分层的引用', () => {
    expect(findViolations(sourceFiles(SRC))).toEqual([])
  })

  it('下层引用上层时报错', () => {
    const violations = findViolations([
      { path: 'entities/contest/api.ts', source: "import { X } from '@/features/contest-browser'" },
      { path: 'shared/api/client.ts', source: "import type { Y } from '../../pages/home'" },
    ])

    expect(violations).toHaveLength(2)
  })

  it('同层切片互相引用时报错，包括用相对路径绕过去的', () => {
    const violations = findViolations([
      {
        path: 'features/detective/dock.tsx',
        source: "import { A } from '@/features/contest-detail'",
      },
      {
        path: 'features/weekly-picks/list.tsx',
        source: "import { B } from '../contest-browser/x'",
      },
      { path: 'pages/home/page.tsx', source: "const C = import('@/pages/about')" },
    ])

    expect(violations).toHaveLength(3)
  })

  it('向下引用、切片内部引用和 app、shared 层内引用都允许', () => {
    const violations = findViolations([
      {
        path: 'features/detective/dock.tsx',
        source:
          "import { A } from './panel'\nimport { B } from '@/entities/contest'\nimport '@/shared/api'",
      },
      {
        path: 'app/app.tsx',
        source: "import { C } from './query-client'\nimport { D } from '@/pages/home'",
      },
      {
        path: 'shared/api/index.ts',
        source: "export * from './client'\nimport { E } from 'react'",
      },
      { path: 'main.tsx', source: "import { App } from '@/app'\nimport './index.css'" },
    ])

    expect(violations).toEqual([])
  })
})
