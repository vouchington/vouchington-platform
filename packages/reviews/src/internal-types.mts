import type { ReviewRatingsEngineOptions } from './engine-types.mts'

export type EngineOptions<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TTransaction,
> = ReviewRatingsEngineOptions<TActor, TReviewId, TTargetType, TTransaction>
