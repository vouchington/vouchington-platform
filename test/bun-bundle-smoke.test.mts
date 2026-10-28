import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  diffShapes,
  KNOWN_BUN_INCOMPATIBLE,
  listExportEntries,
  shapeOf,
} from '../scripts/bun-bundle-smoke.mts'

describe('Bun bundle smoke test', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function writePackage(root: string, directory: string, manifest: object): void {
    mkdirSync(join(root, 'packages', directory), { recursive: true })
    writeFileSync(join(root, 'packages', directory, 'package.json'), JSON.stringify(manifest))
  }

  it('lists runtime files for every export entry except test harnesses', () => {
    const root = mkdtempSync(join(tmpdir(), 'bun-smoke-'))
    dirs.push(root)
    writePackage(root, 'b', {
      name: '@scope/b',
      exports: {
        '.': { types: './dist/index.d.mts', import: './dist/index.mjs' },
        './sub': { types: './dist/sub.d.mts', default: './dist/sub.mjs' },
        './plain': './dist/plain.mjs',
        './nested': { import: { types: './dist/n.d.mts', default: './dist/n.mjs' } },
        './types-only': { types: './dist/t.d.mts' },
        './testing': { import: './dist/testing.mjs' },
      },
    })
    writePackage(root, 'a', { name: '@scope/a' })

    expect(listExportEntries(root)).toEqual([
      { id: '@scope/b', file: join(root, 'packages/b/dist/index.mjs') },
      { id: '@scope/b/sub', file: join(root, 'packages/b/dist/sub.mjs') },
      { id: '@scope/b/plain', file: join(root, 'packages/b/dist/plain.mjs') },
      { id: '@scope/b/nested', file: join(root, 'packages/b/dist/n.mjs') },
    ])
  })

  it('compares the export names and value types from Node and Bun', () => {
    const node = shapeOf({ Cursor: class {}, b: 1, a: 'x' })
    expect(Object.keys(node)).toEqual(['Cursor', 'a', 'b'])
    expect(diffShapes(node, node)).toEqual([])
    expect(diffShapes(node, { Cursor: 'undefined', a: 'string', extra: 'number' })).toEqual([
      'Cursor: node function, bun undefined',
      'b: node number, bun missing',
      'extra: node missing, bun number',
    ])
  })

  it('names only real repository entries as known Bun incompatibilities', () => {
    const ids = new Set(listExportEntries(process.cwd()).map((entry) => entry.id))
    for (const id of Object.keys(KNOWN_BUN_INCOMPATIBLE)) expect(ids).toContain(id)
  })
})
