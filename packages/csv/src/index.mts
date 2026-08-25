import { stringify as createStringifier } from 'csv-stringify'
import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'

export type CsvRow = Record<string, string | null | undefined>
const FORMULA_PREFIX = /^[=+\-@\t\r]/u

export function stripCsvBom(value: string): string {
  return value.replace(/^\uFEFF/, '')
}
export function parseCsvRows(value: string): string[][] {
  return parse(stripCsvBom(value), {
    bom: true,
    relax_column_count: false,
    skip_empty_lines: true,
  }) as string[][]
}
export function protectCsvFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value
}
export function stringifyCsvRows(rows: readonly CsvRow[], columns: readonly string[]): string {
  return stringify(normalizeRows(rows, columns), { columns: [...columns], header: true })
}
export function streamCsvRows(
  rows: readonly CsvRow[],
  columns: readonly string[],
): NodeJS.ReadableStream {
  const stream = createStringifier({ columns: [...columns], header: true })
  for (const row of normalizeRows(rows, columns)) stream.write(row)
  stream.end()
  return stream
}
function normalizeRows(
  rows: readonly CsvRow[],
  columns: readonly string[],
): Record<string, string>[] {
  return rows.map((row) =>
    Object.fromEntries(columns.map((column) => [column, protectCsvFormula(row[column] ?? '')])),
  )
}
