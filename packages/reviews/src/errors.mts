export type ReviewsErrorCode =
  | 'comparison-rejected'
  | 'duplicate-target'
  | 'final-deletion-rejected'
  | 'invalid-count-policy'
  | 'invalid-order'
  | 'invalid-rating'
  | 'invalid-rating-policy'
  | 'invalid-review-id'
  | 'invalid-target'
  | 'invalid-target-types'
  | 'rating-count-rejected'
  | 'rating-not-found'
  | 'review-not-found'
  | 'target-not-eligible'
  | 'target-type-not-allowed'

export class ReviewsError extends Error {
  readonly code: ReviewsErrorCode

  constructor(code: ReviewsErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ReviewsError'
    this.code = code
  }
}
