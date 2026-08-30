import { describe, expect, it } from 'vitest'

import type { Context } from '@jongleberry/api-server'

import { registerReviewRoutes } from './index.mts'
import type { ReviewRatingsEngine, ReviewRouteRegistrar } from './index.mts'

type Handlers = Partial<
  Record<'delete' | 'get' | 'patch' | 'post', (context: never) => Promise<void>>
>

describe('registerReviewRoutes failures', () => {
  it('rejects duplicate method/path pairs while preserving shared collection paths', () => {
    expect(() =>
      registerReviewRoutes({
        engine: {} as never,
        routes: registrar(new Map()),
        respond: async () => undefined,
        mapError: async () => undefined,
        lifecycle: {
          paths: { list: '/reviews', create: '/reviews', update: '/reviews/:id' },
          codecs: lifecycleCodecs(),
        },
      }),
    ).not.toThrow()
    expect(() =>
      registerReviewRoutes({
        engine: {} as never,
        routes: registrar(new Map()),
        respond: async () => undefined,
        mapError: async () => undefined,
        ratings: {
          paths: { list: '/same', add: '/same', update: '/update', delete: '/delete' },
          codecs: codecs(),
        },
        lifecycle: {
          paths: { list: '/same', create: '/create', update: '/review' },
          codecs: lifecycleCodecs(),
        },
      }),
    ).toThrow('method and path pairs')
  })

  it('rejects empty paths and maps codec failures instead of responding', async () => {
    expect(() =>
      registerReviewRoutes({
        engine: {} as never,
        routes: registrar(new Map()),
        respond: async () => undefined,
        mapError: async () => undefined,
        ratings: {
          paths: { list: '', add: '/add', update: '/update', delete: '/delete' },
          codecs: codecs(),
        },
      }),
    ).toThrow('non-empty')

    const handlers = new Map<string, Handlers>()
    const mapped: unknown[] = []
    registerReviewRoutes({
      engine: {} as never,
      routes: registrar(handlers),
      respond: async () => {
        throw new Error('should not respond')
      },
      mapError: async (_context: Context, error: unknown) => {
        mapped.push(error)
      },
      ratings: {
        paths: {
          list: '/ratings',
          add: '/ratings',
          update: '/ratings/:target',
          delete: '/ratings/:target',
        },
        codecs: {
          ...codecs(),
          add: async () => {
            throw new Error('bad body')
          },
        },
      },
    })
    await handlers.get('/ratings')?.post?.({} as never)
    expect(mapped).toHaveLength(1)
    expect(mapped[0]).toMatchObject({ message: 'bad body' })
  })

  it('accepts a rating-only engine for rating-only routes', () => {
    registerReviewRoutes({
      engine: {} as ReviewRatingsEngine<string, string, 'model'>,
      routes: registrar(new Map()),
      respond: async () => undefined,
      mapError: async () => undefined,
      ratings: {
        paths: { list: '/ratings', add: '/ratings', update: '/rating', delete: '/rating' },
        codecs: codecs(),
      },
    })
  })
})

function codecs() {
  return {
    list: async () => ({ actor: 'alice', reviewId: 'review-1' }),
    add: async () => ({
      actor: 'alice',
      reviewId: 'review-1',
      input: { target: { type: 'model', id: 'one' }, rating: 3, order: 0 },
    }),
    update: async () => ({
      actor: 'alice',
      reviewId: 'review-1',
      input: { target: { type: 'model', id: 'one' }, changes: { rating: 3 } },
    }),
    delete: async () => ({
      actor: 'alice',
      reviewId: 'review-1',
      target: { type: 'model', id: 'one' },
    }),
  }
}

function lifecycleCodecs() {
  return {
    list: async () => ({ actor: 'alice', query: {} }),
    create: async () => ({ actor: 'alice', input: { review: {}, ratings: [] } }),
    update: async () => ({ actor: 'alice', reviewId: 'review-1', input: {} }),
  }
}

function registrar(handlers: Map<string, Handlers>): ReviewRouteRegistrar {
  return {
    route(path) {
      const entry = handlers.get(path) ?? {}
      handlers.set(path, entry)
      return {
        get: (handler) => (entry.get = handler as never),
        post: (handler) => (entry.post = handler as never),
        patch: (handler) => (entry.patch = handler as never),
        delete: (handler) => (entry.delete = handler as never),
      }
    },
  }
}
