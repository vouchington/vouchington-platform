import { describe, expect, it } from 'vitest'
import {
  catalogLineId,
  catalogMessageFromRecord,
  parseCatalogShardText,
  serializeCatalogLine,
  serializeCatalogShard,
  serializeCatalogShardFromLines,
} from './index.mts'

const home = catalogMessageFromRecord({
  id: 'nav.home',
  consumers: ['web'],
  descriptor: null,
  translations: { 'en-US': 'Home', es: 'Inicio' },
})
const save = catalogMessageFromRecord({
  id: 'common.save',
  consumers: ['swift', 'web'],
  translations: { 'en-US': 'Save' },
})

describe('catalog shard text', () => {
  it('writes one canonical message per line with id first', () => {
    const text = serializeCatalogShard([home, save])
    expect(text.startsWith('[\n{"id":"common.save"')).toBe(true)
    expect(text.split('\n')).toEqual([
      '[',
      `${serializeCatalogLine(save)},`,
      serializeCatalogLine(home),
      ']',
      '',
    ])
    expect(parseCatalogShardText(text)).toEqual([save, home])
    expect(serializeCatalogShard([])).toBe('[]\n')
    expect(parseCatalogShardText('[]\n')).toEqual([])
    expect(parseCatalogShardText('')).toEqual([])
    expect(catalogLineId(`${serializeCatalogLine(home)},`)).toBe('nav.home')
    expect(() => catalogLineId('{"id":"nav.home')).toThrow(/missing a message id/)
    expect(() => catalogLineId('{"consumers":[]}')).toThrow(/must start with/)
  })

  it('rejects pretty-printed, wrapped, unsorted, and non-canonical shards', () => {
    expect(() => parseCatalogShardText(JSON.stringify({ messages: [home] }))).toThrow(/one message/)
    expect(() => parseCatalogShardText(`${JSON.stringify([home])}\n`)).toThrow(/one message/)
    expect(() => parseCatalogShardText(`${JSON.stringify([home], null, 2)}\n`)).toThrow(
      /one message|commas|must start with/,
    )
    expect(() =>
      parseCatalogShardText(serializeCatalogShard([home, save]).replace(',\n', '\n')),
    ).toThrow(/commas/)
    const swapped = `[\n${serializeCatalogLine(home)},\n${serializeCatalogLine(save)}\n]\n`
    expect(() => parseCatalogShardText(swapped)).toThrow(/sorted/)
    const duplicate = `[\n${serializeCatalogLine(home)},\n${serializeCatalogLine(home)}\n]\n`
    expect(() => parseCatalogShardText(duplicate)).toThrow(/Duplicate message id/)
    expect(() => parseCatalogShardText(`[\n,\n${serializeCatalogLine(home)}\n]\n`)).toThrow(
      /exactly one line/,
    )
    const extra = `[\n${serializeCatalogLine(home).slice(0, -1)},"x":1}\n]\n`
    expect(() => parseCatalogShardText(extra)).toThrow(/not canonical; expected/)
    expect(() => parseCatalogShardText(extra)).toThrow(/Run format to rewrite/)
    expect(() => parseCatalogShardText('[\n]\n')).toThrow(/Empty catalog shard must be written/)
    expect(() => parseCatalogShardText('[\r\n]\r\n')).toThrow(/LF line endings/)
    expect(() => serializeCatalogShardFromLines([`${serializeCatalogLine(home)}\n`])).toThrow(
      /must not contain newlines/,
    )
    expect(() => serializeCatalogShardFromLines([`${serializeCatalogLine(home)}\r`])).toThrow(
      /must not contain newlines/,
    )
  })
})
