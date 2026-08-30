import type { ReviewRouteOptions } from './route-types.mts'

export function assertRoutes<
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
  const entries: Array<readonly [string, string]> = []
  if (options.ratings !== undefined) {
    const { add, delete: remove, list, update } = options.ratings.paths
    entries.push(['GET', list], ['POST', add], ['PATCH', update], ['DELETE', remove])
  }
  if (options.lifecycle !== undefined) {
    const { create, list, update } = options.lifecycle.paths
    entries.push(['GET', list], ['POST', create], ['PATCH', update])
  }
  if (entries.some(([, path]) => typeof path !== 'string' || path.trim() === ''))
    throw new TypeError('Review route paths must be non-empty strings.')
  const keys = entries.map(([method, path]) => `${method}\u0000${path}`)
  if (new Set(keys).size !== keys.length)
    throw new TypeError('Review route method and path pairs must be distinct.')
}
