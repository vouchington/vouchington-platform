export type ReviewAction =
  | 'add-rating'
  | 'create-review'
  | 'delete-rating'
  | 'list-ratings'
  | 'list-reviews'
  | 'update-rating'
  | 'update-review'

export interface ReviewTarget<TTargetType extends string = string> {
  readonly id: string
  readonly type: TTargetType
}

export interface ReviewRating<TTargetType extends string = string> {
  readonly order: number
  readonly rating: number
  readonly target: ReviewTarget<TTargetType>
}

export interface CreateReviewRatingInput<
  TTargetType extends string = string,
> extends ReviewRating<TTargetType> {}

export interface CreateReviewInput<TCreate, TTargetType extends string = string> {
  readonly ratings: readonly CreateReviewRatingInput<TTargetType>[]
  readonly review: TCreate
}

export interface UpdateReviewRatingInput<TTargetType extends string = string> {
  readonly changes: { readonly order?: number; readonly rating?: number }
  readonly target: ReviewTarget<TTargetType>
}

export interface ReviewRatingScale {
  readonly maximum: number
  readonly minimum: number
}

export interface ReviewRatingCount {
  readonly maximum: number
  readonly minimum: number
}

export interface ReviewAuthorizationInput<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
> {
  readonly action: ReviewAction
  readonly actor: TActor
  readonly reviewId?: TReviewId
  readonly target?: ReviewTarget<TTargetType>
}

export interface ReviewEligibilityInput<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
> extends ReviewAuthorizationInput<TActor, TReviewId, TTargetType> {
  readonly reviewId: TReviewId
  readonly target: ReviewTarget<TTargetType>
}

export interface ReviewDeletionInput<TTargetType extends string = string> {
  readonly ratings: readonly ReviewRating<TTargetType>[]
  readonly target: ReviewTarget<TTargetType>
}

export interface ReviewsPolicy<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TTransaction,
> {
  readonly canDelete: (input: ReviewDeletionInput<TTargetType>) => boolean | Promise<boolean>
  readonly comparison: (ratings: readonly ReviewRating<TTargetType>[]) => boolean | Promise<boolean>
  readonly count: ReviewRatingCount
  readonly isTargetEligible: (
    input: ReviewEligibilityInput<TActor, TReviewId, TTargetType>,
    transaction: TTransaction,
  ) => boolean | Promise<boolean>
  readonly rating: ReviewRatingScale
  readonly targetTypes: readonly TTargetType[]
}

export interface ReviewsRepository<
  TReviewId extends string,
  TTargetType extends string,
  TTransaction,
> {
  readonly addRating: (
    reviewId: TReviewId,
    input: CreateReviewRatingInput<TTargetType>,
    transaction: TTransaction,
  ) => Promise<ReviewRating<TTargetType>>
  readonly deleteRating: (
    reviewId: TReviewId,
    target: ReviewTarget<TTargetType>,
    transaction: TTransaction,
  ) => Promise<ReviewRating<TTargetType> | null>
  readonly listRatings: (
    reviewId: TReviewId,
    transaction: TTransaction,
  ) => Promise<readonly ReviewRating<TTargetType>[]>
  /** Locks the stable review row/key and reports whether the review exists. */
  readonly lockReview: (reviewId: TReviewId, transaction: TTransaction) => Promise<boolean>
  readonly transaction: <TResult>(
    work: (transaction: TTransaction) => Promise<TResult>,
  ) => Promise<TResult>
  readonly updateRating: (
    reviewId: TReviewId,
    input: UpdateReviewRatingInput<TTargetType>,
    transaction: TTransaction,
  ) => Promise<ReviewRating<TTargetType> | null>
}

export interface ReviewLifecycleRepository<
  TActor,
  TReviewId extends string,
  TCreate,
  TUpdate,
  TListQuery,
  TReview,
  TListResult,
  TTransaction,
> {
  readonly createReview: (
    actor: TActor,
    input: TCreate,
    transaction: TTransaction,
  ) => Promise<TReview>
  readonly getReviewId: (review: TReview) => TReviewId
  readonly listReviews: (
    actor: TActor,
    query: TListQuery,
    transaction: TTransaction,
  ) => Promise<TListResult>
  readonly updateReview: (
    actor: TActor,
    reviewId: TReviewId,
    input: TUpdate,
    transaction: TTransaction,
  ) => Promise<TReview | null>
}
