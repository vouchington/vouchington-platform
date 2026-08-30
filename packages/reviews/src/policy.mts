import { ReviewsError } from './errors.mts'
import type { ReviewsPolicy } from './types.mts'

export function validatePolicy<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TTransaction,
>(policy: ReviewsPolicy<TActor, TReviewId, TTargetType, TTransaction>): ReadonlySet<string> {
  const { count, rating, targetTypes } = policy
  if (
    !Number.isSafeInteger(rating.minimum) ||
    !Number.isSafeInteger(rating.maximum) ||
    rating.minimum > rating.maximum
  )
    throw new ReviewsError('invalid-rating-policy', 'Rating bounds must be ordered safe integers.')
  if (
    !Number.isSafeInteger(count.minimum) ||
    !Number.isSafeInteger(count.maximum) ||
    count.minimum < 0 ||
    count.minimum > count.maximum
  )
    throw new ReviewsError(
      'invalid-count-policy',
      'Rating count bounds must be ordered non-negative safe integers.',
    )
  if (
    !Array.isArray(targetTypes) ||
    targetTypes.length === 0 ||
    targetTypes.some((type) => typeof type !== 'string' || type.trim() === '')
  )
    throw new ReviewsError(
      'invalid-target-types',
      'Target types must be a non-empty list of strings.',
    )
  const allowed = new Set(targetTypes)
  if (allowed.size !== targetTypes.length)
    throw new ReviewsError('invalid-target-types', 'Target types must not contain duplicates.')
  return allowed
}
