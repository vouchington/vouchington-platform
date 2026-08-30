import { describe, expect, it, vi } from 'vitest'

import {
  ReportValidationError,
  createQueueClaimAdvisor,
  createQueueClaimHandler,
  createQueueReleaseHandler,
  createReportInputParser,
  createReportResolveHandler,
  createReportSubmitHandler,
  getQueueClaimDisposition,
  isQueueClaimExpired,
} from './index.mts'

const now = new Date('2026-01-02T03:04:05.000Z')

describe('createReportInputParser', () => {
  it('parses configured values, normalizes notes, and preserves immutable catalogs', () => {
    const validate = vi.fn((draft: { target: { type: string }; reason: string }) => {
      if (draft.target.type === 'entry' && draft.reason === 'unsafe')
        throw new Error('incompatible')
    })
    const parser = createReportInputParser({
      targetTypes: ['entry', 'account'] as const,
      reasons: ['incorrect', 'unsafe'] as const,
      parseTargetId: (value) => (value.startsWith('id-') ? value : null),
      maxNoteLength: 5,
      validate,
    })
    expect(
      parser.parse({ targetType: 'entry', targetId: 'id-1', reason: 'incorrect', note: ' hi ' }),
    ).toEqual({ target: { type: 'entry', id: 'id-1' }, reason: 'incorrect', note: 'hi' })
    expect(
      parser.parse({ targetType: 'entry', targetId: 'id-1', reason: 'incorrect', note: ' ' }).note,
    ).toBeNull()
    expect(
      parser.parse({ targetType: 'account', targetId: 'id-2', reason: 'unsafe' }).note,
    ).toBeNull()
    expect(() => parser.parse({ targetType: 'entry', targetId: 'id-1', reason: 'unsafe' })).toThrow(
      'incompatible',
    )
    expect(validate).toHaveBeenCalledTimes(4)
    expect(Object.isFrozen(parser.targetTypes)).toBe(true)
    expect(Object.isFrozen(parser.reasons)).toBe(true)
  })

  it('rejects malformed inputs and invalid configuration with typed validation errors', () => {
    const parser = createReportInputParser({
      targetTypes: ['entry'] as const,
      reasons: ['incorrect'] as const,
      parseTargetId: (value) => (value === 'valid' ? value : null),
      maxNoteLength: 1,
    })
    for (const [raw, code] of [
      [{ targetType: 'other', targetId: 'valid', reason: 'incorrect' }, 'invalid_target_type'],
      [{ targetType: 'entry', targetId: 'bad', reason: 'incorrect' }, 'invalid_target_identifier'],
      [{ targetType: 'entry', targetId: 1, reason: 'incorrect' }, 'invalid_target_identifier'],
      [{ targetType: 'entry', targetId: 'valid', reason: 'other' }, 'invalid_reason'],
      [{ targetType: 'entry', targetId: 'valid', reason: 'incorrect', note: 1 }, 'invalid_note'],
      [
        { targetType: 'entry', targetId: 'valid', reason: 'incorrect', note: 'xx' },
        'note_too_long',
      ],
    ] as const) {
      expect(() => parser.parse(raw)).toThrow(ReportValidationError)
      try {
        parser.parse(raw)
      } catch (error) {
        expect(error).toMatchObject({ code })
      }
    }
    expect(() =>
      createReportInputParser({
        targetTypes: [],
        reasons: ['reason'],
        parseTargetId: (value) => value,
        maxNoteLength: 1,
      }),
    ).toThrow(TypeError)
    expect(() =>
      createReportInputParser({
        targetTypes: ['type'],
        reasons: ['reason'],
        parseTargetId: (value) => value,
        maxNoteLength: -1,
      }),
    ).toThrow(TypeError)
  })
})

