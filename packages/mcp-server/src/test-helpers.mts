import { readFileSync } from 'node:fs'

/** Date-time acceptance contract: UTC month-end leap-second placement, nothing announced. */
export const dateTimeCases = [
  { id: 'structural-february-leap-year', value: '2000-02-29T23:59:60Z', valid: true },
  { id: 'structural-february-common-year', value: '1900-02-28T23:59:60Z', valid: true },
  { id: 'structural-february-offset-rollover', value: '2000-03-01T00:59:60+01:00', valid: true },
  { id: 'rfc-utc', value: '1990-12-31T23:59:60Z', valid: true },
  { id: 'rfc-negative-offset', value: '1990-12-31T15:59:60-08:00', valid: true },
  { id: 'next-year-positive-offset', value: '1991-01-01T00:59:60+01:00', valid: true },
  { id: 'fraction', value: '2016-12-31T23:59:60.5Z', valid: true },
  { id: 'half-hour-rollover', value: '2017-01-01T00:29:60+00:30', valid: true },
  { id: 'negative-half-hour', value: '2016-12-31T23:29:60-00:30', valid: true },
  { id: 'june', value: '2015-06-30T23:59:60Z', valid: true },
  { id: 'july-rollover', value: '2015-07-01T01:29:60+01:30', valid: true },
  { id: 'mid-month', value: '2026-10-09T23:59:60Z', valid: false },
  { id: 'mid-month-positive-offset', value: '2026-10-10T00:59:60+01:00', valid: false },
  { id: 'mid-month-negative-offset', value: '2026-10-09T15:59:60-08:00', valid: false },
  { id: 'midday', value: '2016-12-31T12:00:60Z', valid: false },
  { id: 'second-61', value: '2016-12-31T23:59:61Z', valid: false },
  { id: 'local-month-end', value: '2016-12-31T00:59:60+01:00', valid: false },
  { id: 'ordinary', value: '2026-10-09T00:00:00.000Z', valid: true },
  { id: 'ordinary-offset', value: '2024-02-29T23:59:59+02:00', valid: true },
  { id: 'ordinary-rollover', value: '2017-01-01T00:59:59+01:00', valid: true },
  { id: 'compact-offset', value: '2026-10-09 00:00:00+0000', valid: true },
  { id: 'year-zero', value: '0000-02-29T12:00:00Z', valid: true },
  { id: 'lowercase', value: '1990-12-31t23:59:60z', valid: true },
  { id: 'bom-separator', value: '2026-10-09﻿00:00:00Z', valid: true },
  { id: 'invalid-leap-day', value: '2025-02-29T00:00:00Z', valid: false },
  { id: 'missing-time', value: '2026-10-09', valid: false },
  { id: 'missing-zone', value: '2026-10-09T00:00:00', valid: false },
  { id: 'hour-24', value: '2026-10-09T24:00:00Z', valid: false },
  { id: 'trailing-newline', value: '2026-10-09T00:00:00Z\n', valid: false },
  { id: 'non-js-whitespace', value: '2026-10-09\u008500:00:00Z', valid: false },
] as const

/** Read a JSON fixture stored next to the tests. */
export function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url), 'utf8'))
}

/** Assert that a standalone schema resolves every reference within its own `$defs`. */
export function assertLocalSchemaRefs(schema: unknown): void {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema))
    throw new Error('Expected an object schema')
  const defs = (schema as Record<string, unknown>)['$defs']
  const definitions =
    defs && typeof defs === 'object' && !Array.isArray(defs)
      ? (defs as Record<string, unknown>)
      : {}
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    const node = value as Record<string, unknown>
    const ref = node['$ref']
    if (typeof ref === 'string') {
      if (!/^#\/\$defs\/[^/]+$/.test(ref)) throw new Error(`Non-local schema reference: ${ref}`)
      if (!(ref.slice('#/$defs/'.length) in definitions))
        throw new Error(`Dangling schema reference: ${ref}`)
    }
    for (const child of Object.values(node)) visit(child)
  }
  visit(schema)
}
