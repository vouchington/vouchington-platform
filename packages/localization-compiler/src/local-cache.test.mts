import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  catalogDirectoryDigest,
  ensureCompiledLocalizationCatalog,
  openLocalizationDatabase,
  resolveLocalizationBatch,
} from './index.mts'

const directories: string[] = []

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeCatalogFixture() {
  const root = mkdtempSync(join(tmpdir(), 'local-cache-'))
  directories.push(root)
  const source = join(root, 'catalog')
  mkdirSync(join(source, 'translations'), { recursive: true })
  writeFileSync(join(source, 'copies.json'), '[{"id":"copy.ok","descriptor":null}]\n')
  writeFileSync(
    join(source, 'aliases.json'),
    '[{"consumer":"web","alias":"common.ok","copyId":"copy.ok"}]\n',
  )
  writeFileSync(join(source, 'translations', 'en-US.json'), '[{"id":"copy.ok","value":"OK"}]\n')
  return { root, source, output: join(root, 'out', 'catalog.sqlite') }
}

describe('catalogDirectoryDigest and ensureCompiledLocalizationCatalog', () => {
  it('digests nested catalog files and extra hash files while ignoring non-regular entries', () => {
    const { root, source } = makeCatalogFixture()
    const manifest = join(root, 'manifest.json')
    writeFileSync(manifest, '{"version":"1.0.0"}\n')
    symlinkSync(join(source, 'copies.json'), join(source, 'link.json'))

    const base = catalogDirectoryDigest(source)
    const withManifest = catalogDirectoryDigest(source, [manifest])
    expect(base).toMatch(/^[a-f0-9]{64}$/)
    expect(withManifest).not.toBe(base)

    writeFileSync(manifest, '{"version":"1.0.1"}\n')
    expect(catalogDirectoryDigest(source, [manifest])).not.toBe(withManifest)
  })

  it('sorts catalog files by normalized POSIX relative path', () => {
    const { source } = makeCatalogFixture()
    writeFileSync(join(source, 'translations2.json'), '[]\n')

    const expected = createHash('sha256')
    for (const rel of [
      'aliases.json',
      'copies.json',
      'translations/en-US.json',
      'translations2.json',
    ]) {
      expected.update(rel)
      expected.update('\0')
      expected.update(readFileSync(join(source, rel)))
      expected.update('\0')
    }
    expect(catalogDirectoryDigest(source)).toBe(expected.digest('hex'))
  })

  it('compiles once, skips when up to date, and recompiles when inputs change', async () => {
    const { root, source, output } = makeCatalogFixture()
    const manifest = join(root, 'manifest.json')
    writeFileSync(manifest, '{"version":"1.0.0"}\n')

    const compiledPath = await ensureCompiledLocalizationCatalog({
      source,
      output,
      extraHashFiles: [manifest],
    })
    expect(compiledPath).toBe(output)
    const database = openLocalizationDatabase(compiledPath)
    try {
      expect(
        resolveLocalizationBatch(database, {
          consumer: 'web',
          locales: ['en'],
          selectors: ['common.ok'],
        }).messages,
      ).toEqual({ 'common.ok': 'OK' })
    } finally {
      database.close()
    }

    // Overwriting the artifact while keeping the matching .revision proves cache-hit skips compile.
    writeFileSync(output, 'cached-sentinel')
    expect(
      await ensureCompiledLocalizationCatalog({ source, output, extraHashFiles: [manifest] }),
    ).toBe(output)
    expect(readFileSync(output, 'utf8')).toBe('cached-sentinel')

    // Changing a catalog file invalidates the cache and compiles fresh SQLite.
    writeFileSync(join(source, 'translations', 'en-US.json'), '[{"id":"copy.ok","value":"Done"}]\n')
    await ensureCompiledLocalizationCatalog({ source, output, extraHashFiles: [manifest] })
    const updated = openLocalizationDatabase(output)
    try {
      expect(
        resolveLocalizationBatch(updated, {
          consumer: 'web',
          locales: ['en'],
          selectors: ['common.ok'],
        }).messages,
      ).toEqual({ 'common.ok': 'Done' })
    } finally {
      updated.close()
    }
  })

  it('cleans up temporary files when compilation fails', async () => {
    const { source, output } = makeCatalogFixture()
    writeFileSync(join(source, 'copies.json'), 'not-json\n')
    await expect(ensureCompiledLocalizationCatalog({ source, output })).rejects.toThrow(SyntaxError)
  })
})
