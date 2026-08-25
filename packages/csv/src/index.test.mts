import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  parseCsvRows,
  protectCsvFormula,
  streamCsvRows,
  stringifyCsvRows,
  stripCsvBom,
} from './index.mts'

describe('CSV utilities', () => {
  it('parses BOM-prefixed, quoted rows and rejects uneven rows', () => {
    expect(parseCsvRows('\uFEFFname,note\nAda,"one, two"\n')).toEqual([
      ['name', 'note'],
      ['Ada', 'one, two'],
    ])
    expect(() => parseCsvRows('a,b\nonly-one\n')).toThrow()
    expect(stripCsvBom('plain')).toBe('plain')
  })

  it('stringifies declared columns and protects formula cells', async () => {
    const rows = [{ name: '=1+1', ignored: 'not exported', note: null }]
    expect(protectCsvFormula('+SUM(A1)')).toBe("'+SUM(A1)")
    expect(protectCsvFormula('\t=SUM(A1)')).toBe("'\t=SUM(A1)")
    expect(protectCsvFormula('\r=SUM(A1)')).toBe("'\r=SUM(A1)")
    expect(protectCsvFormula('safe')).toBe('safe')
    expect(stringifyCsvRows(rows, ['name', 'note'])).toBe("name,note\n'=1+1,\n")
    await expect(read(streamCsvRows(rows, ['name', 'note']))).resolves.toBe("name,note\n'=1+1,\n")
  })
})

async function read(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of Readable.from(stream)) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}
