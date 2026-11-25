import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fsHooks = vi.hoisted(() => ({
  onRename: undefined as ((from: string, to: string) => void) | undefined,
  onRm: undefined as ((path: string) => void) | undefined,
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    renameSync(from: string, to: string) {
      fsHooks.onRename?.(from, to)
      return actual.renameSync(from, to)
    },
    rmSync(path: string, options?: Parameters<typeof actual.rmSync>[1]) {
      fsHooks.onRm?.(path)
      return actual.rmSync(path, options)
    },
  }
})

const { writeCatalogTablesAtomically } = await import('./catalog-tables-io.mts')

const directories: string[] = []

afterEach(() => {
  fsHooks.onRename = undefined
  fsHooks.onRm = undefined
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const catalog = {
  copies: [{ id: 'copy.ok', descriptor: null }],
  aliases: [{ consumer: 'web' as const, alias: 'common.ok', copyId: 'copy.ok' }],
  translations: { 'en-US': [{ id: 'copy.ok', value: 'New' }] },
}

function makeExistingTarget() {
  const root = mkdtempSync(join(tmpdir(), 'tables-io-mock-'))
  directories.push(root)
  const target = join(root, 'catalog')
  mkdirSync(join(target, 'translations'), { recursive: true })
  writeFileSync(join(target, 'copies.json'), '[{"id":"copy.ok","descriptor":null}]\n')
  writeFileSync(
    join(target, 'aliases.json'),
    '[{"consumer":"web","alias":"common.ok","copyId":"copy.ok"}]\n',
  )
  writeFileSync(join(target, 'translations', 'en-US.json'), '[{"id":"copy.ok","value":"Old"}]\n')
  return { root, target }
}

describe('writeCatalogTablesAtomically rollback and error handling', () => {
  it('rolls back parked tables when promotion fails midway', async () => {
    const { target } = makeExistingTarget()
    fsHooks.onRename = (from, to) => {
      if (
        from.includes('.csv-import-') &&
        !from.includes('.csv-import-backup-') &&
        to.endsWith('aliases.json')
      ) {
        throw new Error('promote failed')
      }
    }

    await expect(writeCatalogTablesAtomically(target, catalog)).rejects.toThrow('promote failed')
    expect(readFileSync(join(target, 'translations', 'en-US.json'), 'utf8')).toContain('Old')
  })

  it('retains the backup directory when rollback itself fails and wraps non-Error throws', async () => {
    const { root, target } = makeExistingTarget()
    fsHooks.onRename = (from, to) => {
      if (
        from.includes('.csv-import-') &&
        !from.includes('.csv-import-backup-') &&
        to.endsWith('copies.json')
      ) {
        throw 'non-error-failure'
      }
      if (from.includes('.csv-import-backup-')) {
        throw new Error('rollback failed')
      }
    }

    await expect(writeCatalogTablesAtomically(target, catalog)).rejects.toThrow(
      'Catalog import failed',
    )
    const backups = readdirSync(root).filter((name) => name.includes('.csv-import-backup-'))
    expect(backups).toHaveLength(1)
    expect(existsSync(join(root, backups[0]!, 'copies.json'))).toBe(true)
  })

  it('ignores cleanup errors after commit succeeds and preserves primary error on failure', async () => {
    const { target } = makeExistingTarget()
    fsHooks.onRm = (path) => {
      if (path.includes('.csv-import-')) throw new Error('cleanup failed')
    }

    await expect(writeCatalogTablesAtomically(target, catalog)).resolves.toBeUndefined()
    expect(readFileSync(join(target, 'translations', 'en-US.json'), 'utf8')).toContain('New')

    fsHooks.onRename = (from) => {
      if (from.includes('.csv-import-') && !from.includes('.csv-import-backup-')) {
        throw new Error('primary promote failed')
      }
    }
    await expect(writeCatalogTablesAtomically(target, catalog)).rejects.toThrow(
      'primary promote failed',
    )
  })
})
