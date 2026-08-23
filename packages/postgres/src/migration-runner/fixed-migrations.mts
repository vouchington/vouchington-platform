import type pg from 'pg'

import type { PsqlRuntime } from '../types.mts'
import { getFilesFromFolder, readMigrationFile } from './files.mts'
import { assertMigrationChecksumMatches, computeMigrationChecksum } from './migration-checksum.mts'
import { silentMigrationLogger, type MigrationLogger } from './migration-logger.mts'
import { prepareMigration } from './migration-mode.mts'
import { resolveMigrationTimeouts, type MigrationTimeouts } from './migration-options.mts'
import { executePreparedMigration, withMigrationRunnerSession } from './migration-session.mts'
import { loadSqlParserModule } from './sql-statements.mts'

export interface RunMigrationsOptions extends Partial<MigrationTimeouts> {
  client?: pg.PoolClient
  logger?: MigrationLogger
}

const DEFAULT_EXTENSIONS = ['pgcrypto'] as const

export function createMigrationRunner(
  runtime: PsqlRuntime,
  extensions: readonly string[] = DEFAULT_EXTENSIONS,
) {
  return async function runMigrations(
    migrationsFolder: string,
    loggerOrOptions: MigrationLogger | RunMigrationsOptions = silentMigrationLogger,
  ): Promise<void> {
    await loadSqlParserModule()
    const options: RunMigrationsOptions =
      'log' in loggerOrOptions ? { logger: loggerOrOptions } : loggerOrOptions
    const logger = options.logger ?? silentMigrationLogger
    const debugMigrations = runtime.env.DEBUG_MIGRATIONS === 'true'
    const isTest = runtime.env.NODE_ENV === 'test'
    const migrations = getFilesFromFolder(migrationsFolder)

    if (debugMigrations && !isTest) {
      logger.log('DEBUG: Found %d migrations in %s', migrations.length, migrationsFolder)
      logger.log('DEBUG: Migration files:', migrations.slice(0, 5))
    }

    const runWithClient = async (client: pg.PoolClient): Promise<void> => {
      await client.query(buildMigrationSetupCommand(extensions))
      const { rows: existingMigrations } = await client.query<{
        id: string
        checksum: string | null
      }>('/* runMigrations */ SELECT id, checksum FROM migrations')
      const ledger = new Map(existingMigrations.map((row) => [row.id, row.checksum]))

      for (const migration of migrations) {
        const sql = await readMigrationFile(migrationsFolder, migration)
        const checksum = computeMigrationChecksum(sql)
        if (ledger.has(migration)) {
          const recorded = ledger.get(migration) ?? null
          assertMigrationChecksumMatches(migration, recorded, checksum)
          if (recorded === null) {
            await client.query(
              '/* runMigrations */ UPDATE migrations SET checksum = $1 WHERE id = $2',
              [checksum, migration],
            )
          }
          if (debugMigrations && !isTest) {
            logger.log('DEBUG: Skipping already-run migration: %s', migration)
          }
          continue
        }

        try {
          await executePreparedMigration(client, migration, prepareMigration(sql), checksum)
          ledger.set(migration, checksum)
          if (!isTest) logger.log('Migration %s complete!', migration)
        } catch (err) {
          logger.error('ERROR: running migration %s failed!', migration)
          logger.error(sql)
          throw err
        }
      }
    }

    if (options.client) await runWithClient(options.client)
    else {
      await withMigrationRunnerSession(runtime, resolveMigrationTimeouts(options), runWithClient)
    }

    if (debugMigrations && !isTest) logger.log('DEBUG: All migrations complete')
  }
}

function buildMigrationSetupCommand(extensions: readonly string[]): string {
  const extensionSql = extensions
    .map((extension) => `CREATE EXTENSION IF NOT EXISTS ${extension};`)
    .join('\n')
  return `${extensionSql}
CREATE TABLE IF NOT EXISTS migrations (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checksum TEXT,
  CHECK (char_length(id) <= 255),
  CHECK (id = TRIM(id)),
  CHECK (id = LOWER(id))
);
ALTER TABLE migrations ADD COLUMN IF NOT EXISTS checksum TEXT;`
}
