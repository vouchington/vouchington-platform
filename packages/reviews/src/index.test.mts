import { describe, expect, it } from 'vitest'

import { createReviewsEngine, registerReviewRoutes } from './index.mts'
import type {
  CreateReviewRatingInput,
  ReviewRating,
  ReviewRouteRegistrar,
  ReviewTarget,
  ReviewsRepository,
} from './index.mts'

type TargetType = 'model' | 'provider'
type Target = ReviewTarget<TargetType>
type Rating = ReviewRating<TargetType>
type Transaction = { readonly id: string }

describe('createReviewsEngine', () => {
  it('locks before every rating mutation, validates final state, and hooks after commit', async () => {
    const fixture = engineFixture()
    const provider = target('provider', 'provider-1')
    const model = target('model', 'model-1')

    await fixture.engine.addRating('alice', 'review-1', rating(provider, 2, 0))
    await fixture.engine.addRating('alice', 'review-1', rating(model, 5, 1))
    await fixture.engine.updateRating('alice', 'review-1', {
      target: model,
      changes: { rating: 4 },
    })
    await fixture.engine.deleteRating('alice', 'review-1', provider)

    expect(fixture.order).toEqual([
      'lock',
      'add',
      'final-state',
      'commit:add-rating',
      'lock',
      'add',
      'final-state',
      'commit:add-rating',
      'lock',
      'update',
      'final-state',
      'commit:update-rating',
      'lock',
      'final-state',
      'delete',
      'final-state',
      'commit:delete-rating',
    ])
    await expect(fixture.engine.deleteRating('alice', 'review-1', model)).rejects.toMatchObject({
      code: 'final-deletion-rejected',
    })
    expect(fixture.order.at(-1)).toBe('final-state')
  })

  it('rolls back rejected final state and allows application-defined review lifecycle', async () => {
    const fixture = engineFixture()
    await fixture.engine.addRating('alice', 'review-1', rating(target('model', 'one'), 3, 0))
    await expect(
      fixture.engine.addRating('alice', 'review-1', rating(target('provider', 'two'), 3, 1)),
    ).rejects.toMatchObject({ code: 'comparison-rejected' })
    await expect(fixture.engine.listRatings('alice', 'review-1')).resolves.toEqual([
      rating(target('model', 'one'), 3, 0),
    ])
    await expect(
      fixture.engine.createReview('alice', {
        review: { title: 'A review' },
        ratings: [rating(target('provider', 'created-target'), 5, 0)],
      }),
    ).resolves.toEqual({
      id: 'created',
      title: 'created',
    })
    await expect(
      fixture.engine.updateReview('alice', 'review-1', { title: 'Updated' }),
    ).resolves.toEqual({
      id: 'review-1',
      title: 'updated',
    })
    await expect(fixture.engine.listReviews('alice', { author: 'alice' })).resolves.toEqual({
      items: [{ id: 'review-1' }],
    })
  })

  it('normalizes missing reviews before rating operations', async () => {
    const fixture = engineFixture({ reviewExists: false })

    await expect(fixture.engine.listRatings('alice', 'missing')).rejects.toMatchObject({
      code: 'review-not-found',
    })
    await expect(
      fixture.engine.addRating('alice', 'missing', rating(target('model', 'one'), 3, 0)),
    ).rejects.toMatchObject({ code: 'review-not-found' })
  })

  it('rolls back lifecycle updates that invalidate the persisted rating set', async () => {
    const fixture = engineFixture({ invalidateOnUpdate: true })
    const initial = rating(target('model', 'one'), 3, 0)
    await fixture.engine.addRating('alice', 'review-1', initial)

    await expect(
      fixture.engine.updateReview('alice', 'review-1', { title: 'Updated' }),
    ).rejects.toMatchObject({ code: 'rating-count-rejected' })
    await expect(fixture.engine.listRatings('alice', 'review-1')).resolves.toEqual([initial])
  })

  it('maps a missing lifecycle update result and permits order-only rating updates', async () => {
    const missing = engineFixture({ updateReturnsNull: true })
    await expect(
      missing.engine.updateReview('alice', 'review-1', { title: 'x' }),
    ).rejects.toMatchObject({
      code: 'review-not-found',
    })
    const fixture = engineFixture()
    await fixture.engine.addRating('alice', 'review-1', rating(target('model', 'one'), 3, 0))
    await expect(
      fixture.engine.updateRating('alice', 'review-1', {
        target: target('model', 'one'),
        changes: { order: 1 },
      }),
    ).resolves.toMatchObject({ order: 1, rating: 3 })
  })

  it('normalizes missing reviews across every review-scoped operation', async () => {
    const fixture = engineFixture({ reviewExists: false })
    const value = target('model', 'one')

    await expect(
      fixture.engine.updateReview('alice', 'missing', { title: 'x' }),
    ).rejects.toMatchObject({
      code: 'review-not-found',
    })
    await expect(
      fixture.engine.updateRating('alice', 'missing', { target: value, changes: { rating: 3 } }),
    ).rejects.toMatchObject({
      code: 'review-not-found',
    })
    await expect(fixture.engine.deleteRating('alice', 'missing', value)).rejects.toMatchObject({
      code: 'review-not-found',
    })
    await expect(
      fixture.engine.createReview('alice', {
        review: { title: 'x' },
        ratings: [rating(value, 3, 0)],
      }),
    ).rejects.toMatchObject({ code: 'review-not-found' })
  })

  it('keeps committed mutations when an injected post-commit hook fails', async () => {
    const fixture = engineFixture({ postCommitError: new Error('hook failed') })
    const input = rating(target('model', 'one'), 3, 0)

    await expect(fixture.engine.addRating('alice', 'review-1', input)).rejects.toThrow(
      'hook failed',
    )
    fixture.postCommitError = undefined
    await expect(fixture.engine.listRatings('alice', 'review-1')).resolves.toEqual([input])
  })

  it('rejects invalid rating inputs and storage misses before post-commit', async () => {
    const fixture = engineFixture({ ratingExists: false })
    const targetValue = target('model', 'one')
    const invalids: Array<CreateReviewRatingInput<TargetType>> = [
      { target: targetValue, rating: Number.NaN, order: 0 },
      { target: targetValue, rating: 2.5, order: 0 },
      { target: targetValue, rating: 0, order: 0 },
      { target: targetValue, rating: 6, order: 0 },
      { target: targetValue, rating: 3, order: -1 },
    ]
    for (const input of invalids) {
      await expect(fixture.engine.addRating('alice', 'review-1', input)).rejects.toBeInstanceOf(
        Error,
      )
    }
    await expect(
      fixture.engine.updateRating('alice', 'review-1', { target: targetValue, changes: {} }),
    ).rejects.toMatchObject({ code: 'invalid-rating' })
    await expect(
      fixture.engine.updateRating('alice', 'review-1', {
        target: targetValue,
        changes: { rating: 3 },
      }),
    ).rejects.toMatchObject({ code: 'rating-not-found' })
    await fixture.engine.addRating('alice', 'review-1', rating(targetValue, 3, 0))
    await fixture.engine.addRating('alice', 'review-1', rating(target('provider', 'two'), 4, 1))
    await expect(
      fixture.engine.deleteRating('alice', 'review-1', target('model', 'missing')),
    ).rejects.toMatchObject({
      code: 'rating-not-found',
    })
  })

  it('maps target and persisted-set policy violations to domain errors', async () => {
    const fixture = engineFixture()
    await expect(fixture.engine.listRatings('alice', '   ')).rejects.toMatchObject({
      code: 'invalid-review-id',
    })
    await expect(
      fixture.engine.addRating('alice', 'review-1', {
        target: { type: 'model', id: '' },
        rating: 3,
        order: 0,
      }),
    ).rejects.toMatchObject({ code: 'invalid-target' })
    await expect(
      fixture.engine.addRating('alice', 'review-1', {
        target: { type: 'series' as TargetType, id: 'one' },
        rating: 3,
        order: 0,
      }),
    ).rejects.toMatchObject({ code: 'target-type-not-allowed' })
    await expect(
      fixture.engine.addRating('alice', 'review-1', rating(target('model', 'ineligible'), 3, 0)),
    ).rejects.toMatchObject({ code: 'target-not-eligible' })
    await fixture.engine.addRating('alice', 'review-1', rating(target('model', 'one'), 3, 0))
    await expect(
      fixture.engine.addRating('alice', 'review-1', rating(target('model', 'one'), 4, 1)),
    ).rejects.toMatchObject({ code: 'duplicate-target' })
    await expect(
      fixture.engine.createReview('alice', { review: { title: 'No ratings' }, ratings: [] }),
    ).rejects.toMatchObject({ code: 'rating-count-rejected' })
  })

  it('keeps opaque target IDs collision-safe when they contain NUL characters', async () => {
    const fixture = opaqueEngineFixture()
    await fixture.engine.addRating('alice', 'review-1', {
      target: { type: 'a', id: 'b\u0000c' },
      rating: 1,
      order: 0,
    })
    await fixture.engine.addRating('alice', 'review-1', {
      target: { type: 'a\u0000b', id: 'c' },
      rating: 2,
      order: 0,
    })
    await expect(fixture.engine.listRatings('alice', 'review-1')).resolves.toHaveLength(2)
  })
})

