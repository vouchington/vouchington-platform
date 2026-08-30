import type { Context } from '@jongleberry/api-server'

import type { ReviewsEngine } from './engine-types.mts'
import type {
  CreateReviewInput,
  CreateReviewRatingInput,
  ReviewAction,
  ReviewTarget,
  UpdateReviewRatingInput,
} from './types.mts'

export interface ReviewRouteRegistrar {
  route(path: string): ReviewRouteMethods
}

export interface ReviewRouteMethods {
  delete(handler: (context: Context) => Promise<void>): unknown
  get(handler: (context: Context) => Promise<void>): unknown
  patch(handler: (context: Context) => Promise<void>): unknown
  post(handler: (context: Context) => Promise<void>): unknown
}

export interface RatingRouteOptions<TActor, TReviewId extends string, TTargetType extends string> {
  readonly codecs: {
    readonly add: (context: Context) => Promise<{
      actor: TActor
      input: CreateReviewRatingInput<TTargetType>
      reviewId: TReviewId
    }>
    readonly delete: (context: Context) => Promise<{
      actor: TActor
      reviewId: TReviewId
      target: ReviewTarget<TTargetType>
    }>
    readonly list: (context: Context) => Promise<{ actor: TActor; reviewId: TReviewId }>
    readonly update: (context: Context) => Promise<{
      actor: TActor
      input: UpdateReviewRatingInput<TTargetType>
      reviewId: TReviewId
    }>
  }
  readonly paths: {
    readonly add: string
    readonly delete: string
    readonly list: string
    readonly update: string
  }
}

export interface LifecycleRouteOptions<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TCreate,
  TUpdate,
  TListQuery,
> {
  readonly codecs: {
    readonly create: (context: Context) => Promise<{
      actor: TActor
      input: CreateReviewInput<TCreate, TTargetType>
    }>
    readonly list: (context: Context) => Promise<{ actor: TActor; query: TListQuery }>
    readonly update: (context: Context) => Promise<{
      actor: TActor
      input: TUpdate
      reviewId: TReviewId
    }>
  }
  readonly paths: { readonly create: string; readonly list: string; readonly update: string }
}

export interface ReviewRouteResult<TValue> {
  readonly action: ReviewAction
  readonly value: TValue
}

export interface ReviewRouteOptions<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TCreate,
  TUpdate,
  TListQuery,
  TReview,
  TListResult,
> {
  readonly engine: ReviewsEngine<
    TActor,
    TReviewId,
    TTargetType,
    TCreate,
    TUpdate,
    TListQuery,
    TReview,
    TListResult
  >
  readonly lifecycle?: LifecycleRouteOptions<
    TActor,
    TReviewId,
    TTargetType,
    TCreate,
    TUpdate,
    TListQuery
  >
  readonly mapError: (context: Context, error: unknown) => Promise<void> | void
  readonly ratings?: RatingRouteOptions<TActor, TReviewId, TTargetType>
  readonly respond: (context: Context, result: ReviewRouteResult<unknown>) => Promise<void> | void
  readonly routes: ReviewRouteRegistrar
}
