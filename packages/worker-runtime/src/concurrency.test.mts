import { describe, expect, it, vi } from 'vitest'
import { getWorkerConcurrency, parseEnvPositiveInt } from './concurrency.mts'

describe('getWorkerConcurrency', () => {
  it('returns the baseline when no env vars are set', () => {
    expect(getWorkerConcurrency('foo', { baseline: 5, env: {} })).toBe(5)
  })

  it('scales by WORKER_CONCURRENCY_SCALE', () => {
    expect(
      getWorkerConcurrency('foo', { baseline: 5, env: { WORKER_CONCURRENCY_SCALE: '2' } }),
    ).toBe(10)
  })

  it('scales fractionally', () => {
    expect(
      getWorkerConcurrency('foo', { baseline: 5, env: { WORKER_CONCURRENCY_SCALE: '0.5' } }),
    ).toBe(3)
  })

  it('clamps a fractional scale to a minimum of 1', () => {
    expect(
      getWorkerConcurrency('foo', { baseline: 5, env: { WORKER_CONCURRENCY_SCALE: '0.05' } }),
    ).toBe(1)
  })

  it('clamps the result to the default max of 25', () => {
    expect(
      getWorkerConcurrency('foo', { baseline: 20, env: { WORKER_CONCURRENCY_SCALE: '10' } }),
    ).toBe(25)
  })

  it('respects an explicit per-worker override', () => {
    expect(
      getWorkerConcurrency('foo', {
        baseline: 5,
        env: { WORKER_CONCURRENCY_SCALE: '4', WORKER_CONCURRENCY_FOO: '7' },
      }),
    ).toBe(7)
  })

  it('clamps the per-worker override by the max', () => {
    expect(
      getWorkerConcurrency('foo', {
        baseline: 5,
        env: { WORKER_CONCURRENCY_FOO: '999' },
      }),
    ).toBe(25)
  })

  it('normalizes camelCase names to SCREAMING_SNAKE_CASE', () => {
    expect(
      getWorkerConcurrency('rssFeedItemCategories', {
        baseline: 5,
        env: { WORKER_CONCURRENCY_RSS_FEED_ITEM_CATEGORIES: '7' },
      }),
    ).toBe(7)
  })

  it('normalizes kebab-case names to SCREAMING_SNAKE_CASE', () => {
    expect(
      getWorkerConcurrency('rss-feeds', {
        baseline: 5,
        env: { WORKER_CONCURRENCY_RSS_FEEDS: '6' },
      }),
    ).toBe(6)
  })

  it('honors WORKER_CONCURRENCY_MAX over the per-call max', () => {
    expect(
      getWorkerConcurrency('foo', {
        baseline: 50,
        max: 100,
        env: { WORKER_CONCURRENCY_MAX: '10' },
      }),
    ).toBe(10)
  })

  it('honors a per-call max when WORKER_CONCURRENCY_MAX is unset', () => {
    expect(getWorkerConcurrency('foo', { baseline: 50, max: 10, env: {} })).toBe(10)
  })

  it('ignoreScale skips the global scale knob', () => {
    expect(
      getWorkerConcurrency('psql', {
        baseline: 1,
        ignoreScale: true,
        env: { WORKER_CONCURRENCY_SCALE: '10' },
      }),
    ).toBe(1)
  })

  it('ignoreScale still respects per-worker overrides', () => {
    expect(
      getWorkerConcurrency('psql', {
        baseline: 1,
        ignoreScale: true,
        env: { WORKER_CONCURRENCY_SCALE: '10', WORKER_CONCURRENCY_PSQL: '4' },
      }),
    ).toBe(4)
  })

  it('throws when baseline is not a positive integer', () => {
    expect(() => getWorkerConcurrency('foo', { baseline: 0, env: {} })).toThrow(/baseline/)
    expect(() => getWorkerConcurrency('foo', { baseline: -1, env: {} })).toThrow(/baseline/)
    expect(() => getWorkerConcurrency('foo', { baseline: 1.5, env: {} })).toThrow(/baseline/)
  })

  it('throws when an env override is not a positive integer', () => {
    expect(() =>
      getWorkerConcurrency('foo', { baseline: 5, env: { WORKER_CONCURRENCY_FOO: 'abc' } }),
    ).toThrow(/WORKER_CONCURRENCY_FOO/)
    expect(() =>
      getWorkerConcurrency('foo', { baseline: 5, env: { WORKER_CONCURRENCY_FOO: '0' } }),
    ).toThrow(/WORKER_CONCURRENCY_FOO/)
  })

  it('throws when WORKER_CONCURRENCY_SCALE is not a positive number', () => {
    expect(() =>
      getWorkerConcurrency('foo', { baseline: 5, env: { WORKER_CONCURRENCY_SCALE: '-1' } }),
    ).toThrow(/WORKER_CONCURRENCY_SCALE/)
    expect(() =>
      getWorkerConcurrency('foo', { baseline: 5, env: { WORKER_CONCURRENCY_SCALE: 'nope' } }),
    ).toThrow(/WORKER_CONCURRENCY_SCALE/)
  })

  it('treats empty env values as unset', () => {
    expect(
      getWorkerConcurrency('foo', {
        baseline: 5,
        env: { WORKER_CONCURRENCY_SCALE: '', WORKER_CONCURRENCY_FOO: '' },
      }),
    ).toBe(5)
  })
})

