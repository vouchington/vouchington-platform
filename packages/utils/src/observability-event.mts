import { dropRequestBody, dropSpanRequestBody } from './observability-body.mts'
import {
  scrubCredentialHeaders,
  scrubRequestCredentialFields,
  scrubSpanCredentialAttributes,
} from './observability-credentials.mts'
import {
  scrubHeaderUrls,
  scrubRequestUrlFields,
  scrubSpanUrlAttributes,
  type UrlScrubOptions,
} from './observability-url.mts'

export interface ScrubOptions extends UrlScrubOptions {
  /** Header names (case-insensitive) whose values are replaced with the filtered marker. */
  credentialHeaders: readonly string[]
  /** Also drop `request.data` and the `http.request.body.data` attribute. Defaults to false. */
  dropRequestBody?: boolean
}

/** Structural subset of an SDK event; no SDK type is imported. */
export interface ObservableEvent {
  [key: string]: unknown
  breadcrumbs?: Array<{ data?: Record<string, unknown> }>
  request?: object
}

export function scrubHeaders(
  headers: Record<string, unknown>,
  credentialHeaders: readonly string[],
  redactUrl?: (url: string) => string,
): Record<string, unknown> {
  const urlScrubbed = scrubHeaderUrls(headers, redactUrl ? { redactUrl } : {})
  return scrubCredentialHeaders(urlScrubbed, credentialHeaders)
}

export function scrubSpanAttributes<T extends Record<string, unknown>>(
  data: T,
  options: ScrubOptions,
): T {
  const scrubbed = scrubSpanCredentialAttributes(
    scrubSpanUrlAttributes(data, options),
    options.credentialHeaders,
  )
  return options.dropRequestBody ? dropSpanRequestBody(scrubbed) : scrubbed
}

export function scrubRequest<T extends object>(
  request: T | undefined,
  options: ScrubOptions,
): T | undefined {
  const scrubbed = scrubRequestCredentialFields(
    scrubRequestUrlFields(request, options),
    options.credentialHeaders,
  )
  return options.dropRequestBody ? dropRequestBody(scrubbed) : scrubbed
}

/** Scrub each breadcrumb's `data`; the input array is returned when nothing changed. */
export function scrubBreadcrumbs<T extends { data?: Record<string, unknown> }>(
  breadcrumbs: T[] | undefined,
  options: ScrubOptions,
): T[] | undefined {
  if (!breadcrumbs?.length) return breadcrumbs
  const result = breadcrumbs.map((breadcrumb) => {
    if (typeof breadcrumb.data !== 'object' || breadcrumb.data === null) return breadcrumb
    const data = scrubSpanAttributes(breadcrumb.data, options)
    return data === breadcrumb.data ? breadcrumb : { ...breadcrumb, data }
  })
  return result.some((breadcrumb, index) => breadcrumb !== breadcrumbs[index])
    ? result
    : breadcrumbs
}

/** Scrub an event's request and breadcrumbs; the input event is returned when nothing changed. */
export function scrubEvent<T extends ObservableEvent>(event: T, options: ScrubOptions): T {
  const request = scrubRequest(event.request, options)
  const breadcrumbs = scrubBreadcrumbs(event.breadcrumbs, options)
  if (request === event.request && breadcrumbs === event.breadcrumbs) return event
  return {
    ...event,
    ...(request === event.request ? {} : { request }),
    ...(breadcrumbs === event.breadcrumbs ? {} : { breadcrumbs }),
  }
}

type BeforeSendResult<T> = T | null | PromiseLike<T | null>

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  return typeof (value as { then?: unknown }).then === 'function'
}

/**
 * Wrap an SDK `beforeSend` so its result (sync or async, including foreign-realm thenables) always
 * passes through a final scrubber. Pass `ScrubOptions` to use {@link scrubEvent}, or a function.
 */
export function composeBeforeSend<T extends ObservableEvent, THint>(
  beforeSend: ((event: T, hint: THint) => BeforeSendResult<T>) | undefined,
  scrubber: ScrubOptions | ((event: T) => T),
): (event: T, hint: THint) => BeforeSendResult<T> {
  const finalScrub = typeof scrubber === 'function' ? scrubber : (e: T) => scrubEvent(e, scrubber)
  return (event, hint) => {
    const result = beforeSend ? beforeSend(event, hint) : event
    if (isPromiseLike<T | null>(result))
      return Promise.resolve(result).then((next) => (next === null ? null : finalScrub(next)))
    return result === null ? null : finalScrub(result)
  }
}
