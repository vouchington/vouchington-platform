import { describe, expect, it } from 'vitest'
import { catalogRevision, exportLocalizationCsv, importLocalizationCsv } from './index.mts'
import { csvRecord } from './csv.mts'
import { sampleMessages } from './test-helpers.mts'

describe('csv interchange', () => {
  it('round-trips catalogs without compiling CSV to sqlite', () => {
    const messages = sampleMessages()
    const csv = exportLocalizationCsv(messages)
    expect(importLocalizationCsv(csv, { expectedRevision: catalogRevision(messages) })).toEqual(
      messages,
    )
  })

  it('rejects header, duplicate, revision, and empty-row contract breaks', () => {
    expect(() => importLocalizationCsv('nope\n')).toThrow(/CSV header/)
    const csv = exportLocalizationCsv(sampleMessages())
    const [header, ...rows] = csv.trimEnd().split('\n')
    expect(() => importLocalizationCsv(`${header}\n`)).toThrow(/no data rows/)
    expect(() => importLocalizationCsv(`${header}\n${rows[0]}\n${rows[0]}\n`)).toThrow(
      /Duplicate CSV row/,
    )
    expect(() =>
      importLocalizationCsv(`${header}\n${rows[0]!.replace(/,[^,]+$/, ',deadbeef')}\n`),
    ).toThrow(/reconstructed catalog/)
    expect(() => importLocalizationCsv(csv, { expectedRevision: 'nope' })).toThrow(
      /source contract hash/,
    )
    const mixed = `${header}\n${rows[0]}\n${rows[1]!.replace(/,[^,]+$/, ',otherhash')}\n`
    expect(() => importLocalizationCsv(mixed)).toThrow(/share a single catalog_revision/)
    expect(() => csvRecord([])).toThrow(/missing id/)
  })
})