describe('getWorkerConcurrency env names', () => {
  it('reads process.env by default', () => {
    vi.stubEnv('WORKER_CONCURRENCY_FOO', '8')
    expect(getWorkerConcurrency('foo', { baseline: 2 })).toBe(8)
    vi.unstubAllEnvs()
  })

  it('reads overrides, scale, and max from a custom prefix', () => {
    const base = { baseline: 2, envPrefix: 'APP_' }
    expect(getWorkerConcurrency('foo', { ...base, env: { APP_FOO: '9' } })).toBe(9)
    expect(getWorkerConcurrency('foo', { ...base, env: { APP_SCALE: '3' } })).toBe(6)
    expect(getWorkerConcurrency('foo', { ...base, env: { APP_SCALE: '30', APP_MAX: '8' } })).toBe(8)
    expect(getWorkerConcurrency('foo', { ...base, env: { WORKER_CONCURRENCY_FOO: '9' } })).toBe(2)
  })

  it('reads scale and max from explicitly named env vars', () => {
    const env = { CUSTOM_SCALE: '4', CUSTOM_MAX: '5' }
    expect(
      getWorkerConcurrency('foo', {
        baseline: 2,
        scaleEnv: 'CUSTOM_SCALE',
        maxEnv: 'CUSTOM_MAX',
        env,
      }),
    ).toBe(5)
  })
})

describe('parseEnvPositiveInt', () => {
  it('returns the parsed value when the env var is set', () => {
    expect(parseEnvPositiveInt('FOO', 10, { FOO: '7' })).toBe(7)
  })

  it('returns the default value when the env var is unset', () => {
    expect(parseEnvPositiveInt('FOO', 10, {})).toBe(10)
  })

  it('returns the default when the env var is empty', () => {
    expect(parseEnvPositiveInt('FOO', 10, { FOO: '' })).toBe(10)
  })

  it('throws on non-numeric values', () => {
    expect(() => parseEnvPositiveInt('FOO', 10, { FOO: 'abc' })).toThrow(/FOO/)
  })

  it('throws on zero', () => {
    expect(() => parseEnvPositiveInt('FOO', 10, { FOO: '0' })).toThrow(/FOO/)
  })

  it('throws on negative', () => {
    expect(() => parseEnvPositiveInt('FOO', 10, { FOO: '-5' })).toThrow(/FOO/)
  })

  it('throws when default is not a positive integer', () => {
    expect(() => parseEnvPositiveInt('FOO', 0, {})).toThrow(/default for FOO/)
  })
})
