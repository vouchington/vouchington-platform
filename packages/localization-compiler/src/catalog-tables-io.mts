import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { serializeCatalogTable, type LocalizationCatalog } from '@vouchington/localization'
import { loadCatalogDirectory } from './load.mts'

const MANAGED_TABLES = ['copies.json', 'aliases.json', 'translations'] as const

export type AuthoringCatalogTables = Pick<
  LocalizationCatalog,
  'copies' | 'aliases' | 'translations'
>

/**
 * Replaces the managed authoring tables (`copies.json`, `aliases.json`, `translations/`) in
 * `outputDirectory` atomically: stages and validates in a sibling directory, parks existing tables
 * in a backup directory, promotes the staged tables, and rolls back if promotion fails. Unmanaged
 * files such as `routes.json` and `tags.json` are left untouched.
 */
export async function writeCatalogTablesAtomically(
  outputDirectory: string,
  catalog: AuthoringCatalogTables,
): Promise<void> {
  const output = resolve(outputDirectory)
  const copies = serializeCatalogTable(catalog.copies)
  const aliases = serializeCatalogTable(catalog.aliases)
  const locales = Object.entries(catalog.translations).map(
    ([locale, rows]) => [locale, serializeCatalogTable(rows)] as const,
  )
  mkdirSync(dirname(output), { recursive: true })
  const staging = mkdtempSync(join(dirname(output), `${basename(output)}.csv-import-`))
  let backup: string | undefined
  let retainBackup = false
  let failed: unknown
  try {
    mkdirSync(join(staging, 'translations'))
    writeFileSync(join(staging, 'copies.json'), copies)
    writeFileSync(join(staging, 'aliases.json'), aliases)
    for (const [locale, body] of locales) {
      writeFileSync(join(staging, 'translations', `${locale}.json`), body)
    }
    await loadCatalogDirectory(staging)
    backup = mkdtempSync(join(dirname(output), `${basename(output)}.csv-import-backup-`))
    const parked: string[] = []
    const promoted: string[] = []
    try {
      for (const name of MANAGED_TABLES) {
        const current = join(output, name)
        if (existsSync(current)) {
          renameSync(current, join(backup, name))
          parked.push(name)
        }
      }
      mkdirSync(output, { recursive: true })
      for (const name of MANAGED_TABLES) {
        renameSync(join(staging, name), join(output, name))
        promoted.push(name)
      }
    } catch (error) {
      try {
        for (const name of promoted) rmSync(join(output, name), { recursive: true, force: true })
        for (const name of parked) renameSync(join(backup, name), join(output, name))
      } catch {
        retainBackup = true
      }
      throw error
    }
  } catch (error) {
    failed = error
  } finally {
    try {
      rmSync(staging, { recursive: true, force: true })
      if (backup !== undefined && !retainBackup) rmSync(backup, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup of staging/backup directories; never mask commit or primary error.
    }
  }
  if (failed instanceof Error) throw failed
  if (failed !== undefined) throw new Error('Catalog import failed', { cause: failed })
}