describe('registerReviewRoutes', () => {
  it('mounts optional lifecycle and individual rating endpoints through injected codecs', async () => {
    const fixture = engineFixture()
    const handlers = new Map<string, RegisteredHandlers>()
    const responses: string[] = []
    registerReviewRoutes({
      engine: fixture.engine,
      routes: registrar(handlers),
      mapError: async () => {
        responses.push('error')
      },
      respond: async (_context, result) => {
        responses.push(result.action)
      },
      ratings: {
        paths: {
          list: '/reviews/:id/ratings',
          add: '/reviews/:id/ratings',
          update: '/ratings/:target',
          delete: '/ratings/:target',
        },
        codecs: {
          list: async () => ({ actor: 'alice', reviewId: 'review-1' }),
          add: async () => ({
            actor: 'alice',
            reviewId: 'review-1',
            input: rating(target('model', 'one'), 4, 0),
          }),
          update: async () => ({
            actor: 'alice',
            reviewId: 'review-1',
            input: { target: target('model', 'one'), changes: { rating: 3 } },
          }),
          delete: async () => ({
            actor: 'alice',
            reviewId: 'review-1',
            target: target('model', 'one'),
          }),
        },
      },
      lifecycle: {
        paths: { list: '/reviews', create: '/reviews', update: '/reviews/:id' },
        codecs: {
          list: async () => ({ actor: 'alice', query: { author: 'alice' } }),
          create: async () => ({
            actor: 'alice',
            input: { review: { title: 'One' }, ratings: [rating(target('provider', 'one'), 5, 0)] },
          }),
          update: async () => ({ actor: 'alice', reviewId: 'review-1', input: { title: 'Two' } }),
        },
      },
    })

    await handlers.get('/reviews')?.post?.({} as never)
    await handlers.get('/reviews/:id/ratings')?.post?.({} as never)
    await handlers.get('/ratings/:target')?.patch?.({} as never)
    await fixture.engine.addRating('alice', 'review-1', rating(target('provider', 'two'), 4, 1))
    await handlers.get('/ratings/:target')?.delete?.({} as never)
    await handlers.get('/reviews/:id')?.patch?.({} as never)
    await handlers.get('/reviews')?.get?.({} as never)
    await handlers.get('/reviews/:id/ratings')?.get?.({} as never)
    expect(responses).toEqual([
      'create-review',
      'add-rating',
      'update-rating',
      'delete-rating',
      'update-review',
      'list-reviews',
      'list-ratings',
    ])
  })
})

