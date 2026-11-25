import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeCatalogTablesAtomically } from './index.mts'

const directories: string[] = []

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const validCatalog = {
  copies: [{ id: 'copy.ok', descriptor: null }],
  aliases: [{ consumer: 'web' as const, alias: 'common.ok', copyId: 'copy.ok' }],
  translations: {
    'en-US': [{ id: 'copy.ok', value: 'OK' }],
  },
}

describe('writeCatalogTablesAtomically', () => {
  it('writes tables into a new directory and atomically replaces existing ones', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tables-io-'))
    directories.push(root)
    const target = join(root, 'catalog')

    await writeCatalogTablesAtomically(target, validCatalog)
    expect(readFileSync(join(target, 'copies.json'), 'utf8')).toContain('copy.ok')

    writeFileSync(join(target, 'tags.json'), '{"copy.ok":["chrome"]}\n')
    writeFileSync(join(target, 'translations', 'fr.json'), '[{"id":"copy.ok","value":"D"}]\n')

    await writeCatalogTablesAtomically(target, {
      ...validCatalog,
      translations: {
        'en-US': [{ id: 'copy.ok', value: 'Confirmed' }],
      },
    })

    expect(readFileSync(join(target, 'translations', 'en-US.json'), 'utf8')).toContain('Confirmed')
    expect(existsSync(join(target, 'translations', 'fr.json'))).toBe(false)
    expect(readFileSync(join(target, 'tags.json'), 'utf8')).toBe('{"copy.ok":["chrome"]}\n')
  })

  it('leaves existing tables untouched when staged validation fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tables-io-invalid-'))
    directories.push(root)
    const target = join(root, 'catalog')
    mkdirSync(join(target, 'translations'), { recursive: true })
    writeFileSync(join(target, 'copies.json'), '[{"id":"copy.ok","descriptor":null}]\n')

    await expect(
      writeCatalogTablesAtomically(target, {
        ...validCatalog,
        translations: { es: [{ id: 'copy.ok', value: 'Vale' }] },
      }),
    ).rejects.toThrow(/missing en-US/)

    expect(readFileSync(join(target, 'copies.json'), 'utf8')).toContain('copy.ok')
  })
})
