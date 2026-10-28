import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { getFilesFromFolder, readMigrationFile } from './files.mts'

describe('migration files', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  it('returns an empty list for a missing folder', () => {
    expect(getFilesFromFolder(join(tmpdir(), 'missing-migrations-folder'))).toEqual([])
  })

  it('lists sql and mts files and reads both', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-migrations-'))
    dirs.push(folder)
    await writeFile(join(folder, '.hidden.sql'), 'SELECT 1;')
    await writeFile(join(folder, 'readme.md'), 'nope')
    await writeFile(join(folder, 'types.d.mts'), 'export {}')
    await writeFile(join(folder, 'b.sql'), 'SELECT 2;')
    await writeFile(join(folder, 'a.sql'), 'SELECT 1;')
    await writeFile(join(folder, 'c.mts'), 'export default () => "SELECT 3;"\n')
    await mkdir(join(folder, 'nested'), { recursive: true })
    expect(getFilesFromFolder(folder)).toEqual(['a.sql', 'b.sql', 'c.mts'])
    await expect(readMigrationFile(folder, 'a.sql')).resolves.toBe('SELECT 1;')
    await expect(readMigrationFile(folder, 'c.mts')).resolves.toBe('SELECT 3;')
  })

  it('prefers preloaded mts modules over importing them by path', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-migrations-'))
    dirs.push(folder)
    await writeFile(join(folder, 'c.mts'), 'export default () => "SELECT 3;"\n')
    await writeFile(join(folder, 'd.mts'), 'export default () => "SELECT 4;"\n')
    const modules = { 'c.mts': { default: async () => 'SELECT preloaded;' } }
    await expect(readMigrationFile(folder, 'c.mts', modules)).resolves.toBe('SELECT preloaded;')
    await expect(readMigrationFile(folder, 'd.mts', modules)).resolves.toBe('SELECT 4;')
    // Only own keys count, so a prototype property never stands in for a migration
    await expect(readMigrationFile(folder, 'd.mts', Object.create({ 'd.mts': {} }))).resolves.toBe(
      'SELECT 4;',
    )
    await expect(readMigrationFile(folder, 'e.mts', { 'e.mts': { default: 1 } })).rejects.toThrow(
      'Expected a function',
    )
  })

  it('rejects unknown extensions and non-function mts defaults', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-migrations-'))
    dirs.push(folder)
    await writeFile(join(folder, 'bad.json'), '{}')
    await writeFile(join(folder, 'nope.mts'), 'export default 1\n')
    await expect(readMigrationFile(folder, 'bad.json')).rejects.toThrow('Unknown type of file')
    await expect(readMigrationFile(folder, 'nope.mts')).rejects.toThrow('Expected a function')
  })
})
