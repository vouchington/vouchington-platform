import { ReviewsError } from './errors.mts'
import type { ReviewRating, ReviewTarget } from './types.mts'

export function assertTargetAbsent<TTargetType extends string>(
  ratings: readonly ReviewRating<TTargetType>[],
  target: ReviewTarget<TTargetType>,
): void {
  if (hasTarget(ratings, target))
    throw new ReviewsError('duplicate-target', 'Review targets must be unique.')
}

export function assertTargetPresent<TTargetType extends string>(
  ratings: readonly ReviewRating<TTargetType>[],
  target: ReviewTarget<TTargetType>,
): void {
  if (!hasTarget(ratings, target))
    throw new ReviewsError('rating-not-found', 'The review rating was not found.')
}

function hasTarget<TTargetType extends string>(
  ratings: readonly ReviewRating<TTargetType>[],
  target: ReviewTarget<TTargetType>,
): boolean {
  return ratings.some(({ target: value }) => value.type === target.type && value.id === target.id)
}
