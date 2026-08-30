import { ReviewsError } from './errors.mts'
import type { ReviewPostCommitEvent, ReviewsEngine } from './engine-types.mts'
import type { EngineOptions } from './internal-types.mts'
import { validatePolicy } from './policy.mts'
import { assertTargetAbsent, assertTargetPresent } from './target-state.mts'
import { assertChanges, assertEligible, assertRating, assertRatingSet } from './validation.mts'
import type { ReviewAction, ReviewRating, ReviewTarget } from './types.mts'

export function createReviewsEngine<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TTransaction,
  TCreate,
  TUpdate,
  TListQuery,
  TReview,
  TListResult,
>(
  options: EngineOptions<
    TActor,
    TReviewId,
    TTargetType,
    TTransaction,
    TCreate,
    TUpdate,
    TListQuery,
    TReview,
    TListResult
  >,
): ReviewsEngine<
  TActor,
  TReviewId,
  TTargetType,
  TCreate,
  TUpdate,
  TListQuery,
  TReview,
  TListResult
> {
  const targetTypes = validatePolicy(options.policy)
  const authorize = async (
    actor: TActor,
    action: ReviewAction,
    transaction: TTransaction,
    reviewId?: TReviewId,
    target?: ReviewTarget<TTargetType>,
  ) => {
    if (reviewId !== undefined) assertReviewId(reviewId)
    await options.authorize(
      {
        actor,
        action,
        ...(reviewId === undefined ? {} : { reviewId }),
        ...(target === undefined ? {} : { target }),
      },
      transaction,
    )
  }
  const mutation = async (
    actor: TActor,
    reviewId: TReviewId,
    action: 'add-rating' | 'delete-rating' | 'update-rating',
    target: ReviewTarget<TTargetType>,
    work: (transaction: TTransaction) => Promise<ReviewRating<TTargetType>>,
  ): Promise<ReviewRating<TTargetType>> => {
    assertReviewId(reviewId)
    const event = await options.repository.transaction(async (transaction) => {
      if (!(await options.repository.lockReview(reviewId, transaction)))
        throw new ReviewsError('review-not-found', 'The review was not found.')
      await authorize(actor, action, transaction, reviewId, target)
      await assertEligible(options, actor, reviewId, action, target, targetTypes, transaction)
      if (action === 'add-rating')
        assertTargetAbsent(await options.repository.listRatings(reviewId, transaction), target)
      const rating = await work(transaction)
      await assertRatingSet(
        await options.repository.listRatings(reviewId, transaction),
        options,
        targetTypes,
      )
      return { action, rating, reviewId } satisfies ReviewPostCommitEvent<
        TReviewId,
        TTargetType,
        TReview
      >
    })
    await options.onPostCommit(event)
    return event.rating
  }

  return {
    async createReview(actor, input) {
      const event = await options.repository.transaction(async (transaction) => {
        await authorize(actor, 'create-review', transaction)
        await assertRatingSet(input.ratings, options, targetTypes)
        const review = await options.reviews.createReview(actor, input.review, transaction)
        const reviewId = options.reviews.getReviewId(review)
        assertReviewId(reviewId)
        if (!(await options.repository.lockReview(reviewId, transaction)))
          throw new ReviewsError('review-not-found', 'The created review was not found.')
        for (const rating of input.ratings) {
          await assertEligible(
            options,
            actor,
            reviewId,
            'add-rating',
            rating.target,
            targetTypes,
            transaction,
          )
          await options.repository.addRating(reviewId, rating, transaction)
        }
        await assertRatingSet(
          await options.repository.listRatings(reviewId, transaction),
          options,
          targetTypes,
        )
        return { action: 'create-review' as const, review, reviewId }
      })
      await options.onPostCommit(event)
      return event.review
    },
    async updateReview(actor, reviewId, input) {
      assertReviewId(reviewId)
      const review = await options.repository.transaction(async (transaction) => {
        if (!(await options.repository.lockReview(reviewId, transaction)))
          throw new ReviewsError('review-not-found', 'The review was not found.')
        await authorize(actor, 'update-review', transaction, reviewId)
        const result = await options.reviews.updateReview(actor, reviewId, input, transaction)
        if (result === null) throw new ReviewsError('review-not-found', 'The review was not found.')
        const ratings = await options.repository.listRatings(reviewId, transaction)
        await assertRatingSet(ratings, options, targetTypes)
        for (const rating of ratings)
          await assertEligible(
            options,
            actor,
            reviewId,
            'update-review',
            rating.target,
            targetTypes,
            transaction,
          )
        return result
      })
      await options.onPostCommit({ action: 'update-review', review, reviewId })
      return review
    },
    async listReviews(actor, query) {
      return await options.repository.transaction(async (transaction) => {
        await authorize(actor, 'list-reviews', transaction)
        return await options.reviews.listReviews(actor, query, transaction)
      })
    },
    async listRatings(actor, reviewId) {
      assertReviewId(reviewId)
      return await options.repository.transaction(async (transaction) => {
        if (!(await options.repository.lockReview(reviewId, transaction)))
          throw new ReviewsError('review-not-found', 'The review was not found.')
        await authorize(actor, 'list-ratings', transaction, reviewId)
        return await options.repository.listRatings(reviewId, transaction)
      })
    },
    async addRating(actor, reviewId, input) {
      assertRating(input, options)
      return await mutation(
        actor,
        reviewId,
        'add-rating',
        input.target,
        async (transaction) => await options.repository.addRating(reviewId, input, transaction),
      )
    },
    async updateRating(actor, reviewId, input) {
      assertChanges(input, options)
      return await mutation(actor, reviewId, 'update-rating', input.target, async (transaction) => {
        const rating = await options.repository.updateRating(reviewId, input, transaction)
        if (rating === null)
          throw new ReviewsError('rating-not-found', 'The review rating was not found.')
        return rating
      })
    },
    async deleteRating(actor, reviewId, target) {
      return await mutation(actor, reviewId, 'delete-rating', target, async (transaction) => {
        const ratings = await options.repository.listRatings(reviewId, transaction)
        assertTargetPresent(ratings, target)
        if (!(await options.policy.canDelete({ ratings, target })))
          throw new ReviewsError('final-deletion-rejected', 'The review rating cannot be deleted.')
        const rating = await options.repository.deleteRating(reviewId, target, transaction)
        if (rating === null)
          throw new ReviewsError('rating-not-found', 'The review rating was not found.')
        return rating
      })
    },
  }
}

function assertReviewId(reviewId: unknown): asserts reviewId is string {
  if (typeof reviewId !== 'string' || reviewId.trim() === '')
    throw new ReviewsError('invalid-review-id', 'Review IDs must be non-empty strings.')
}