function target(type: TargetType, id: string): Target {
  return { type, id }
}

function rating(
  targetValue: Target,
  value: number,
  order: number,
): CreateReviewRatingInput<TargetType> {
  return { target: targetValue, rating: value, order }
}

type RegisteredHandlers = Partial<
  Record<'delete' | 'get' | 'patch' | 'post', (context: never) => Promise<void>>
>

function registrar(handlers: Map<string, RegisteredHandlers>): ReviewRouteRegistrar {
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

function engineFixture(
  options: {
    readonly invalidateOnUpdate?: boolean
    readonly postCommitError?: Error
    readonly ratingExists?: boolean
    readonly reviewExists?: boolean
    readonly updateReturnsNull?: boolean
  } = {},
) {
  let stored = new Map<string, Rating[]>()
  let postCommitError = options.postCommitError
  const order: string[] = []
  const repository: ReviewsRepository<string, TargetType, Transaction> = {
    async transaction(work) {
      const before = new Map([...stored].map(([reviewId, ratings]) => [reviewId, [...ratings]]))
      try {
        return await work({ id: 'transaction' })
      } catch (error) {
        stored = before
        throw error
      }
    },
    async lockReview() {
      order.push('lock')
      return options.reviewExists ?? true
    },
    async listRatings(reviewId) {
      order.push('final-state')
      return stored.get(reviewId) ?? []
    },
    async addRating(reviewId, input) {
      order.push('add')
      const value = { ...input, target: { ...input.target } }
      stored.set(reviewId, [...(stored.get(reviewId) ?? []), value])
      return value
    },
    async updateRating(reviewId, input) {
      order.push('update')
      if (options.ratingExists === false) return null
      const ratings = stored.get(reviewId) ?? []
      const index = ratings.findIndex((value) => sameTarget(value.target, input.target))
      if (index === -1) return null
      const value = { ...ratings[index]!, ...input.changes }
      stored.set(reviewId, ratings.with(index, value))
      return value
    },
    async deleteRating(reviewId, selected) {
      order.push('delete')
      if (options.ratingExists === false) return null
      const ratings = stored.get(reviewId) ?? []
      const value = ratings.find((entry) => sameTarget(entry.target, selected))
      if (value === undefined) return null
      stored.set(
        reviewId,
        ratings.filter((entry) => !sameTarget(entry.target, selected)),
      )
      return value
    },
  }
  return {
    order,
    get postCommitError() {
      return postCommitError
    },
    set postCommitError(value: Error | undefined) {
      postCommitError = value
    },
    engine: createReviewsEngine({
      repository,
      reviews: {
        createReview: async () => ({ id: 'created', title: 'created' }),
        getReviewId: (review) => review.id,
        updateReview: async (_actor, id) => {
          if (options.invalidateOnUpdate) stored.set(id, [])
          if (options.updateReturnsNull) return null
          return { id, title: 'updated' }
        },
        listReviews: async () => ({ items: [{ id: 'review-1' }] }),
      },
      authorize: async (_input, transaction) => {
        expect(transaction.id).toBe('transaction')
      },
      onPostCommit: ({ action }) => {
        order.push(`commit:${action}`)
        if (postCommitError !== undefined) throw postCommitError
      },
      policy: {
        targetTypes: ['provider', 'model'],
        rating: { minimum: 1, maximum: 5 },
        count: { minimum: 1, maximum: 3 },
        comparison: (ratings) =>
          new Set(ratings.map((value) => value.rating)).size === ratings.length,
        canDelete: ({ ratings }) => ratings.length > 1,
        isTargetEligible: ({ target: value }, transaction) =>
          transaction.id === 'transaction' && value.id !== 'ineligible',
      },
    }),
  }
}

function opaqueEngineFixture() {
  type OpaqueType = 'a' | 'a\u0000b'
  type OpaqueRating = ReviewRating<OpaqueType>
  let ratings: OpaqueRating[] = []
  return {
    engine: createReviewsEngine({
      repository: {
        transaction: async (work) => await work(undefined),
        lockReview: async () => true,
        listRatings: async () => ratings,
        addRating: async (_reviewId, input) => {
          ratings = [...ratings, input]
          return input
        },
        updateRating: async () => null,
        deleteRating: async () => null,
      },
      reviews: {
        createReview: async () => ({ id: 'review-1' }),
        getReviewId: (review) => review.id,
        updateReview: async () => null,
        listReviews: async () => [],
      },
      authorize: async () => undefined,
      onPostCommit: async () => undefined,
      policy: {
        targetTypes: ['a', 'a\u0000b'],
        rating: { minimum: 1, maximum: 5 },
        count: { minimum: 1, maximum: 3 },
        comparison: () => true,
        canDelete: () => true,
        isTargetEligible: () => true,
      },
    }),
  }
}

function sameTarget(left: Target, right: Target): boolean {
  return left.type === right.type && left.id === right.id
}
