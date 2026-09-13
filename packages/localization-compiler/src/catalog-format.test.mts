import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { serializeCatalogTable } from '@vouchington/localization'
import { checkCatalogDirectory, runLocalizationCli } from './index.mts'

const paths: string[] = []

afterEach(() => paths.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))

describe('catalog format check', () => {
  it('checks canonical source and leaves all catalog files unchanged', async () => {
    const root = writeNormalizedCatalog()
    const files = catalogFiles(root)
    const before = files.map((path) => readFileSync(path, 'utf8'))
    const written: string[] = []

    await expect(checkCatalogDirectory(root)).resolves.toBe(3)
    await runLocalizationCli(['format', '--check', '--source', root], (value) =>
      written.push(value),
    )

    expect(written).toEqual(['3 files'])
    expect(files.map((path) => readFileSync(path, 'utf8'))).toEqual(before)
  })

  it('reports the first noncanonical table without rewriting it', async () => {
    const root = writeNormalizedCatalog()
    const aliases = join(root, 'aliases.json')
    const stale = '[{"consumer":"web","alias":"web.save","copyId":"copy.save"}]\n'
    writeFileSync(aliases, stale)

    await expect(checkCatalogDirectory(root)).rejects.toThrow(
      /aliases\.json: Catalog is not canonical/,
    )
    expect(readFileSync(aliases, 'utf8')).toBe(stale)
  })

  it('validates canonical source semantics without formatting tags', async () => {
    const root = writeNormalizedCatalog()
    const aliases = join(root, 'aliases.json')
    const tags = join(root, 'tags.json')
    const tagText = '{"copy.save":["chrome"]}\n'
    writeFileSync(
      aliases,
      serializeCatalogTable([{ consumer: 'web', alias: 'web.save', copyId: 'copy.missing' }]),
    )
    writeFileSync(tags, tagText)

    await expect(checkCatalogDirectory(root)).rejects.toThrow(/targets missing copy/)
    expect(readFileSync(aliases, 'utf8')).toContain('copy.missing')
    expect(readFileSync(tags, 'utf8')).toBe(tagText)
  })
})

function writeNormalizedCatalog(): string {
  const root = mkdtempSync(join(tmpdir(), 'catalog-format-'))
  paths.push(root)
  mkdirSync(join(root, 'translations'))
  writeFileSync(
    join(root, 'copies.json'),
    serializeCatalogTable([{ id: 'copy.save', descriptor: null }]),
  )
  writeFileSync(
    join(root, 'aliases.json'),
    serializeCatalogTable([{ consumer: 'web', alias: 'web.save', copyId: 'copy.save' }]),
  )
  writeFileSync(
    join(root, 'translations', 'en-US.json'),
    serializeCatalogTable([{ id: 'copy.save', value: 'Save' }]),
  )
  return root
}

function catalogFiles(root: string): string[] {
  return [
    join(root, 'copies.json'),
    join(root, 'aliases.json'),
    join(root, 'translations', 'en-US.json'),
  ]
}
