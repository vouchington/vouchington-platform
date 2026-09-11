import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { serializeLocalizationBatch, type LocalizationConsumer } from '@vouchington/localization'
import { compileLocalizationSqlite, writeJsonCatalog } from './compile.mts'
import { exportLocalizationCsv, importLocalizationCsv } from './csv.mts'
import { loadCatalogDirectory } from './load.mts'
import { openLocalizationDatabase, type LocalizationDatabase } from './open.mts'
import { explainLocalizationPlan, resolveLocalizationBatch } from './resolve.mts'

export async function runLocalizationCli(
  argv: readonly string[],
  write: (value: string) => void = console.log,
): Promise<void> {
  const [command, ...rest] = argv
  if (command === 'compile') {
    const loaded = await loadCatalogDirectory(required(rest, '--source'))
    write(compileLocalizationSqlite(loaded.messages, required(rest, '--output'), loaded.tags))
    return
  }
  if (command === 'resolve') {
    withDatabase(required(rest, '--db'), (database) => {
      write(
        serializeLocalizationBatch(
          resolveLocalizationBatch(database, {
            consumer: required(rest, '--consumer') as LocalizationConsumer,
            locales: required(rest, '--locales').split(','),
            selectors: required(rest, '--selectors').split(','),
          }),
        ),
      )
    })
    return
  }
  if (command === 'inspect') {
    withDatabase(required(rest, '--db'), (database) => {
      write(JSON.stringify({ contract: database.contract, revision: database.revision }, null, 2))
      write(explainLocalizationPlan(database, { kind: 'prefix', prefix: 'nav' }))
    })
    return
  }
  if (command === 'csv-export') {
    const csv = exportLocalizationCsv(
      (await loadCatalogDirectory(required(rest, '--source'))).messages,
    )
    const output = optional(rest, '--output')
    if (output === undefined) write(csv)
    else writeFileSync(output, csv)
    return
  }
  if (command === 'csv-import') {
    const output = required(rest, '--output')
    mkdirSync(output, { recursive: true })
    writeJsonCatalog(
      importLocalizationCsv(await readFile(required(rest, '--input'), 'utf8')),
      resolve(output, 'imported.json'),
    )
    return
  }
  throw new TypeError(usage())
}

function withDatabase(path: string, run: (database: LocalizationDatabase) => void): void {
  const database = openLocalizationDatabase(path)
  try {
    run(database)
  } finally {
    database.close()
  }
}

function required(args: readonly string[], flag: string): string {
  const value = optional(args, flag)
  if (value === undefined) throw new TypeError(usage())
  return value
}

function optional(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  const value = index === -1 ? undefined : args[index + 1]
  return value === undefined || value.startsWith('--') ? undefined : value
}

function usage(): string {
  return [
    'Usage: vouchington-localization compile --source <dir> --output <file>',
    'Usage: vouchington-localization resolve --db <file> --consumer <name> --locales <list> --selectors <list>',
    'Usage: vouchington-localization inspect --db <file>',
    'Usage: vouchington-localization csv-export --source <dir> [--output <file>]',
    'Usage: vouchington-localization csv-import --input <file> --output <dir>',
  ].join('\n')
}
