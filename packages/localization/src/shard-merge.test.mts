import { describe, expect, it } from 'vitest'
import {
  CatalogMergeConflict,
  catalogMessageFromRecord,
  mergeCatalogShards,
  serializeCatalogLine,
  serializeCatalogShard,
  type CatalogMessage,
} from './index.mts'

const save = catalogMessageFromRecord({
  id: 'common.save',
  consumers: ['web'],
  translations: { 'en-US': 'Save' },
})
const home = catalogMessageFromRecord({
  id: 'nav.home',
  consumers: ['web'],
  descriptor: null,
  translations: { 'en-US': 'Home' },
})
const cancel = catalogMessageFromRecord({
  id: 'common.cancel',
  consumers: ['web'],
  translations: { 'en-US': 'Cancel' },
})
const plural = catalogMessageFromRecord({
  id: 'settings.count',
  consumers: ['web'],
  descriptor: { kind: 'plural', valueParameter: 'count' },
  translations: { 'en-US': { one: '{count} item', other: '{count} items' } },
})

function shard(messages: readonly CatalogMessage[]): string {
  return serializeCatalogShard(messages)
}

function message(
  base: CatalogMessage,
  patch: Partial<Pick<CatalogMessage, 'consumers' | 'descriptor' | 'translations'>>,
): CatalogMessage {
  return catalogMessageFromRecord({ ...base, ...patch })
}

