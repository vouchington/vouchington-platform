import { ReviewsError } from './errors.mts'
import type { ReviewRatingsEngine, ReviewRatingsEngineOptions } from './engine-types.mts'
import { validatePolicy } from './policy.mts'
import { assertTargetAbsent, assertTargetPresent } from './target-state.mts'
import {
  assertChanges,
  assertEligible,
  assertRating,
  assertRatingSet,
  assertReviewId,
} from './validation.mts'
import type { ReviewAction, ReviewRating, ReviewTarget } from './types.mts'

export function createReviewRatingsEngine<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TTransaction,
>(
  options: ReviewRatingsEngineOptions<TActor, TReviewId, TTargetType, TTransaction>,
): ReviewRatingsEngine<TActor, TReviewId, TTargetType> {
  const targetTypes = validatePolicy(options.policy)
  const authorize = async (
    actor: TActor,
    action: ReviewAction,
    transaction: TTransaction,
    reviewId: TReviewId,
    target?: ReviewTarget<TTargetType>,
  ) => {
    await options.authorize(
      {
        actor,
        action,
        reviewId,
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
      return { action, rating, reviewId }
    })
    await options.onPostCommit(event)
    return event.rating
  }

  return {
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
