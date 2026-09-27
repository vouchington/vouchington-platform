import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, win32 } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { generateSchemaSnapshot, writeSchemaSnapshot } from './generate.mts'
import { emptyGrowth } from './snapshot.test-helpers.mts'

const absoluteRelations = vi.hoisted(() => new Map<string, string>())
vi.mock<typeof import('node:path')>(import('node:path'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    relative: (from, to) => absoluteRelations.get(`${from}\0${to}`) ?? actual.relative(from, to),
    isAbsolute: (path) => actual.isAbsolute(path) || actual.win32.isAbsolute(path),
  }
})
const roots: string[] = []
afterEach(async () => {
  absoluteRelations.clear()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
it('requires same-volume automatic links while accepting caller-rendered Markdown', async () => {
  const base = await mkdtemp(join(tmpdir(), 'schema-cross-volume-'))
  roots.push(base)
  const root = join(base, 'runtime')
  const markdownRoot = join(base, 'reference')
  await Promise.all([mkdir(root), mkdir(markdownRoot)])
  const jsonPath = resolve(root, 'schema.json')
  await writeFile(jsonPath, 'keep JSON\n')
  await writeFile(join(markdownRoot, 'README.md'), 'keep Markdown\n')
  // Model Windows path.relative's cross-drive result without requiring mounted Windows drives.
  const driveRelation = win32.relative('C:\\reference', 'D:\\runtime\\schema.json')
  expect(win32.isAbsolute(driveRelation)).toBe(true)
  absoluteRelations.set(`${resolve(markdownRoot)}\0${jsonPath}`, driveRelation)
  for (const check of [false, true]) {
    let formatted = false
    await expect(
      generateSchemaSnapshot({
        query: async () => ({ rows: [] }),
        growth: emptyGrowth(),
        root,
        markdownRoot,
        check,
        format: async (_path, raw) => {
          formatted = true
          return raw
        },
      }),
    ).rejects.toThrow(
      'Automatic schema JSON links require output roots on the same filesystem volume',
    )
    expect(formatted).toBe(false)
    await expect(readFile(jsonPath, 'utf8')).resolves.toBe('keep JSON\n')
    await expect(readFile(join(markdownRoot, 'README.md'), 'utf8')).resolves.toBe('keep Markdown\n')
  }
  const content = '[schema.json](https://example.test/schema.json)\n'
  const options = {
    snapshot: {
      formatVersion: 2 as const,
      tables: {},
      views: {},
      enums: {},
      extensions: {},
      functions: {},
      policies: {},
    },
    markdown: new Map([['README.md', content]]),
    root,
    markdownRoot,
  }
  await writeSchemaSnapshot(options)
  await expect(readFile(join(markdownRoot, 'README.md'), 'utf8')).resolves.toBe(content)
  await expect(writeSchemaSnapshot({ ...options, check: true })).resolves.toBeUndefined()
})
