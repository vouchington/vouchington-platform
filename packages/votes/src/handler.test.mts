import { describe, expect, it, vi } from 'vitest'

import {
  createVoteChoiceCodec,
  createVoteClearHandler,
  createVoteHandler,
  isUuid,
} from './index.mts'
import type { VoteHandlerAdapter } from './types.mts'

const ID = '00000000-0000-7000-8000-000000000001'
type User = { id: string }
type Context = {
  id?: string
  user?: User | null
  body?: unknown
  status?: number
  routeCalls: number
}

const messages = {
  invalidId: 'invalid-id',
  unauthorized: 'unauthorized',
  notFound: 'not-found',
  invalidBody: 'invalid-body',
  invalidChoice: 'invalid-choice',
  limited: 'limited',
}

function adapter(): VoteHandlerAdapter<Context, User> {
  return {
    getEntityId: (context) => context.id,
    getCurrentUser: async (context) => context.user ?? null,
    getBody: async (context) => context.body,
    getAudit: async () => ({ ipAddress: '127.0.0.1' }),
    assert: (_context, condition, status, message) => {
      if (!condition) throw Object.assign(new Error(message), { status })
    },
    applyRouteRateLimit: async (context) => {
      context.routeCalls++
    },
    setNoContent: (context) => {
      context.status = 204
    },
  }
}

function context(overrides: Partial<Context> = {}): Context {
  return { id: ID, user: { id: ID }, body: { choice: 'up' }, routeCalls: 0, ...overrides }
}

