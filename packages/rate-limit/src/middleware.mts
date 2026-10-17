import type { Application, Context } from '@jongleberry/api-server'

import { applyRateLimitResult } from './headers.mts'
import type { RateLimitIdentities, RouteRateLimitResult } from './types.mts'

/** Caller-defined per-request inputs (e.g. an email or explicit tokens) passed to `resolveIdentities`. */
export type RouteRateLimitExtras = Readonly<Record<string, unknown>>

/**
 * The limiter step's outcome, held until `settleRouteRateLimit` applies it. `null` means the
 * limiter is disabled, so nothing is applied or metered.
 */
export type RouteRateLimitCheck<TSubject = unknown> = {
  result: RouteRateLimitResult
  subject: TSubject
} | null

declare module '@jongleberry/api-server' {
  interface Context {
    /** Prepares and settles the route limit: headers, 429, then the `onSettled` hook. */
    applyRouteRateLimit(routeKey: string, extras?: RouteRateLimitExtras): Promise<void>
    /** Charges the limiter but sets no headers and throws no 429, so it can overlap other I/O. */
    prepareRouteRateLimit(
      routeKey: string,
      extras?: RouteRateLimitExtras,
    ): Promise<RouteRateLimitCheck>
    /** Applies the prepared result (headers/429), then runs the `onSettled` hook. */
    settleRouteRateLimit(routeKey: string, check: RouteRateLimitCheck): Promise<void>
  }
}

export interface RouteRateLimitMiddlewareOptions<TSubject> {
  /** When this returns false the limiter is skipped entirely. Defaults to always enabled. */
  isEnabled?: (() => boolean) | undefined
  /** Resolves identities for the request. `subject` is passed through to `onSettled`. */
  resolveIdentities(
    ctx: Context,
    routeKey: string,
    extras: RouteRateLimitExtras | undefined,
  ): Promise<{ identities: RateLimitIdentities; subject: TSubject }>
  check(routeKey: string, identities: RateLimitIdentities): Promise<RouteRateLimitResult>
  /** Runs after headers/429 are applied, e.g. to meter usage for the resolved subject. */
  onSettled?:
    | ((ctx: Context, routeKey: string, subject: TSubject) => Promise<void> | void)
    | undefined
  /** 429 message. */
  message?: string
}

/** Adds `applyRouteRateLimit`, `prepareRouteRateLimit`, and `settleRouteRateLimit` to the context. */
export function installRouteRateLimit<TSubject>(
  app: Application,
  options: RouteRateLimitMiddlewareOptions<TSubject>,
): void {
  const messageOptions = options.message === undefined ? {} : { message: options.message }
  app.extend({
    async applyRouteRateLimit(
      this: Context,
      routeKey: string,
      extras?: RouteRateLimitExtras,
    ): Promise<void> {
      await this.settleRouteRateLimit(routeKey, await this.prepareRouteRateLimit(routeKey, extras))
    },

    async prepareRouteRateLimit(
      this: Context,
      routeKey: string,
      extras?: RouteRateLimitExtras,
    ): Promise<RouteRateLimitCheck<TSubject>> {
      if (options.isEnabled && !options.isEnabled()) return null
      const { identities, subject } = await options.resolveIdentities(this, routeKey, extras)
      return { result: await options.check(routeKey, identities), subject }
    },

    async settleRouteRateLimit(
      this: Context,
      routeKey: string,
      check: RouteRateLimitCheck<TSubject>,
    ): Promise<void> {
      if (!check) return
      applyRateLimitResult(this, check.result, messageOptions)
      await options.onSettled?.(this, routeKey, check.subject)
    },
  })
}
