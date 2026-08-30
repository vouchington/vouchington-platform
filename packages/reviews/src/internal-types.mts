import type { ReviewsEngineOptions } from './engine-types.mts'

export type EngineOptions<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TTransaction,
  TCreate,
  TUpdate,
  TListQuery,
  TReview,
  TListResult,
> = ReviewsEngineOptions<
  TActor,
  TReviewId,
  TTargetType,
  TTransaction,
  TCreate,
  TUpdate,
  TListQuery,
  TReview,
  TListResult
>
