import { ReviewsError } from './errors.mts'
import type { EngineOptions } from './internal-types.mts'
import type {
  CreateReviewRatingInput,
  ReviewAction,
  ReviewRating,
  ReviewRatingScale,
  ReviewTarget,
  UpdateReviewRatingInput,
} from './types.mts'

export function assertReviewId(reviewId: unknown): asserts reviewId is string {
  if (typeof reviewId !== 'string' || reviewId.trim() === '')
    throw new ReviewsError('invalid-review-id', 'Review IDs must be non-empty strings.')
}

export async function assertEligible<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TTransaction,
>(
  options: EngineOptions<TActor, TReviewId, TTargetType, TTransaction>,
  actor: TActor,
  reviewId: TReviewId,
  action: ReviewAction,
  target: ReviewTarget<TTargetType>,
  targetTypes: ReadonlySet<string>,
  transaction: TTransaction,
): Promise<void> {
  assertTarget(target, targetTypes)
  if (!(await options.policy.isTargetEligible({ actor, reviewId, action, target }, transaction)))
    throw new ReviewsError('target-not-eligible', 'The review target is not eligible.')
}

export function assertRating<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TTransaction,
>(
  input: CreateReviewRatingInput<TTargetType>,
  options: EngineOptions<TActor, TReviewId, TTargetType, TTransaction>,
): void {
  assertValue(input.rating, options)
  assertOrder(input.order)
}

export function assertChanges<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TTransaction,
>(
  input: UpdateReviewRatingInput<TTargetType>,
  options: EngineOptions<TActor, TReviewId, TTargetType, TTransaction>,
): void {
  const { order, rating } = input.changes
  if (order === undefined && rating === undefined)
    throw new ReviewsError('invalid-rating', 'At least one rating change is required.')
  if (rating !== undefined) assertValue(rating, options)
  if (order !== undefined) assertOrder(order)
}

export async function assertRatingSet<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TTransaction,
>(
  ratings: readonly ReviewRating<TTargetType>[],
  options: EngineOptions<TActor, TReviewId, TTargetType, TTransaction>,
  targetTypes: ReadonlySet<string>,
): Promise<void> {
  const { minimum, maximum } = options.policy.count
  if (ratings.length < minimum || ratings.length > maximum)
    throw new ReviewsError(
      'rating-count-rejected',
      'The review rating count is outside the configured bounds.',
    )
  const targets = new Map<string, Set<string>>()
  for (const rating of ratings) {
    assertTarget(rating.target, targetTypes)
    assertValue(rating.rating, options)
    assertOrder(rating.order)
    const ids = targets.get(rating.target.type) ?? new Set<string>()
    if (ids.has(rating.target.id))
      throw new ReviewsError('duplicate-target', 'Review targets must be unique.')
    ids.add(rating.target.id)
    targets.set(rating.target.type, ids)
  }
  if (!(await options.policy.comparison(ratings)))
    throw new ReviewsError(
      'comparison-rejected',
      'The review ratings do not satisfy the configured comparison rule.',
    )
}

function assertTarget<TTargetType extends string>(
  target: ReviewTarget<TTargetType>,
  targetTypes: ReadonlySet<string>,
): void {
  if (
    typeof target !== 'object' ||
    target === null ||
    typeof target.id !== 'string' ||
    target.id.trim() === ''
  )
    throw new ReviewsError('invalid-target', 'Review targets require a non-empty string ID.')
  if (!targetTypes.has(target.type))
    throw new ReviewsError('target-type-not-allowed', 'The review target type is not allowed.')
}

function assertValue(value: unknown, options: { readonly policy: { rating: ReviewRatingScale } }) {
  const { minimum, maximum } = options.policy.rating
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new ReviewsError('invalid-rating', 'Rating is outside the configured scale.')
}

function assertOrder(value: unknown): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new ReviewsError('invalid-order', 'Rating order must be a non-negative safe integer.')
}
