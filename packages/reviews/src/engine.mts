import { ReviewsError } from './errors.mts'
import type { ReviewsEngine, ReviewsEngineOptions } from './engine-types.mts'
import { createReviewRatingsEngine } from './rating-engine.mts'
import { validatePolicy } from './policy.mts'
import { assertEligible, assertRatingSet, assertReviewId } from './validation.mts'
import type { ReviewAction } from './types.mts'

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
  options: ReviewsEngineOptions<
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
  const ratingsEngine = createReviewRatingsEngine<TActor, TReviewId, TTargetType, TTransaction>(
    options,
  )
  const authorize = async (
    actor: TActor,
    action: ReviewAction,
    transaction: TTransaction,
    reviewId?: TReviewId,
  ) => {
    if (reviewId !== undefined) assertReviewId(reviewId)
    await options.authorize(
      {
        actor,
        action,
        ...(reviewId === undefined ? {} : { reviewId }),
      },
      transaction,
    )
  }
  return {
    ...ratingsEngine,
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
  }
}
