import type { Context } from '@jongleberry/api-server'

import type {
  LifecycleReviewRouteOptions,
  ReviewRouteOptions,
  ReviewRouteResult,
} from './route-types.mts'
import { assertRoutes } from './route-validation.mts'

export function registerReviewRoutes<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TCreate,
  TUpdate,
  TListQuery,
  TReview,
  TListResult,
>(
  options: ReviewRouteOptions<
    TActor,
    TReviewId,
    TTargetType,
    TCreate,
    TUpdate,
    TListQuery,
    TReview,
    TListResult
  >,
): void {
  assertRoutes(options)
  if (options.ratings !== undefined) registerRatingRoutes(options)
  if (options.lifecycle !== undefined) registerLifecycleRoutes(options)
}

function registerRatingRoutes<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TCreate,
  TUpdate,
  TListQuery,
  TReview,
  TListResult,
>(
  options: ReviewRouteOptions<
    TActor,
    TReviewId,
    TTargetType,
    TCreate,
    TUpdate,
    TListQuery,
    TReview,
    TListResult
  >,
): void {
  const { codecs, paths } = options.ratings!
  options.routes.route(paths.list).get(
    handler(options, async (context) => {
      const input = await codecs.list(context)
      return {
        action: 'list-ratings',
        value: await options.engine.listRatings(input.actor, input.reviewId),
      }
    }),
  )
  options.routes.route(paths.add).post(
    handler(options, async (context) => {
      const input = await codecs.add(context)
      return {
        action: 'add-rating',
        value: await options.engine.addRating(input.actor, input.reviewId, input.input),
      }
    }),
  )
  options.routes.route(paths.update).patch(
    handler(options, async (context) => {
      const input = await codecs.update(context)
      return {
        action: 'update-rating',
        value: await options.engine.updateRating(input.actor, input.reviewId, input.input),
      }
    }),
  )
  options.routes.route(paths.delete).delete(
    handler(options, async (context) => {
      const input = await codecs.delete(context)
      return {
        action: 'delete-rating',
        value: await options.engine.deleteRating(input.actor, input.reviewId, input.target),
      }
    }),
  )
}

function registerLifecycleRoutes<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TCreate,
  TUpdate,
  TListQuery,
  TReview,
  TListResult,
>(
  options: LifecycleReviewRouteOptions<
    TActor,
    TReviewId,
    TTargetType,
    TCreate,
    TUpdate,
    TListQuery,
    TReview,
    TListResult
  >,
): void {
  const { codecs, paths } = options.lifecycle!
  options.routes.route(paths.list).get(
    handler(options, async (context) => {
      const input = await codecs.list(context)
      return {
        action: 'list-reviews',
        value: await options.engine.listReviews(input.actor, input.query),
      }
    }),
  )
  options.routes.route(paths.create).post(
    handler(options, async (context) => {
      const input = await codecs.create(context)
      return {
        action: 'create-review',
        value: await options.engine.createReview(input.actor, input.input),
      }
    }),
  )
  options.routes.route(paths.update).patch(
    handler(options, async (context) => {
      const input = await codecs.update(context)
      return {
        action: 'update-review',
        value: await options.engine.updateReview(input.actor, input.reviewId, input.input),
      }
    }),
  )
}

function handler<
  TActor,
  TReviewId extends string,
  TTargetType extends string,
  TCreate,
  TUpdate,
  TListQuery,
  TReview,
  TListResult,
>(
  options: ReviewRouteOptions<
    TActor,
    TReviewId,
    TTargetType,
    TCreate,
    TUpdate,
    TListQuery,
    TReview,
    TListResult
  >,
  execute: (context: Context) => Promise<ReviewRouteResult<unknown>>,
): (context: Context) => Promise<void> {
  return async (context) => {
    try {
      await options.respond(context, await execute(context))
    } catch (error) {
      await options.mapError(context, error)
    }
  }
}
