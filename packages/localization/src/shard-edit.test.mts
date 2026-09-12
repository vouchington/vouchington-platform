import { describe, expect, it } from 'vitest'
import {
  CatalogMergeConflict,
  catalogMessageFromRecord,
  mergeCatalogShards,
  removeCatalogLine,
  serializeCatalogShard,
  upsertCatalogLine,
} from './index.mts'

const home = catalogMessageFromRecord({
  id: 'nav.home',
  consumers: ['web'],
  descriptor: null,
  translations: { 'en-US': 'Home' },
})
const save = catalogMessageFromRecord({
  id: 'common.save',
  consumers: ['web'],
  translations: { 'en-US': 'Save' },
})
const cancel = catalogMessageFromRecord({
  id: 'common.cancel',
  consumers: ['web'],
  translations: { 'en-US': 'Cancel' },
})

describe('catalog shard line edits', () => {
  it('inserts, replaces, and removes lines without parsing the shard as JSON', () => {
    const empty = serializeCatalogShard([])
    const withSave = upsertCatalogLine(empty, JSON.stringify(save))
    const withBoth = upsertCatalogLine(withSave, JSON.stringify(home))
    expect(withBoth).toBe(serializeCatalogShard([save, home]))
    const replaced = upsertCatalogLine(
      withBoth,
      JSON.stringify({ ...save, translations: { 'en-US': 'Store' } }),
    )
    expect(replaced).toContain('"Store"')
    expect(removeCatalogLine(replaced, 'nav.home')).toContain('"id":"common.save"')
    expect(removeCatalogLine(replaced, 'nav.home')).not.toContain('nav.home')
    expect(() => removeCatalogLine(empty, 'nav.home')).toThrow(/does not contain/)
  })

  it('merges independent id edits and conflicts on the same line', () => {
    const ancestor = serializeCatalogShard([save])
    const ours = serializeCatalogShard([save, home])
    const theirs = upsertCatalogLine(ancestor, JSON.stringify(cancel))
    expect(mergeCatalogShards(ancestor, ours, theirs)).toBe(
      serializeCatalogShard([cancel, save, home]),
    )
    const oursEdit = upsertCatalogLine(
      ancestor,
      JSON.stringify({ ...save, translations: { 'en-US': 'Keep' } }),
    )
    const theirsEdit = upsertCatalogLine(
      ancestor,
      JSON.stringify({ ...save, translations: { 'en-US': 'Other' } }),
    )
    expect(() => mergeCatalogShards(ancestor, oursEdit, theirsEdit)).toThrow(CatalogMergeConflict)
    expect(mergeCatalogShards(ancestor, ours, ancestor)).toBe(ours)
    expect(mergeCatalogShards(ancestor, ancestor, theirs)).toBe(theirs)
    expect(mergeCatalogShards(ancestor, serializeCatalogShard([]), serializeCatalogShard([]))).toBe(
      '[]\n',
    )
    try {
      mergeCatalogShards(ancestor, oursEdit, theirsEdit)
      throw new Error('expected conflict')
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogMergeConflict)
      expect((error as CatalogMergeConflict).ids).toEqual(['common.save'])
    }
  })
})
