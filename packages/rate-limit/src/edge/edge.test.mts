import { describe, expect, it, vi } from 'vitest'

import {
  buildEdgeRateLimitKey,
  checkEdgeBuckets,
  getEdgeRateLimitRejection,
  hasAnyRateLimitBinding,
} from './index.mts'
import type { EdgeBucket } from './index.mts'

const binding = (success: boolean) => ({ limit: vi.fn(async () => ({ success })) })
const bucket = (b: ReturnType<typeof binding> | null | undefined): EdgeBucket => ({
  binding: b,
  key: (ip) => buildEdgeRateLimitKey('anon', ip),
})

describe('edge bindings', () => {
  it('builds keys and detects configured bindings', () => {
    expect(buildEdgeRateLimitKey('a', 'api', 'GET', '1.1.1.1')).toBe('a:api:GET:1.1.1.1')
    expect(hasAnyRateLimitBinding({ A: undefined, B: {} }, ['A', 'B'])).toBe(true)
    expect(hasAnyRateLimitBinding({ A: undefined }, ['A', 'C'])).toBe(false)
  })

  it('allows when no bucket is configured, even without an IP', async () => {
    expect(await checkEdgeBuckets([bucket(null), bucket(undefined)], null)).toBe(true)
  })

  it('refuses a missing IP when a bucket is configured', async () => {
    const b = binding(true)
    expect(await checkEdgeBuckets([bucket(b)], undefined)).toBe(false)
    expect(b.limit).not.toHaveBeenCalled()
  })

  it('charges buckets in order and stops at the first refusal', async () => {
    const first = binding(true)
    const second = binding(false)
    const third = binding(true)
    expect(
      await checkEdgeBuckets(
        [bucket(first), bucket(null), bucket(second), bucket(third)],
        '9.9.9.9',
      ),
    ).toBe(false)
    expect(first.limit).toHaveBeenCalledWith({ key: 'anon:9.9.9.9' })
    expect(third.limit).not.toHaveBeenCalled()
  })

  it('allows when every bucket passes', async () => {
    expect(await checkEdgeBuckets([bucket(binding(true)), bucket(binding(true))], '1.1.1.1')).toBe(
      true,
    )
  })
})

describe('getEdgeRateLimitRejection', () => {
  const base = {
    buckets: [bucket(binding(false))],
    ip: '1.1.1.1',
    hasAnyBinding: true,
    bypass: false,
    missingIp: () => 'missing-ip',
    limited: () => 'limited',
  }

  it('bypasses everything for exempt requests', async () => {
    expect(await getEdgeRateLimitRejection({ ...base, bypass: true, ip: null })).toBeNull()
  })

  it('rejects a missing IP only when a binding exists', async () => {
    expect(await getEdgeRateLimitRejection({ ...base, ip: null })).toBe('missing-ip')
    expect(
      await getEdgeRateLimitRejection({ ...base, ip: null, hasAnyBinding: false, buckets: [] }),
    ).toBeNull()
  })

  it('rejects refused requests and passes allowed ones', async () => {
    expect(await getEdgeRateLimitRejection(base)).toBe('limited')
    expect(
      await getEdgeRateLimitRejection({ ...base, buckets: [bucket(binding(true))] }),
    ).toBeNull()
  })
})
