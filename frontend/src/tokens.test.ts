import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

function violations(source: string): string[] {
  const errors: string[] = []
  const tree = ts.createSourceFile(
    'component.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'className') {
      const text = node.initializer?.getText(tree) ?? ''
      if (
        /\b(?:text|bg|border|rounded|max-w|min-w|w|h|ring|size|p|m|gap|duration)-\[[^\]]+\]/u.test(
          text,
        )
      )
        errors.push('arbitrary utility')
      if (
        /\b(?:bg|text|border|ring|fill|stroke)-(?:white|black|gray|slate|red|blue|green|yellow|violet)(?:-\d+)?\b/u.test(
          text,
        )
      )
        errors.push('palette color')
    }
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(tree) === 'style' &&
      /(?:color|background|fill|stroke|shadow)/iu.test(node.getText(tree))
    )
      errors.push('inline color')
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return errors
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : /\.tsx$/u.test(entry.name) && !entry.name.includes('.test.')
        ? [join(dir, entry.name)]
        : [],
  )
}

it('rejects arbitrary utilities and inline colors', () => {
  expect(violations('<div className="text-[13px] bg-[#fff]" />')).toHaveLength(1)
  expect(violations('<div style={{ color: "red" }} />')).toHaveLength(1)
  expect(violations('<div className="text-red-500" />')).toHaveLength(1)
  expect(violations('<div className="text-sm rounded-xl text-ink" />')).toEqual([])
})

it('uses semantic colors and the shared size scale', () => {
  expect(
    files(import.meta.dirname).flatMap((path) =>
      violations(readFileSync(path, 'utf8')).map((error) => `${path}: ${error}`),
    ),
  ).toEqual([])
})
