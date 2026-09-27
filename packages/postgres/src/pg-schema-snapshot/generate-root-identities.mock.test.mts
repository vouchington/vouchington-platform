import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { writeSchemaSnapshot } from './generate.mts'
import type { SchemaSnapshot } from './types.mts'

const aliases = vi.hoisted(() => new Map<string, string>())
vi.mock<typeof import('node:fs/promises')>(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal()
  function mappedPath(path: Parameters<typeof actual.lstat>[0]) {
    const value = String(path)
    for (const [alias, target] of aliases) {
      if (value === alias || value.startsWith(`${alias}/`))
        return target + value.slice(alias.length)
    }
    return path
  }
  return {
    ...actual,
    lstat: ((path, options) => actual.lstat(mappedPath(path), options)) as typeof actual.lstat,
    readdir: ((path, options) =>
      Reflect.apply(actual.readdir, undefined, [
        mappedPath(path),
        options,
      ])) as typeof actual.readdir,
  }
})
const roots: string[] = []
const snapshot: SchemaSnapshot = {
  formatVersion: 2,
  tables: {},
  views: {},
  enums: {},
  extensions: {},
  functions: {},
  policies: {},
}
afterEach(async () => {
  aliases.clear()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
it.each(['same', 'ancestor', 'reserved'])(
  'rejects a mount alias of the runtime %s before formatting or cleanup',
  async (kind) => {
    const base = await mkdtemp(join(tmpdir(), 'schema-directory-identities-'))
    roots.push(base)
    const root = join(base, 'runtime')
    const markdownRoot = join(base, 'mount')
    await Promise.all([mkdir(root), mkdir(markdownRoot)])
    await writeFile(join(root, 'schema.json'), 'keep runtime\n')
    await writeFile(join(markdownRoot, 'sentinel.txt'), 'keep mount\n')
    // Model a kernel mount alias: realpath strings differ, but directory dev/ino identity is shared.
    const reserved = join(root, 'schema.md')
    if (kind === 'reserved') await mkdir(reserved)
    aliases.set(
      await realpath(markdownRoot),
      kind === 'same' ? root : kind === 'ancestor' ? base : reserved,
    )
    for (const check of [false, true]) {
      let formatted = false
      await expect(
        writeSchemaSnapshot({
          snapshot,
          markdown: new Map([['README.md', '# Schema\n']]),
          root,
          markdownRoot,
          check,
          format: async (_path, raw) => {
            formatted = true
            return raw
          },
        }),
      ).rejects.toThrow(
        kind === 'reserved'
          ? 'Markdown output root must not overlap reserved snapshot paths'
          : 'Markdown output root must not contain the JSON snapshot root',
      )
      expect(formatted).toBe(false)
      await expect(readFile(join(root, 'schema.json'), 'utf8')).resolves.toBe('keep runtime\n')
      await expect(readFile(join(markdownRoot, 'sentinel.txt'), 'utf8')).resolves.toBe(
        'keep mount\n',
      )
    }
  },
)
it.each(['deep-runtime', 'cycle'])(
  'rejects %s identities inside the Markdown tree before touching either output',
  async (kind) => {
    const base = await mkdtemp(join(tmpdir(), 'schema-deep-identities-'))
    roots.push(base)
    const root = join(base, 'mount/runtime')
    const markdownRoot = join(base, 'docs')
    const nested = join(markdownRoot, 'nested/runtime')
    await Promise.all([mkdir(root, { recursive: true }), mkdir(nested, { recursive: true })])
    await writeFile(join(root, 'schema.json'), 'keep runtime\n')
    await writeFile(join(nested, 'notes.md'), 'keep nested\n')
    // A mounted descendant has no Markdown ancestor in its lexical runtime path.
    if (kind === 'deep-runtime') aliases.set(await realpath(root), nested)
    else aliases.set(await realpath(nested), markdownRoot)
    for (const check of [false, true]) {
      let formatted = false
      await expect(
        writeSchemaSnapshot({
          snapshot,
          markdown: new Map([['README.md', '# Schema\n']]),
          root,
          markdownRoot,
          check,
          format: async (_path, raw) => {
            formatted = true
            return raw
          },
        }),
      ).rejects.toThrow(
        kind === 'deep-runtime'
          ? 'Markdown output root must not contain the JSON snapshot root'
          : 'Markdown output tree must not contain directory aliases',
      )
      expect(formatted).toBe(false)
      await expect(readFile(join(root, 'schema.json'), 'utf8')).resolves.toBe('keep runtime\n')
      await expect(readFile(join(nested, 'notes.md'), 'utf8')).resolves.toBe('keep nested\n')
    }
  },
)
it.each(['file', 'symlink'])(
  'rejects a directory replaced by a %s during preflight before formatting',
  async (kind) => {
    const base = await mkdtemp(join(tmpdir(), 'schema-preflight-race-'))
    roots.push(base)
    const root = join(base, 'runtime')
    const markdownRoot = join(base, 'docs')
    const nested = join(markdownRoot, 'nested')
    await Promise.all([mkdir(root), mkdir(nested, { recursive: true })])
    const target = join(base, 'replacement')
    await writeFile(target, 'keep\n')
    const replacement = kind === 'file' ? target : join(base, 'link')
    if (kind === 'symlink') await symlink(target, replacement)
    // readdir saw a directory; the next lstat observes a replacement leaf.
    aliases.set(await realpath(nested), replacement)
    for (const check of [false, true]) {
      let formatted = false
      await expect(
        writeSchemaSnapshot({
          snapshot,
          markdown: new Map([['README.md', '# Schema\n']]),
          root,
          markdownRoot,
          check,
          format: async (_path, raw) => {
            formatted = true
            return raw
          },
        }),
      ).rejects.toThrow('Unsafe generated PostgreSQL schema snapshot path')
      expect(formatted).toBe(false)
      await expect(readFile(target, 'utf8')).resolves.toBe('keep\n')
      await expect(readFile(join(root, 'schema.json'))).rejects.toThrow(/ENOENT/)
    }
  },
)