describe('framework-neutral vote handler', () => {
  it('runs the configured mutation pipeline and returns no content', async () => {
    const calls: string[] = []
    const handler = createVoteHandler({
      adapter: adapter(),
      routeKey: 'vote',
      rateLimitPrefix: 'mutations',
      validateEntityId: isUuid,
      choiceCodec: createVoteChoiceCodec({ up: 1, down: -1 }),
      getEntity: async () => ({ id: ID }),
      upsert: async () => [
        { id: ID, entityId: ID, userId: ID, score: 1, previousScore: null, createdAt: new Date() },
      ],
      messages,
      beforeEntity: () => {
        calls.push('before-entity')
      },
      assertAccess: () => {
        calls.push('access')
      },
      withRequestLock: async (_user, _entity, work) => {
        calls.push('lock')
        return work()
      },
      beforeMutation: (mutation) => {
        expect(mutation).toMatchObject({ choice: 'up', score: 1, current: null, clear: false })
        calls.push('before-mutation')
      },
      onVote: () => {
        calls.push('vote')
      },
      checkRateLimit: async (input) => {
        calls.push(input.prefix ?? 'none')
        return false
      },
    })
    const request = context()
    await handler(request)
    expect(request).toMatchObject({ routeCalls: 1, status: 204 })
    expect(calls).toEqual([
      'before-entity',
      'access',
      'mutations',
      'lock',
      'before-mutation',
      'vote',
    ])
  })

  it('uses no-op hooks for same score and empty persistence results', async () => {
    const onNoop = vi.fn()
    const handler = createVoteHandler({
      adapter: adapter(),
      validateEntityId: isUuid,
      choiceCodec: createVoteChoiceCodec({ up: 1 }),
      getEntity: async () => ({ id: ID }),
      getCurrent: async () => ({
        id: ID,
        entityId: ID,
        userId: ID,
        score: 1,
        createdAt: new Date(),
      }),
      upsert: async () => [],
      messages,
      onNoop,
    })
    await handler(context())
    expect(onNoop).toHaveBeenCalledOnce()
    const noCurrent = createVoteHandler({
      adapter: adapter(),
      validateEntityId: isUuid,
      choiceCodec: createVoteChoiceCodec({ up: 1 }),
      getEntity: async () => ({ id: ID }),
      upsert: async () => [],
      messages,
      onNoop,
    })
    await noCurrent(context())
    expect(onNoop).toHaveBeenCalledTimes(2)
    const currentLookupMiss = createVoteHandler({
      adapter: adapter(),
      validateEntityId: isUuid,
      choiceCodec: createVoteChoiceCodec({ up: 1 }),
      getEntity: async () => ({ id: ID }),
      getCurrent: async () => null,
      upsert: async () => [],
      messages,
      onNoop,
    })
    await currentLookupMiss(context())
    expect(onNoop).toHaveBeenCalledTimes(3)
  })

  it('creates clear handlers without parsing a request body', async () => {
    const upsert = vi.fn(async () => [])
    const handler = createVoteClearHandler({
      adapter: adapter(),
      validateEntityId: isUuid,
      choiceCodec: createVoteChoiceCodec({ up: 1 }),
      getEntity: async () => ({ id: ID }),
      upsert,
      messages,
    })
    await handler(context({ body: null }))
    expect(upsert).toHaveBeenCalledWith(
      ID,
      { entityId: ID, score: null },
      { ipAddress: '127.0.0.1' },
    )
  })

  it('requires a configured limiter for a rate-limit prefix', () => {
    expect(() =>
      createVoteHandler({
        adapter: adapter(),
        rateLimitPrefix: 'votes',
        validateEntityId: isUuid,
        choiceCodec: createVoteChoiceCodec({ up: 1 }),
        getEntity: async () => ({ id: ID }),
        upsert: async () => [],
        messages,
      }),
    ).toThrow('checkRateLimit')
  })

  it('validates scores returned by custom codecs', async () => {
    const handler = createVoteHandler({
      adapter: adapter(),
      validateEntityId: isUuid,
      choiceCodec: { choices: ['up'], scoreForChoice: () => 32_768 },
      getEntity: async () => ({ id: ID }),
      upsert: async () => [],
      messages,
    })
    await expect(handler(context())).rejects.toThrow('smallint')
  })

  it('does not mutate when a clear lookup finds no current ballot', async () => {
    const upsert = vi.fn(async () => [])
    const onNoop = vi.fn()
    const handler = createVoteClearHandler({
      adapter: adapter(),
      validateEntityId: isUuid,
      choiceCodec: createVoteChoiceCodec({ up: 1 }),
      getEntity: async () => ({ id: ID }),
      getCurrent: async () => null,
      upsert,
      messages,
      onNoop,
    })
    await handler(context())
    expect(upsert).not.toHaveBeenCalled()
    expect(onNoop).toHaveBeenCalledWith(expect.objectContaining({ clear: true, current: null }))
  })

  it('supports application-defined semantic no-op comparisons', async () => {
    const upsert = vi.fn(async () => [])
    const handler = createVoteHandler({
      adapter: adapter(),
      validateEntityId: isUuid,
      choiceCodec: createVoteChoiceCodec({ up: 1, boost: 1 }),
      getEntity: async () => ({ id: ID }),
      getCurrent: async () => ({ choice: 'up' as const }),
      isNoop: ({ current, choice }) => current?.choice === choice,
      upsert,
      messages,
    })
    await handler(context({ body: { choice: 'up' } }))
    expect(upsert).not.toHaveBeenCalled()
    await handler(context({ body: { choice: 'boost' } }))
    expect(upsert).toHaveBeenCalledWith(ID, { entityId: ID, score: 1 }, expect.anything())
  })

  it('passes application-specific mutation results through to onVote', async () => {
    const onVote = vi.fn()
    const result = { previous_score: -1, external_activity_id: ID }
    await createVoteHandler({
      adapter: adapter(),
      validateEntityId: isUuid,
      choiceCodec: createVoteChoiceCodec({ up: 1 }),
      getEntity: async () => ({ id: ID }),
      upsert: async () => [result],
      onVote,
      messages,
    })(context())
    expect(onVote).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      result,
    )
  })

  it('treats an opaque current value as changed without a custom comparison', async () => {
    const upsert = vi.fn(async () => [])
    await createVoteHandler({
      adapter: adapter(),
      validateEntityId: isUuid,
      choiceCodec: createVoteChoiceCodec({ up: 1 }),
      getEntity: async () => ({ id: ID }),
      getCurrent: async () => 'opaque',
      upsert,
      messages,
    })(context())
    expect(upsert).toHaveBeenCalled()
  })

  it('does not depend on assertions returning type predicates', async () => {
    const permissive = {
      ...adapter(),
      assert: () => undefined,
      getBody: async () => null,
    }
    const upsert = vi.fn(async () => [])
    await createVoteHandler({
      adapter: permissive,
      validateEntityId: isUuid,
      choiceCodec: { choices: ['up'], scoreForChoice: () => 1 },
      getEntity: async () => ({ id: ID }),
      upsert,
      messages,
    })(context())
    expect(upsert).toHaveBeenCalled()
  })

  it.each([
    [context({ id: 'bad' }), 'invalid-id'],
    [context({ user: null }), 'unauthorized'],
    [context({ body: null }), 'invalid-body'],
    [context({ body: { choice: 'sideways' } }), 'invalid-choice'],
  ])('rejects invalid request input: %s', async (request, message) => {
    const handler = createVoteHandler({
      adapter: adapter(),
      validateEntityId: isUuid,
      choiceCodec: createVoteChoiceCodec({ up: 1 }),
      getEntity: async () => ({ id: ID }),
      upsert: async () => [],
      messages,
    })
    await expect(handler(request)).rejects.toThrow(message)
  })

  it('applies pre-entity checks, not-found behavior, and rate-limit rejection', async () => {
    const rejectBeforeEntity = createVoteHandler({
      adapter: adapter(),
      validateEntityId: isUuid,
      choiceCodec: createVoteChoiceCodec({ up: 1 }),
      getEntity: async () => ({ id: ID }),
      upsert: async () => [],
      messages,
      beforeEntity: () => {
        throw new Error('pre-access')
      },
    })
    await expect(rejectBeforeEntity(context())).rejects.toThrow('pre-access')
    const missing = createVoteHandler({
      adapter: adapter(),
      validateEntityId: isUuid,
      choiceCodec: createVoteChoiceCodec({ up: 1 }),
      getEntity: async () => null,
      upsert: async () => [],
      messages,
    })
    await expect(missing(context())).rejects.toThrow('not-found')
    const limited = createVoteHandler({
      adapter: adapter(),
      validateEntityId: isUuid,
      choiceCodec: createVoteChoiceCodec({ up: 1 }),
      getEntity: async () => ({ id: ID }),
      upsert: async () => [],
      messages,
      checkRateLimit: async () => true,
    })
    await expect(limited(context())).rejects.toThrow('limited')
  })
})
