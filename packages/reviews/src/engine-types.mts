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

export interface ReviewRatingPostCommitEvent<TReviewId extends string, TTargetType extends string> {
  readonly action: 'add-rating' | 'delete-rating' | 'update-rating'
  readonly rating: ReviewRating<TTargetType>
  readonly reviewId: TReviewId
}

export type ReviewPostCommitEvent<TReviewId extends string, TTargetType extends string, TReview> =
  | ReviewRatingPostCommitEvent<TReviewId, TTargetType>
  | {
      readonly action: 'create-review' | 'update-review'
      readonly review: TReview
      readonly reviewId: TReviewId
    }

export interface ReviewRatingsEngineOptions<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TTransaction,
> {
  readonly authorize: (
    input: ReviewAuthorizationInput<TActor, TReviewId, TTargetType>,
    transaction: TTransaction,
  ) => Promise<void> | void
  readonly onPostCommit: (
    event: ReviewRatingPostCommitEvent<TReviewId, TTargetType>,
  ) => Promise<void> | void
  readonly policy: ReviewsPolicy<TActor, TReviewId, TTargetType, TTransaction>
  readonly repository: ReviewsRepository<TReviewId, TTargetType, TTransaction>
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
> extends ReviewRatingsEngine<TActor, TReviewId, TTargetType> {
  createReview(actor: TActor, input: CreateReviewInput<TCreate, TTargetType>): Promise<TReview>
  listReviews(actor: TActor, query: TListQuery): Promise<TListResult>
  updateReview(actor: TActor, reviewId: TReviewId, input: TUpdate): Promise<TReview>
}

export interface ReviewRatingsEngine<TActor, TReviewId extends string, TTargetType extends string> {
  addRating(
    actor: TActor,
    reviewId: TReviewId,
    input: CreateReviewRatingInput<TTargetType>,
  ): Promise<ReviewRating<TTargetType>>
  deleteRating(
    actor: TActor,
    reviewId: TReviewId,
    target: ReviewTarget<TTargetType>,
  ): Promise<ReviewRating<TTargetType>>
  listRatings(actor: TActor, reviewId: TReviewId): Promise<readonly ReviewRating<TTargetType>[]>
  updateRating(
    actor: TActor,
    reviewId: TReviewId,
    input: UpdateReviewRatingInput<TTargetType>,
  ): Promise<ReviewRating<TTargetType>>
}