describe('queue claim helpers', () => {
  const sameActor = (left: string, right: string) => left === right
  const active = {
    item: 'item',
    heldBy: 'first',
    claimedAt: new Date(now.getTime() - 1),
    releasedAt: null,
  }

  it('distinguishes available, owned, expired, and held claims', () => {
    expect(getQueueClaimDisposition(null, 'first', now, 10, sameActor)).toBe('available')
    expect(
      getQueueClaimDisposition({ ...active, releasedAt: now }, 'first', now, 10, sameActor),
    ).toBe('available')
    expect(getQueueClaimDisposition(active, 'first', now, 10, sameActor)).toBe('renew')
    expect(getQueueClaimDisposition(active, 'second', now, 10, sameActor)).toBe('held')
    expect(
      getQueueClaimDisposition(
        { ...active, claimedAt: new Date(now.getTime() - 10) },
        'second',
        now,
        10,
        sameActor,
      ),
    ).toBe('takeover')
    expect(isQueueClaimExpired(active, now, 10)).toBe(false)
    expect(() => getQueueClaimDisposition(null, 'first', now, 0, sameActor)).toThrow('ttlMs')
  })

  it('uses injected actor identity and validates timestamps and expiry settings', () => {
    const advisor = createQueueClaimAdvisor<string, string>({
      clock: () => now,
      ttlMs: 10,
      sameActor,
    })
    expect(advisor.isExpired({ ...active, claimedAt: new Date(now.getTime() - 10) })).toBe(true)
    expect(advisor.disposition(active, 'first')).toBe('renew')
    const holder = { id: 'first' }
    expect(
      getQueueClaimDisposition(
        { ...active, heldBy: holder },
        { id: 'first' },
        now,
        10,
        (left, right) => left.id === right.id,
      ),
    ).toBe('renew')
    expect(() => isQueueClaimExpired(active, new Date('invalid'), 10)).toThrow('clock')
    expect(() => isQueueClaimExpired(active, now, 0)).toThrow('ttlMs')
    expect(() =>
      isQueueClaimExpired({ ...active, claimedAt: new Date('invalid') }, now, 10),
    ).toThrow('claimedAt')
    expect(() =>
      getQueueClaimDisposition(
        { ...active, releasedAt: new Date('invalid') },
        'first',
        now,
        10,
        sameActor,
      ),
    ).toThrow('releasedAt')
    expect(() =>
      createQueueClaimAdvisor({ clock: () => new Date('invalid'), ttlMs: 10, sameActor }),
    ).toThrow('clock')
  })
})

describe('Context handler factories', () => {
  it('runs submit dependencies in order and keeps duplicate and created statuses distinct', async () => {
    const calls: string[] = []
    const context = fakeContext(calls)
    const handler = createReportSubmitHandler({
      authenticate: async () => (calls.push('authenticate'), 'user'),
      parse: async () => (calls.push('parse'), 'input'),
      authorize: async () => void calls.push('authorize'),
      verifyPreconditions: async () => void calls.push('preconditions'),
      submit: async () => ({ result: (calls.push('submit'), 'result'), duplicate: false }),
      serialize: async (result, duplicate) => ({ result, duplicate }),
    })
    await handler(context)
    expect(calls).toEqual([
      'authenticate',
      'parse',
      'authorize',
      'preconditions',
      'submit',
      'status:201',
      'json',
    ])
    calls.length = 0
    await createReportSubmitHandler({
      authenticate: () => 'user',
      parse: () => 'input',
      authorize: () => undefined,
      verifyPreconditions: () => undefined,
      submit: () => ({ result: 'result', duplicate: true }),
      serialize: () => ({ ok: true }),
    })(context)
    expect(calls).toEqual(['status:200', 'json'])
  })

  it('uses injected resolve, claim, and release services', async () => {
    const calls: string[] = []
    const context = fakeContext(calls)
    const base = {
      authenticate: async () => 'user',
      parse: async () => 'input',
      authorize: async () => void calls.push('authorize'),
    }
    await createReportResolveHandler({
      ...base,
      resolve: async () => 'resolved',
      serialize: (value) => ({ value }),
    })(context)
    await createQueueClaimHandler({
      ...base,
      claim: async () => 'claimed',
      serialize: (value) => ({ value }),
    })(context)
    await createQueueReleaseHandler({ ...base, release: async () => void calls.push('release') })(
      context,
    )
    expect(calls).toEqual([
      'authorize',
      'json',
      'authorize',
      'json',
      'authorize',
      'release',
      'status:204',
    ])
  })

  it('propagates injected failures before running the service', async () => {
    const claim = vi.fn()
    const handler = createQueueClaimHandler({
      authenticate: async () => 'user',
      parse: async () => 'input',
      authorize: async () => {
        throw new Error('denied')
      },
      claim,
      serialize: (value) => ({ value }),
    })
    await expect(handler(fakeContext([]))).rejects.toThrow('denied')
    expect(claim).not.toHaveBeenCalled()
  })
})

function fakeContext(calls: string[]): Parameters<ReturnType<typeof createReportSubmitHandler>>[0] {
  return {
    setStatus: (status: number) => void calls.push(`status:${status}`),
    json: () => void calls.push('json'),
  } as never
}