describe('catalog shard three-way merge', () => {
  it('merges independent message ids and takes one-sided edits', () => {
    const ancestor = shard([save])
    const ours = shard([save, home])
    const theirs = shard([cancel, save])
    expect(mergeCatalogShards(ancestor, ours, theirs)).toBe(shard([cancel, save, home]))
    expect(mergeCatalogShards(ancestor, ours, ancestor)).toBe(ours)
    expect(mergeCatalogShards(ancestor, ancestor, theirs)).toBe(theirs)
    expect(mergeCatalogShards(ancestor, shard([]), shard([]))).toBe('[]\n')
    expect(mergeCatalogShards(ancestor, shard([]), ancestor)).toBe('[]\n')
  })

  it('merges es and fr added on the same id and conflicts when both edit the same locale', () => {
    const ancestor = shard([save])
    expect(
      mergeCatalogShards(
        ancestor,
        shard([message(save, { translations: { 'en-US': 'Save', es: 'Guardar' } })]),
        shard([message(save, { translations: { 'en-US': 'Save', fr: 'Enregistrer' } })]),
      ),
    ).toBe(
      shard([
        message(save, { translations: { 'en-US': 'Save', es: 'Guardar', fr: 'Enregistrer' } }),
      ]),
    )
    const oursLocale = shard([message(save, { translations: { 'en-US': 'Keep' } })])
    const theirsLocale = shard([message(save, { translations: { 'en-US': 'Other' } })])
    expect(() => mergeCatalogShards(ancestor, oursLocale, theirsLocale)).toThrow(
      CatalogMergeConflict,
    )
    try {
      mergeCatalogShards(ancestor, oursLocale, theirsLocale)
      throw new Error('expected conflict')
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogMergeConflict)
      expect((error as CatalogMergeConflict).ids).toEqual(['common.save'])
      expect((error as CatalogMergeConflict).text).toContain('<<<<<<< ours')
      expect((error as CatalogMergeConflict).text).toContain('"Keep"')
      expect((error as CatalogMergeConflict).text).toContain('"Other"')
    }
  })

  it('merges a source-locale edit with a new locale and unions consumers', () => {
    const ancestor = shard([save])
    expect(
      mergeCatalogShards(
        ancestor,
        shard([message(save, { translations: { 'en-US': 'Keep' } })]),
        shard([message(save, { translations: { 'en-US': 'Save', es: 'Guardar' } })]),
      ),
    ).toBe(shard([message(save, { translations: { 'en-US': 'Keep', es: 'Guardar' } })]))
    expect(
      mergeCatalogShards(
        ancestor,
        shard([message(save, { consumers: ['web', 'swift'] })]),
        shard([message(save, { translations: { 'en-US': 'Save', es: 'Guardar' } })]),
      ),
    ).toBe(
      shard([
        message(save, {
          consumers: ['web', 'swift'],
          translations: { 'en-US': 'Save', es: 'Guardar' },
        }),
      ]),
    )
    expect(
      mergeCatalogShards(
        shard([message(save, { translations: { 'en-US': 'Save', es: 'Guardar' } })]),
        shard([message(save, { translations: { 'en-US': 'Save', fr: 'Enregistrer' } })]),
        shard([
          message(save, { translations: { 'en-US': 'Save', es: 'Guardar', de: 'Speichern' } }),
        ]),
      ),
    ).toBe(
      shard([
        message(save, { translations: { 'en-US': 'Save', de: 'Speichern', fr: 'Enregistrer' } }),
      ]),
    )
  })

  it('merges independently added ids and conflicts delete-versus-edit', () => {
    const ancestor = shard([home])
    expect(
      mergeCatalogShards(
        ancestor,
        shard([home, message(save, { translations: { 'en-US': 'Save', es: 'Guardar' } })]),
        shard([home, message(save, { translations: { 'en-US': 'Save', fr: 'Enregistrer' } })]),
      ),
    ).toBe(
      shard([
        message(save, { translations: { 'en-US': 'Save', es: 'Guardar', fr: 'Enregistrer' } }),
        home,
      ]),
    )
    expect(() =>
      mergeCatalogShards(
        ancestor,
        shard([home, message(save, { translations: { 'en-US': 'Keep' } })]),
        shard([home, message(save, { translations: { 'en-US': 'Other' } })]),
      ),
    ).toThrow(CatalogMergeConflict)
    expect(() =>
      mergeCatalogShards(
        shard([save]),
        shard([]),
        shard([home, message(save, { translations: { 'en-US': 'Keep' } })]),
      ),
    ).toThrow(CatalogMergeConflict)
    expect(() =>
      mergeCatalogShards(
        shard([save]),
        shard([home, message(save, { translations: { 'en-US': 'Keep' } })]),
        shard([]),
      ),
    ).toThrow(CatalogMergeConflict)
    try {
      mergeCatalogShards(
        shard([cancel, save]),
        shard([cancel, message(save, { translations: { 'en-US': 'Keep' } })]),
        shard([cancel, message(save, { translations: { 'en-US': 'Other' } })]),
      )
      throw new Error('expected conflict')
    } catch (error) {
      expect((error as CatalogMergeConflict).text).toContain(serializeCatalogLine(cancel) + ',')
      expect((error as CatalogMergeConflict).text).toContain('<<<<<<< ours')
    }
    try {
      mergeCatalogShards(
        shard([save]),
        shard([]),
        shard([message(save, { translations: { 'en-US': 'Keep' } })]),
      )
      throw new Error('expected conflict')
    } catch (error) {
      expect((error as CatalogMergeConflict).text).toMatch(
        /<<<<<<< ours\n=======\n\{"id":"common.save"/,
      )
    }
    try {
      mergeCatalogShards(
        shard([save]),
        shard([message(save, { translations: { 'en-US': 'Keep' } })]),
        shard([]),
      )
      throw new Error('expected conflict')
    } catch (error) {
      expect((error as CatalogMergeConflict).text).toMatch(
        /<<<<<<< ours\n\{"id":"common.save"[^\n]+\n=======\n>>>>>>> theirs/,
      )
    }
    expect(() =>
      mergeCatalogShards(
        `[\n${serializeCatalogLine(save)},\n${serializeCatalogLine(save)}\n]\n`,
        shard([save]),
        shard([save]),
      ),
    ).toThrow(/Duplicate message id/)
  })

  it('merges descriptors and equal plural objects, and conflicts on descriptor or locale edits', () => {
    const ancestor = shard([save])
    const described = message(save, { descriptor: { kind: 'plural', valueParameter: 'count' } })
    expect(
      mergeCatalogShards(
        ancestor,
        shard([described]),
        shard([message(save, { translations: { 'en-US': 'Save', es: 'Guardar' } })]),
      ),
    ).toBe(shard([message(described, { translations: { 'en-US': 'Save', es: 'Guardar' } })]))
    expect(
      mergeCatalogShards(
        ancestor,
        shard([message(save, { translations: { 'en-US': 'Save', es: 'Guardar' } })]),
        shard([described]),
      ),
    ).toBe(shard([message(described, { translations: { 'en-US': 'Save', es: 'Guardar' } })]))
    expect(() =>
      mergeCatalogShards(
        ancestor,
        shard([described]),
        shard([
          message(save, {
            descriptor: {
              kind: 'select-plural',
              valueParameter: 'count',
              selectParameter: 'unit',
              cases: ['day'],
            },
          }),
        ]),
      ),
    ).toThrow(CatalogMergeConflict)
    expect(
      mergeCatalogShards(
        shard([plural]),
        shard([
          message(plural, {
            translations: {
              'en-US': { other: '{count} items', one: '{count} item' },
              fr: { one: '{count} élément', other: '{count} éléments' },
            },
          }),
        ]),
        shard([
          message(plural, {
            translations: {
              'en-US': { one: '{count} item', other: '{count} items' },
              es: { one: '{count} artículo', other: '{count} artículos' },
            },
          }),
        ]),
      ),
    ).toBe(
      shard([
        message(plural, {
          translations: {
            'en-US': { one: '{count} item', other: '{count} items' },
            es: { one: '{count} artículo', other: '{count} artículos' },
            fr: { one: '{count} élément', other: '{count} éléments' },
          },
        }),
      ]),
    )
    expect(() =>
      mergeCatalogShards(
        shard([plural]),
        shard([
          message(plural, {
            translations: { 'en-US': { one: '{count} thing', other: '{count} items' } },
          }),
        ]),
        shard([
          message(plural, {
            translations: { 'en-US': { one: '{count} item', other: '{count} pieces' } },
          }),
        ]),
      ),
    ).toThrow(CatalogMergeConflict)
    expect(() =>
      mergeCatalogShards(
        shard([save]),
        shard([message(save, { translations: { 'en-US': 'Keep' } })]),
        shard([
          message(save, { translations: { 'en-US': { one: 'Save one', other: 'Save other' } } }),
        ]),
      ),
    ).toThrow(CatalogMergeConflict)
    expect(() =>
      mergeCatalogShards(
        shard([save]),
        shard([
          message(save, { translations: { 'en-US': { one: 'Save one', other: 'Save other' } } }),
        ]),
        shard([message(save, { translations: { 'en-US': 'Keep' } })]),
      ),
    ).toThrow(CatalogMergeConflict)
  })

  it('conflicts when complementary locale deletes empty the message', () => {
    const ancestor = shard([message(save, { translations: { 'en-US': 'Save', es: 'Guardar' } })])
    const dropEs = `[\n${serializeCatalogLine(save)}\n]\n`
    const dropEn = `[\n{"id":"common.save","consumers":["web"],"descriptor":null,"translations":{"es":"Guardar"}}\n]\n`
    expect(() => mergeCatalogShards(ancestor, dropEs, dropEn)).toThrow(CatalogMergeConflict)
  })
})
