import { describe, expect, it } from 'vitest'

import { useIsolatedDatabase } from '../test-helpers.mts'
import { buildCatalogGuardedDoBlock, buildConstraintAddAndValidateSql } from './index.mts'

const withPsql = useIsolatedDatabase()

describe('catalog-guarded DDL', () => {
  it('renders annotated blocks, with and without serialization locks', () => {
    const plain = buildCatalogGuardedDoBlock('IF EXISTS', [], ['    SELECT 1'], ['    SELECT 2;'])
    expect(plain).toBe(
      '/* buildCatalogGuardedDoBlock */\nDO $$ BEGIN\n  IF EXISTS (\n    SELECT 1\n  ) THEN\n    SELECT 2;\n  END IF;\nEND $$;',
    )
    const locked = buildCatalogGuardedDoBlock(
      'IF NOT EXISTS',
      ['LOCK TABLE a;'],
      ['    SELECT 1'],
      ['    SELECT 2;'],
      'custom',
    )
    expect(locked.startsWith('/* custom */\nDO $$ BEGIN')).toBe(true)
    expect(locked.indexOf('LOCK TABLE a;')).toBeLessThan(locked.lastIndexOf('IF NOT EXISTS'))
  })

  it('rejects unsafe identifiers', () => {
    expect(() => buildConstraintAddAndValidateSql('a', "x'", 'CHECK (true)')).toThrow('Unsafe')
    expect(() => buildConstraintAddAndValidateSql('a', 'x', 'CHECK (true)', 'b;')).toThrow('Unsafe')
  })

  it('adds and validates a constraint idempotently', async () => {
    await withPsql(async (psql) => {
      await psql.write('/* setup */ CREATE TABLE parents (id int PRIMARY KEY)')
      await psql.write('/* setup */ CREATE TABLE kids (id int, parent_id int)')
      await psql.write('/* seed */ INSERT INTO parents VALUES (1)')
      await psql.write('/* seed */ INSERT INTO kids VALUES (1, 1)')
      const fk = buildConstraintAddAndValidateSql(
        'kids',
        'kids_parent_fk',
        'FOREIGN KEY (parent_id) REFERENCES parents (id)',
        'parents',
      )
      const check = buildConstraintAddAndValidateSql('kids', 'kids_id_check', 'CHECK (id > 0)')
      expect(fk).toHaveLength(2)
      expect(check[0]).not.toContain('LOCK TABLE parents')
      for (let pass = 0; pass < 2; pass++) {
        for (const statement of [...fk, ...check]) await psql.write(statement)
      }
      const { rows } = await psql.write<{ conname: string; convalidated: boolean }>(
        `/* read */ SELECT conname, convalidated FROM pg_constraint
          WHERE conrelid = 'kids'::regclass ORDER BY 1`,
      )
      expect(rows).toEqual([
        { conname: 'kids_id_check', convalidated: true },
        { conname: 'kids_parent_fk', convalidated: true },
      ])
    })
  })
})
