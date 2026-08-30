import { describe, expect, it, vi } from 'vitest'

import {
  createApiServerVoteAdapter,
  createApiServerVoteClearHandler,
  createApiServerVoteHandler,
} from './api-server.mts'

describe('api-server vote adapter', () => {
  it('maps api-server context capabilities without changing root imports', async () => {
    const adapter = createApiServerVoteAdapter<{ id: string }>()
    const context = {
      params: { id: 'entity' },
      ip: '127.0.0.1',
      req: { headers: { 'user-agent': 'agent' } },
      getCurrentUser: async () => ({ id: 'user' }),
      getSessionTokenData: async () => ({ did: 'device', sid: 'session' }),
      request: { json: async () => ({ choice: 'up' }) },
      assert: vi.fn(),
      applyRouteRateLimit: vi.fn(),
      setStatus: vi.fn(),
    }
    const apiContext = context as never
    expect(adapter.getEntityId(apiContext)).toBe('entity')
    await expect(adapter.getCurrentUser(apiContext)).resolves.toEqual({ id: 'user' })
    await expect(adapter.getBody(apiContext)).resolves.toEqual({ choice: 'up' })
    await expect(adapter.getAudit(apiContext)).resolves.toEqual({
      ipAddress: '127.0.0.1',
      deviceId: 'device',
      sessionId: 'session',
      userAgent: 'agent',
    })
    adapter.assert(apiContext, true, 200, 'ok')
    await adapter.applyRouteRateLimit!(apiContext, 'route')
    adapter.setNoContent(apiContext)
    expect(context.assert).toHaveBeenCalledWith(true, 200, 'ok')
    expect(context.applyRouteRateLimit).toHaveBeenCalledWith('route')
    expect(context.setStatus).toHaveBeenCalledWith(204)
  })

  it('creates vote and clear handlers with the built-in adapter', async () => {
    const upsert = vi.fn(async () => [])
    const options = {
      validateEntityId: (id: string) => id === 'entity',
      choiceCodec: { choices: ['up'] as const, scoreForChoice: () => 1 },
      getEntity: async () => ({ id: 'entity' }),
      upsert,
      messages: {
        invalidId: 'invalid',
        unauthorized: 'unauthorized',
        notFound: 'missing',
        invalidBody: 'body',
        invalidChoice: 'choice',
        limited: 'limited',
      },
    }
    const context = {
      params: { id: 'entity' },
      req: { headers: {} },
      getCurrentUser: async () => ({ id: 'user' }),
      getSessionTokenData: async () => null,
      request: { json: async () => ({ choice: 'up' }) },
      assert: (_condition: unknown, _status: number, _message: string) => undefined,
      applyRouteRateLimit: async () => undefined,
      setStatus: vi.fn(),
    } as never
    await createApiServerVoteHandler(options)(context)
    await createApiServerVoteClearHandler(options)(context)
    expect(upsert).toHaveBeenNthCalledWith(
      1,
      'user',
      { entityId: 'entity', score: 1 },
      expect.anything(),
    )
    expect(upsert).toHaveBeenNthCalledWith(
      2,
      'user',
      { entityId: 'entity', score: null },
      expect.anything(),
    )
  })
})
