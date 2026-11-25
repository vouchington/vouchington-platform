import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path')
  return {
    ...actual,
    relative(from: string, to: string) {
      return actual.relative(from, to).replaceAll('/', '\\')
    },
  }
})

const { catalogDirectoryDigest } = await import('./local-cache.mts')

const directories: string[] = []

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('catalogDirectoryDigest cross-platform sorting', () => {
  it('sorts by normalized POSIX relative path even when node:path.relative uses backslashes', () => {
    const root = mkdtempSync(join(tmpdir(), 'local-cache-win-'))
    directories.push(root)
    mkdirSync(join(root, 'translations'), { recursive: true })
    writeFileSync(join(root, 'translations', 'en-US.json'), '[{"id":"a","value":"A"}]\n')
    writeFileSync(join(root, 'translations2.json'), '[]\n')

    const expected = createHash('sha256')
    for (const rel of ['translations/en-US.json', 'translations2.json']) {
      expected.update(rel)
      expected.update('\0')
      expected.update(readFileSync(join(root, rel)))
      expected.update('\0')
    }
    expect(catalogDirectoryDigest(root)).toBe(expected.digest('hex'))
  })
})
