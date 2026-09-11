import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runLocalizationCli } from './index.mts'
import { sampleMessages, writeCatalog } from './test-helpers.mts'

const paths: string[] = []

afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('localization CLI', () => {
  it('compiles, inspects, resolves, and round-trips CSV', async () => {
    const source = writeCatalog({ 'nav.json': [sampleMessages()[0]] })
    paths.push(source)
    const root = mkdtempSync(join(tmpdir(), 'cli-'))
    paths.push(root)
    const db = join(root, 'catalog.sqlite')
    const written: string[] = []
    await runLocalizationCli(['compile', '--source', source, '--output', db], (value) =>
      written.push(value),
    )
    expect(written[0]).toMatch(/^[a-f0-9]{64}$/)
    written.length = 0
    await runLocalizationCli(['inspect', '--db', db], (value) => written.push(value))
    expect(written.join('\n')).toContain('"contract"')
    written.length = 0
    await runLocalizationCli(
      ['resolve', '--db', db, '--consumer', 'web', '--locales', 'en', '--selectors', 'nav.home'],
      (value) => written.push(value),
    )
    expect(written.join('')).toContain('Home')
    written.length = 0
    await runLocalizationCli(['csv-export', '--source', source], (value) => written.push(value))
    expect(written.join('')).toContain('nav.home')
    const csvPath = join(root, 'catalog.csv')
    await runLocalizationCli(['csv-export', '--source', source, '--output', csvPath], (value) =>
      written.push(value),
    )
    expect(readFileSync(csvPath, 'utf8')).toContain('nav.home')
    const imported = join(root, 'imported')
    await runLocalizationCli(['csv-import', '--input', csvPath, '--output', imported])
    expect(readFileSync(join(imported, 'imported.json'), 'utf8')).toContain('nav.home')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runLocalizationCli(['inspect', '--db', db])
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('prints usage for unknown commands and missing flags', async () => {
    await expect(runLocalizationCli(['nope'])).rejects.toThrow(/Usage/)
    await expect(runLocalizationCli(['compile'])).rejects.toThrow(/Usage/)
    await expect(runLocalizationCli(['inspect', '--db'])).rejects.toThrow(/Usage/)
  })
})
