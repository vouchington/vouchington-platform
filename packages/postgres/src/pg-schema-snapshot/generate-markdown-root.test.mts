import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateSchemaSnapshot, stableStringify, writeSchemaSnapshot } from './generate.mts'
import { emptyGrowth } from './snapshot.test-helpers.mts'
import type { SchemaSnapshot } from './types.mts'

const snapshot: SchemaSnapshot = {
  formatVersion: 2,
  tables: {},
  views: {},
  enums: {},
  extensions: {},
  functions: {},
  policies: {},
}
const markdown = new Map([
  ['README.md', '# Schema\n'],
  ['tables/widgets.md', '# Widgets\n'],
])
const roots: string[] = []

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'schema-markdown-root-'))
  roots.push(base)
  const root = join(base, 'runtime')
  const markdownRoot = join(base, 'reference')
  await Promise.all([mkdir(root), mkdir(markdownRoot)])
  return { base, root, markdownRoot }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('separate schema Markdown output', () => {
  it.each(['same', 'ancestor', 'alias'] as const)(
    'rejects a Markdown root containing the JSON root via %s paths before writing',
    async (kind) => {
      const { base, root } = await fixture()
      await writeFile(join(root, 'schema.json'), 'keep JSON\n')
      await writeFile(join(root, 'schema.md'), 'keep legacy\n')
      const alias = join(base, 'alias')
      // Alias the ancestor, so the root itself remains a regular directory under lstat.
      if (kind === 'alias') await symlink(base, alias)
      const markdownRoot =
        kind === 'ancestor' ? base : kind === 'alias' ? join(alias, 'runtime') : root
      for (const check of [false, true]) {
        await expect(
          writeSchemaSnapshot({
            snapshot,
            markdown,
            root: relative(process.cwd(), root),
            markdownRoot,
            check,
          }),
        ).rejects.toThrow('Markdown output root must not contain the JSON snapshot root')
        await expect(readFile(join(root, 'schema.json'), 'utf8')).resolves.toBe('keep JSON\n')
        await expect(readFile(join(root, 'schema.md'), 'utf8')).resolves.toBe('keep legacy\n')
        await expect(readFile(join(root, 'README.md'))).rejects.toThrow(/ENOENT/)
      }
    },
  )

  it.each(['schema.json', 'schema.md', 'schema.json/nested', 'schema.md/nested'])(
    'rejects a Markdown directory under reserved output %s before formatting',
    async (reservedPath) => {
      const { root } = await fixture()
      const markdownRoot = join(root, reservedPath)
      await mkdir(markdownRoot, { recursive: true })
      await writeFile(join(markdownRoot, 'sentinel.txt'), 'keep\n')
      for (const check of [false, true]) {
        let formatted = false
        await expect(
          writeSchemaSnapshot({
            snapshot,
            markdown,
            root,
            markdownRoot,
            check,
            format: async (_path, raw) => {
              formatted = true
              return raw
            },
          }),
        ).rejects.toThrow('Markdown output root must not overlap reserved snapshot paths')
        expect(formatted).toBe(false)
        await expect(readFile(join(markdownRoot, 'sentinel.txt'), 'utf8')).resolves.toBe('keep\n')
        await expect(readFile(join(markdownRoot, 'README.md'))).rejects.toThrow(/ENOENT/)
      }
    },
  )

  it('allows an explicit Markdown directory below the JSON root', async () => {
    const { root } = await fixture()
    const markdownRoot = join(root, 'markdown')
    await mkdir(markdownRoot)
    const options = { snapshot, markdown, root, markdownRoot }
    await writeSchemaSnapshot(options)
    await expect(readFile(join(markdownRoot, 'README.md'), 'utf8')).resolves.toBe('# Schema\n')
    await expect(writeSchemaSnapshot({ ...options, check: true })).resolves.toBeUndefined()
  })

  it.each(['absolute', 'relative'])('writes separate outputs with %s roots', async (kind) => {
    const { root, markdownRoot } = await fixture()
    const options = {
      snapshot,
      markdown,
      root: kind === 'relative' ? relative(process.cwd(), root) : root,
      markdownRoot: kind === 'relative' ? relative(process.cwd(), markdownRoot) : markdownRoot,
    }
    await writeSchemaSnapshot(options)

    await expect(readFile(join(root, 'schema.json'), 'utf8')).resolves.toBe(
      stableStringify(snapshot),
    )
    await expect(readFile(join(markdownRoot, 'README.md'), 'utf8')).resolves.toBe('# Schema\n')
    await expect(readFile(join(markdownRoot, 'tables/widgets.md'), 'utf8')).resolves.toBe(
      '# Widgets\n',
    )
    await expect(readFile(join(root, 'markdown/README.md'))).rejects.toThrow(/ENOENT/)
    await expect(writeSchemaSnapshot({ ...options, check: true })).resolves.toBeUndefined()
  })

  it.each(['runtime', 'runtime #notes', 'runtime )notes'])(
    'links catalog output to JSON root %s and checks it',
    async (name) => {
      const { base, root: originalRoot, markdownRoot } = await fixture()
      const root = name === 'runtime' ? originalRoot : join(base, name)
      if (root !== originalRoot) await mkdir(root)
      const options = {
        query: async () => ({ rows: [] }),
        growth: emptyGrowth(),
        root,
        markdownRoot,
      }
      await generateSchemaSnapshot(options)
      await expect(readFile(join(root, 'schema.json'), 'utf8')).resolves.toBe(
        stableStringify(snapshot),
      )
      await expect(readFile(join(markdownRoot, 'README.md'), 'utf8')).resolves.toContain(
        name === 'runtime'
          ? '[`schema.json`](../runtime/schema.json)'
          : name === 'runtime #notes'
            ? '[`schema.json`](../runtime%20%23notes/schema.json)'
            : '[`schema.json`](../runtime%20%29notes/schema.json)',
      )
      await expect(readFile(join(root, 'markdown/README.md'))).rejects.toThrow(/ENOENT/)
      await expect(generateSchemaSnapshot({ ...options, check: true })).resolves.toBeUndefined()
    },
  )

  it.each(['json', 'markdown', 'orphan'] as const)(
    'checks %s drift without writing',
    async (kind) => {
      const { root, markdownRoot } = await fixture()
      await writeSchemaSnapshot({ snapshot, markdown, root, markdownRoot })
      const path =
        kind === 'json'
          ? join(root, 'schema.json')
          : join(markdownRoot, kind === 'markdown' ? 'README.md' : 'orphan.md')
      await writeFile(path, 'stale\n')
      await expect(
        writeSchemaSnapshot({ snapshot, markdown, root, markdownRoot, check: true }),
      ).rejects.toThrow(path)
      await expect(readFile(path, 'utf8')).resolves.toBe('stale\n')
    },
  )

  it('cleans only the managed Markdown tree and the existing legacy schema.md', async () => {
    const { root, markdownRoot } = await fixture()
    await writeSchemaSnapshot({ snapshot, markdown, root, markdownRoot })
    await mkdir(join(markdownRoot, 'nested'))
    await writeFile(join(markdownRoot, 'nested/orphan.md'), 'orphan\n')
    await mkdir(join(root, 'markdown'))
    await writeFile(join(root, 'markdown/unmanaged.md'), 'keep\n')
    await writeFile(join(root, 'source.mts'), 'keep source\n')
    await writeFile(join(root, 'schema.md'), 'legacy\n')

    await writeSchemaSnapshot({ snapshot, markdown, root, markdownRoot })
    await expect(readFile(join(markdownRoot, 'nested/orphan.md'))).rejects.toThrow(/ENOENT/)
    await expect(readFile(join(root, 'schema.md'))).rejects.toThrow(/ENOENT/)
    await expect(readFile(join(root, 'markdown/unmanaged.md'), 'utf8')).resolves.toBe('keep\n')
    await expect(readFile(join(root, 'source.mts'), 'utf8')).resolves.toBe('keep source\n')
    await expect(readFile(join(root, 'schema.json'), 'utf8')).resolves.toBe(
      stableStringify(snapshot),
    )
  })

  it.each(['../escape.md', '/escape.md', 'widgets.txt'])(
    'rejects unsafe Markdown path %s',
    async (path) => {
      const { root, markdownRoot } = await fixture()
      await expect(
        writeSchemaSnapshot({
          snapshot,
          markdown: new Map([[path, 'escape\n']]),
          root,
          markdownRoot,
        }),
      ).rejects.toThrow(/Unsafe generated PostgreSQL schema Markdown path/)
      await expect(readFile(join(root, 'schema.json'))).rejects.toThrow(/ENOENT/)
    },
  )

  it.each([false, true])('requires an existing Markdown root (check=%s)', async (check) => {
    const { root, markdownRoot } = await fixture()
    await rm(markdownRoot, { recursive: true })
    await expect(
      writeSchemaSnapshot({ snapshot, markdown, root, markdownRoot, check }),
    ).rejects.toThrow(/Unsafe generated PostgreSQL schema snapshot path/)
  })

  it.each([false, true])(
    'validates a supplied root even for empty Markdown (check=%s)',
    async (check) => {
      const { root, markdownRoot } = await fixture()
      await rm(markdownRoot, { recursive: true })
      await expect(
        writeSchemaSnapshot({ snapshot, markdown: new Map(), root, markdownRoot, check }),
      ).rejects.toThrow(/Unsafe generated PostgreSQL schema snapshot path/)
      await expect(readFile(join(root, 'schema.json'))).rejects.toThrow(/ENOENT/)
    },
  )

  it.each(['root', 'component', 'leaf', 'json'] as const)(
    'rejects a symlinked %s in write and check modes',
    async (kind) => {
      const { base, root, markdownRoot } = await fixture()
      const sentinelRoot = join(base, 'sentinel')
      await mkdir(sentinelRoot)
      const sentinel = join(sentinelRoot, 'widgets.md')
      await writeFile(sentinel, 'keep sentinel\n')
      if (kind === 'root') {
        await rm(markdownRoot, { recursive: true })
        await symlink(sentinelRoot, markdownRoot)
      } else if (kind === 'component') {
        await symlink(sentinelRoot, join(markdownRoot, 'tables'))
      } else if (kind === 'leaf') {
        await mkdir(join(markdownRoot, 'tables'))
        await symlink(sentinel, join(markdownRoot, 'tables/widgets.md'))
      } else {
        await symlink(sentinel, join(root, 'schema.json'))
      }
      for (const check of [false, true]) {
        await expect(
          writeSchemaSnapshot({ snapshot, markdown, root, markdownRoot, check }),
        ).rejects.toThrow(/Unsafe generated PostgreSQL schema snapshot path/)
        await expect(readFile(sentinel, 'utf8')).resolves.toBe('keep sentinel\n')
      }
    },
  )

  it('passes actual JSON and Markdown output paths to the formatter', async () => {
    const { root, markdownRoot } = await fixture()
    const paths: string[] = []
    await writeSchemaSnapshot({
      snapshot,
      markdown,
      root,
      markdownRoot,
      format: async (path, raw) => {
        paths.push(path)
        return raw
      },
    })
    expect(paths.sort()).toEqual(
      [
        join(root, 'schema.json'),
        join(markdownRoot, 'README.md'),
        join(markdownRoot, 'tables/widgets.md'),
      ].sort(),
    )
  })
})
