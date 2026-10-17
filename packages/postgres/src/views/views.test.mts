import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { loadSqlParserModule } from '../migration-runner/sql-statements.mts'
import { useIsolatedDatabase } from '../test-helpers.mts'
import type { QueryExecutor } from '../types.mts'
import {
  buildDropViewStatement,
  buildDropViewsStatement,
  extractViewDeclarations,
  runViews,
  uniqueViewDeclarations,
} from './index.mts'

const withPsql = useIsolatedDatabase()
const folders: string[] = []

beforeAll(loadSqlParserModule)
afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})

function viewFolder(files: Record<string, string>): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'views-'))
  folders.push(folder)
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), sql)
  return folder
}

describe('extractViewDeclarations', () => {
  it('finds persistent views and materialized views, quoting only when required', () => {
    expect(
      extractViewDeclarations(`
        CREATE OR REPLACE VIEW public.a AS SELECT 1;
        CREATE MATERIALIZED VIEW IF NOT EXISTS "Mixed Case" AS SELECT 1;
        CREATE VIEW "user" AS SELECT 1;
        CREATE TEMP VIEW scratch AS SELECT 1;
        CREATE TABLE plain AS SELECT 1;
        CREATE INDEX a_idx ON plain (generate_series);
      `),
    ).toEqual([
      { type: 'view', name: '"public"."a"' },
      { type: 'materialized view', name: '"Mixed Case"' },
      { type: 'view', name: '"user"' },
    ])
  })

  it('ignores unparseable SQL and de-duplicates declarations', () => {
    expect(extractViewDeclarations('CREATE VIEW (')).toEqual([])
    expect(extractViewDeclarations('')).toEqual([])
    expect(extractViewDeclarations('-- only a comment')).toEqual([])
    const view = { type: 'view', name: 'a' } as const
    expect(uniqueViewDeclarations([view, view, { type: 'materialized view', name: 'a' }])).toEqual([
      view,
      { type: 'materialized view', name: 'a' },
    ])
  })
})

describe('buildDropViewsStatement', () => {
  it('returns null without declarations and an annotated DO block otherwise', () => {
    expect(buildDropViewsStatement([])).toBeNull()
    expect(buildDropViewStatement({ type: 'materialized view', name: 'mv' })).toBe(
      'DROP MATERIALIZED VIEW IF EXISTS mv;',
    )
    expect(buildDropViewsStatement([{ type: 'view', name: 'a' }])).toMatch(
      /^\/\* dropManagedViews \*\/ DO /u,
    )
  })
})

describe('runViews', () => {
  it('retries dependent views, rebuilds forcibly, and logs', async () => {
    const folder = viewFolder({
      'a_dependent.sql': 'CREATE OR REPLACE VIEW dependent AS SELECT id FROM base_view;',
      'b_base.sql': 'CREATE OR REPLACE VIEW base_view AS SELECT 1 AS id; /* trailing */',
      'ignored.txt': 'nope',
    })
    const logger = { error: vi.fn(), log: vi.fn() }
    await withPsql(async (psql) => {
      await runViews({ folder, writer: psql.write, logger })
      await runViews({ folder, writer: psql.write, forced: true, logger })
      const { rows } = await psql.write<{ id: number }>('/* read */ SELECT id FROM dependent')
      expect(rows).toEqual([{ id: 1 }])
    })
    expect(logger.log).toHaveBeenCalledWith('View %s updated!', 'a_dependent.sql')
    expect(logger.log).toHaveBeenCalledWith(
      'Forced view rebuild: dropped %d views before recreation',
      2,
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('runs each file atomically so a retried file does not repeat committed statements', async () => {
    const folder = viewFolder({
      'a_two.sql':
        'CREATE VIEW first_v AS SELECT 1 AS id; CREATE VIEW second_v AS SELECT id FROM dep_v;',
      'b_dep.sql': 'CREATE VIEW dep_v AS SELECT 2 AS id;',
    })
    await withPsql(async (psql) => {
      await runViews({
        folder,
        writer: psql.write,
        withTransaction: (handler) => psql.withTransaction(handler),
      })
      const { rows } = await psql.write<{ id: number }>('/* read */ SELECT id FROM second_v')
      expect(rows).toEqual([{ id: 2 }])
    })
  })

  it('fails on the first blocked pass when retries are disabled, naming the files', async () => {
    const folder = viewFolder({
      'a_dependent.sql': 'CREATE VIEW dependent AS SELECT id FROM base_view;',
      'b_base.sql': 'CREATE VIEW base_view AS SELECT 1 AS id;',
    })
    await withPsql(async (psql) => {
      await expect(runViews({ folder, writer: psql.write, retryBlocked: false })).rejects.toThrow(
        'Blocked views: a_dependent.sql',
      )
    })
  })

  it('does nothing for an empty or missing folder, silently by default', async () => {
    const writer = vi.fn()
    await runViews({ folder: path.join(os.tmpdir(), 'does-not-exist-views'), writer })
    await runViews({ folder: viewFolder({}), writer, forced: true })
    expect(writer).not.toHaveBeenCalled()
  })

  it('throws the last error when no pass makes progress', async () => {
    const folder = viewFolder({
      'broken.sql': 'CREATE VIEW broken AS SELECT * FROM missing_table;',
    })
    const logger = { error: vi.fn(), log: vi.fn() }
    await withPsql(async (psql) => {
      await expect(runViews({ folder, writer: psql.write, logger })).rejects.toThrow(
        'missing_table',
      )
    })
    expect(logger.error).toHaveBeenCalledWith(
      'ERROR: view recreation made no progress; blocked views: %s',
      'broken.sql',
    )
  })

  it('stays silent without a logger, including when views are blocked', async () => {
    const folder = viewFolder({ 'x.sql': 'CREATE VIEW x AS SELECT 1;' })
    await runViews({ folder, writer: vi.fn() as never })
    await runViews({ folder, writer: vi.fn() as never, forced: true })
    const failing = vi.fn(async () => {
      throw new Error('blocked')
    }) as unknown as QueryExecutor
    await expect(runViews({ folder, writer: failing })).rejects.toThrow('blocked')
  })

  it('wraps non-Error failures', async () => {
    const folder = viewFolder({ 'x.sql': 'CREATE VIEW x AS SELECT 1;' })
    const writer = vi.fn(async () => {
      throw 'plain failure'
    }) as unknown as QueryExecutor
    await expect(runViews({ folder, writer })).rejects.toThrow(
      'View recreation made no progress for: x.sql',
    )
  })

  it('reports blocked views when forced teardown cannot drop a dependency', async () => {
    await withPsql(async (psql) => {
      await psql.write('/* setup */ CREATE VIEW outside_dependency AS SELECT 1 AS id')
      await psql.write('/* setup */ CREATE VIEW blocker AS SELECT id FROM outside_dependency')
      const dropAll = buildDropViewsStatement([{ type: 'view', name: 'outside_dependency' }])!
      await expect(psql.write(dropAll)).rejects.toThrow(
        'Forced view teardown made no progress; blocked views: outside_dependency',
      )
    })
  })
})
