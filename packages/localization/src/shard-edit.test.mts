import { describe, expect, it } from 'vitest'
import {
  catalogMessageFromRecord,
  removeCatalogLine,
  serializeCatalogLine,
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
    expect(upsertCatalogLine(withSave, JSON.stringify(cancel))).toBe(
      serializeCatalogShard([cancel, save]),
    )
    const unsorted = `[\n${serializeCatalogLine(home)},\n${serializeCatalogLine(save)}\n]\n`
    expect(upsertCatalogLine(unsorted, JSON.stringify(cancel))).toBe(
      serializeCatalogShard([cancel, save, home]),
    )
    expect(() => removeCatalogLine(empty, 'nav.home')).toThrow(/does not contain/)
  })
})
