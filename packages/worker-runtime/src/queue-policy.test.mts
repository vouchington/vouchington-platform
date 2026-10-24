import { describe, expect, it } from 'vitest'

import { validateQueuePolicy } from './queue-policy.mts'

const groups = ['cpu', 'io', 'consumers'] as const
const options = { containedIn: { consumers: 'io' } }
const valid = { cpu: ['a'], io: ['b', 'c'], consumers: ['c'] }

describe('validateQueuePolicy', () => {
  it('returns the validated groups', () => {
    expect(validateQueuePolicy(valid, groups, options)).toEqual(valid)
  })

  it('works without options and checks overlap between all groups', () => {
    expect(validateQueuePolicy({ x: ['a'], y: ['b'] }, ['x', 'y'])).toEqual({ x: ['a'], y: ['b'] })
    expect(() => validateQueuePolicy({ x: ['a'], y: ['a'] }, ['x', 'y'])).toThrow(
      'x and y overlap: a',
    )
  })

  it.each([null, [], 'text'])('rejects non-object policy %j', (value) => {
    expect(() => validateQueuePolicy(value, groups, options)).toThrow('must be an object')
  })

  it('rejects unknown fields', () => {
    expect(() => validateQueuePolicy({ ...valid, extra: ['z'] }, groups, options)).toThrow(
      'unsupported fields: extra',
    )
  })

  it('rejects missing, empty, and non-array groups', () => {
    expect(() => validateQueuePolicy({ ...valid, cpu: [] }, groups, options)).toThrow(
      'cpu must be a nonempty array',
    )
    expect(() => validateQueuePolicy({ ...valid, cpu: 'a' }, groups, options)).toThrow(
      'cpu must be a nonempty array',
    )
    expect(() => validateQueuePolicy({ io: ['b'], consumers: ['b'] }, groups, options)).toThrow(
      'cpu must be a nonempty array',
    )
  })

  it('rejects blank, non-string, whitespace-padded, and duplicate names', () => {
    expect(() => validateQueuePolicy({ ...valid, cpu: [' '] }, groups, options)).toThrow(
      'nonempty queue names',
    )
    expect(() => validateQueuePolicy({ ...valid, cpu: [1] }, groups, options)).toThrow(
      'nonempty queue names',
    )
    expect(() => validateQueuePolicy({ ...valid, cpu: [' a'] }, groups, options)).toThrow(
      'without surrounding whitespace',
    )
    expect(() => validateQueuePolicy({ ...valid, cpu: ['a', 'a'] }, groups, options)).toThrow(
      'duplicate queue names',
    )
  })

  it('rejects names that would become selector syntax', () => {
    expect(() => validateQueuePolicy({ ...valid, cpu: ['-a'] }, groups, options)).toThrow(
      'must not contain a comma or start with "-"',
    )
    expect(() => validateQueuePolicy({ ...valid, cpu: ['a,b'] }, groups, options)).toThrow(
      'must not contain a comma',
    )
  })

  it('rejects overlapping exclusive groups', () => {
    expect(() => validateQueuePolicy({ ...valid, cpu: ['b'] }, groups, options)).toThrow(
      'cpu and io overlap: b',
    )
  })

  it('rejects contained groups with names outside their container', () => {
    expect(() => validateQueuePolicy({ ...valid, consumers: ['a'] }, groups, options)).toThrow(
      'consumers must be contained in io: a',
    )
  })

  it('rejects a container rule that names an unknown group', () => {
    expect(() =>
      validateQueuePolicy({ cpu: ['a'], io: ['b'] }, ['cpu', 'io'], {
        containedIn: { nope: 'io' },
      }),
    ).toThrow('unknown group: nope')
  })
})
