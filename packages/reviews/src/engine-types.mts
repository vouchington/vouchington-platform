import type {
  CreateReviewInput,
  CreateReviewRatingInput,
  ReviewAuthorizationInput,
  ReviewLifecycleRepository,
  ReviewRating,
  ReviewTarget,
  ReviewsPolicy,
  ReviewsRepository,
  UpdateReviewRatingInput,
} from './types.mts'

export type ReviewPostCommitEvent<TReviewId extends string, TTargetType extends string, TReview> =
  | {
      readonly action: 'add-rating' | 'delete-rating' | 'update-rating'
      readonly rating: ReviewRating<TTargetType>
      readonly reviewId: TReviewId
    }
  | {
      readonly action: 'create-review' | 'update-review'
      readonly review: TReview
      readonly reviewId: TReviewId
    }

export interface ReviewsEngineOptions<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TTransaction,
  TCreate,
  TUpdate,
  TListQuery,
  TReview,
  TListResult,
> {
  readonly authorize: (
    input: ReviewAuthorizationInput<TActor, TReviewId, TTargetType>,
    transaction: TTransaction,
  ) => Promise<void> | void
  readonly onPostCommit: (
    event: ReviewPostCommitEvent<TReviewId, TTargetType, TReview>,
  ) => Promise<void> | void
  readonly policy: ReviewsPolicy<TActor, TReviewId, TTargetType, TTransaction>
  readonly repository: ReviewsRepository<TReviewId, TTargetType, TTransaction>
  readonly reviews: ReviewLifecycleRepository<
    TActor,
    TReviewId,
    TCreate,
    TUpdate,
    TListQuery,
    TReview,
    TListResult,
    TTransaction
  >
}

export interface ReviewsEngine<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TCreate,
  TUpdate,
  TListQuery,
  TReview,
  TListResult,
> {
  addRating(
    actor: TActor,
    reviewId: TReviewId,
    input: CreateReviewRatingInput<TTargetType>,
  ): Promise<ReviewRating<TTargetType>>
  createReview(actor: TActor, input: CreateReviewInput<TCreate, TTargetType>): Promise<TReview>
  deleteRating(
    actor: TActor,
    reviewId: TReviewId,
    target: ReviewTarget<TTargetType>,
  ): Promise<ReviewRating<TTargetType>>
  listRatings(actor: TActor, reviewId: TReviewId): Promise<readonly ReviewRating<TTargetType>[]>
  listReviews(actor: TActor, query: TListQuery): Promise<TListResult>
  updateRating(
    actor: TActor,
    reviewId: TReviewId,
    input: UpdateReviewRatingInput<TTargetType>,
  ): Promise<ReviewRating<TTargetType>>
  updateReview(actor: TActor, reviewId: TReviewId, input: TUpdate): Promise<TReview>
}
