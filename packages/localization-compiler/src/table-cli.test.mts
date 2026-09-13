import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CatalogMergeConflict } from '@vouchington/localization'
import {
  isTablePath,
  mergeTableFiles,
  readTable,
  removeTable,
  resolveTableConflict,
  upsertTable,
} from './table-cli.mts'

const paths: string[] = []
afterEach(() => paths.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))

describe('catalog table CLI', () => {
  it('upserts, removes, and recognizes row tables', () => {
    const root = mkdtempSync(join(tmpdir(), 'catalog-table-'))
    paths.push(root)
    const aliases = join(root, 'aliases.json')
    upsertTable(aliases, '{"consumer":"web","alias":"web.nav.save","copyId":"copy.save"}')
    upsertTable(aliases, '{"consumer":"web","alias":"web.nav.save","copyId":"copy.save2"}')
    expect(readTable(aliases)).toEqual([
      { consumer: 'web', alias: 'web.nav.save', copyId: 'copy.save2' },
    ])
    removeTable(aliases, 'web.nav.save', 'web')
    expect(readTable(aliases)).toEqual([])
    expect(() => removeTable(aliases, 'missing.id', 'web')).toThrow(/does not contain/)
    expect(isTablePath(join(root, 'copies.json'))).toBe(true)
    expect(isTablePath(join(root, 'translations', 'es.json'))).toBe(true)
    expect(isTablePath(join(root, 'legacy.json'))).toBe(false)
  })

  it('merges independent rows and leaves deterministic conflict markers', () => {
    const root = mkdtempSync(join(tmpdir(), 'catalog-merge-'))
    paths.push(root)
    const base = join(root, 'base.json')
    const ours = join(root, 'ours.json')
    const theirs = join(root, 'theirs.json')
    writeFileSync(base, '[]\n')
    writeFileSync(ours, '[{"id":"copy.a","descriptor":null}]\n')
    writeFileSync(theirs, '[{"id":"copy.b","descriptor":null}]\n')
    mergeTableFiles(base, ours, theirs)
    expect(readTable(ours)).toHaveLength(2)
    writeFileSync(base, '[{"id":"copy.a","descriptor":null}]\n')
    writeFileSync(
      ours,
      '[{"id":"copy.a","descriptor":{"kind":"plural","valueParameter":"n"}},{"id":"copy.b","descriptor":null}]\n',
    )
    writeFileSync(
      theirs,
      '[{"id":"copy.a","descriptor":{"kind":"plural","valueParameter":"count"}}]\n',
    )
    expect(() => mergeTableFiles(base, ours, theirs)).toThrow(CatalogMergeConflict)
    expect(readFileSync(ours, 'utf8')).toContain('<<<<<<< ours')
    expect(readFileSync(ours, 'utf8')).toContain('copy.b')
    resolveTableConflict(ours, 'copy.a', undefined, undefined, 'ours')
    expect(readTable(ours)).toEqual([
      { id: 'copy.a', descriptor: { kind: 'plural', valueParameter: 'n' } },
      { id: 'copy.b', descriptor: null },
    ])
  })

  it('handles deletion merges and rejects malformed tables', () => {
    const root = mkdtempSync(join(tmpdir(), 'catalog-delete-'))
    paths.push(root)
    const base = join(root, 'base.json')
    const ours = join(root, 'ours.json')
    const theirs = join(root, 'theirs.json')
    writeFileSync(base, '[{"id":"copy.a","descriptor":null}]\n')
    writeFileSync(ours, '[]\n')
    writeFileSync(theirs, '[{"id":"copy.a","descriptor":null}]\n')
    mergeTableFiles(base, ours, theirs)
    expect(readTable(ours)).toEqual([])
    writeFileSync(ours, '[]\n')
    writeFileSync(theirs, '[{"id":"copy.a","descriptor":{"kind":"plural","valueParameter":"n"}}]\n')
    expect(() => mergeTableFiles(base, ours, theirs)).toThrow(CatalogMergeConflict)
    expect(readFileSync(ours, 'utf8')).not.toContain('undefined')
    resolveTableConflict(ours, 'copy.a', undefined, undefined, 'ours')
    expect(readTable(ours)).toEqual([])
    writeFileSync(ours, '[{"id":"copy.a","descriptor":{"kind":"plural","valueParameter":"n"}}]\n')
    writeFileSync(theirs, '[]\n')
    expect(() => mergeTableFiles(base, ours, theirs)).toThrow(CatalogMergeConflict)
    expect(readFileSync(ours, 'utf8')).toContain('>>>>>>> theirs')
    writeFileSync(ours, '[{"id":"copy.a","descriptor":null}]\n')
    writeFileSync(theirs, '[{"id":"copy.a","descriptor":{"kind":"plural","valueParameter":"n"}}]\n')
    mergeTableFiles(base, ours, theirs)
    expect(readTable(ours)[0]).toMatchObject({ descriptor: { kind: 'plural' } })
    writeFileSync(ours, '[{"id":"copy.a","descriptor":{"kind":"plural","valueParameter":"n"}}]\n')
    writeFileSync(theirs, '[{"id":"copy.a","descriptor":{"kind":"plural","valueParameter":"n"}}]\n')
    mergeTableFiles(base, ours, theirs)
    writeFileSync(base, '{}\n')
    expect(() => readTable(base)).toThrow(/must be a JSON array/)
  })

  it('keeps unresolved row conflicts while resolving an alias by consumer', () => {
    const root = mkdtempSync(join(tmpdir(), 'catalog-conflict-'))
    paths.push(root)
    const base = join(root, 'base.json')
    const ours = join(root, 'ours.json')
    const theirs = join(root, 'theirs.json')
    writeFileSync(
      base,
      '[{"consumer":"web","selectorId":"route.a","alias":"web.a","copyId":"copy.a"},{"consumer":"web","selectorId":"route.b","alias":"web.b","copyId":"copy.b"}]\n',
    )
    writeFileSync(
      ours,
      '[{"consumer":"web","selectorId":"route.a","alias":"web.a","copyId":"copy.a-ours"},{"consumer":"web","selectorId":"route.b","alias":"web.b","copyId":"copy.b-ours"}]\n',
    )
    writeFileSync(
      theirs,
      '[{"consumer":"web","selectorId":"route.a","alias":"web.a","copyId":"copy.a-theirs"},{"consumer":"web","selectorId":"route.b","alias":"web.b","copyId":"copy.b-theirs"}]\n',
    )
    expect(() => mergeTableFiles(base, ours, theirs)).toThrow(CatalogMergeConflict)
    expect(() => resolveTableConflict(ours, 'missing', 'web', undefined, 'ours')).toThrow(
      /does not uniquely match/,
    )
    resolveTableConflict(ours, 'web.a', 'web', 'route.a', 'ours')
    expect(readFileSync(ours, 'utf8')).toContain('web.b')
    expect(readFileSync(ours, 'utf8')).toContain('<<<<<<< ours')
    resolveTableConflict(ours, 'web.b', 'web', 'route.b', 'theirs')
    expect(readTable(ours)).toEqual([
      { consumer: 'web', selectorId: 'route.a', alias: 'web.a', copyId: 'copy.a-ours' },
      { consumer: 'web', selectorId: 'route.b', alias: 'web.b', copyId: 'copy.b-theirs' },
    ])
  })
})
