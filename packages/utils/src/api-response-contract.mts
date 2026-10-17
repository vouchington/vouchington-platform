/** Compiler-discovered variants carried by an opaque response without reading its body. */
export type ApiHttpResponseVariant =
  | { status: number; bodyKind: 'content'; mediaType: string; body: unknown }
  | { status: number; bodyKind: 'none' }

export type ApiHttpResponse<TVariants extends ApiHttpResponseVariant> = Response & {
  readonly apiHttpResponseVariants?: TVariants
}

/** Adds JSON Schema array constraints to a statically extracted API request contract. */
export type ApiArrayContract<
  TItem,
  _TMinItems extends number,
  _TMaxItems extends number,
  _TUniqueItems extends boolean,
> = TItem[]

export interface ApiHeader {
  description?: string
  format?: 'uuid'
  required?: boolean
  type: 'integer' | 'string'
}

export interface ApiHeaderContract {
  request?: Readonly<Record<string, ApiHeader>>
  responses?: Readonly<
    Record<
      number,
      {
        description?: string
        errors?: readonly { code: string; message: string }[]
        headers?: Readonly<Record<string, ApiHeader>>
      }
    >
  >
}

/** A named event and its canonical payload, before SSE wire framing. */
export interface ApiSseEvent<TName extends string = string, TData = unknown> {
  event: TName
  data: TData
}

/*
 * Identity markers read by a static (TypeScript compiler) contract extractor. None of them change
 * the runtime payload; the string key names the operation in the extracted contract.
 */

/** Marks an HTTP response body as a shared API fixture contract. */
export function apiResponse<const TKey extends string, TBody>(_key: TKey, body: TBody): TBody {
  return body
}

/** Marks a request body as a shared API fixture contract. */
export function apiRequest<const TKey extends string, TBody>(_key: TKey, body: TBody): TBody {
  return body
}

/** Marks a fixture-backed response that intentionally has no response body. */
export function apiNoContent<const TKey extends string>(_key: TKey): void {
  return undefined
}

/** Documents a helper-emitted fixed-status bodyless response for OpenAPI discovery only. */
export function apiOpenApiNoContent<const TKey extends string>(_key: TKey, _status: number): void {
  return undefined
}

/** Documents a fixed-media raw response for OpenAPI discovery without changing the payload. */
export function apiOpenApiRawResponse<const TKey extends string, TBody>(
  _key: TKey,
  _mediaType: string,
  body: TBody,
): TBody {
  return body
}

/** Marks a request schema without constructing a runtime body. */
export function apiRequestContract<const TKey extends string, TBody>(
  _key: TKey,
): TBody | undefined {
  return undefined
}

/** Marks a route that intentionally reads no meaningful request body. */
export function apiNoRequestBody<const TKey extends string>(_key: TKey): void {
  return undefined
}

/**
 * Marks the query contract for one operation. Sources are opaque here; applications that need
 * compile-time carrier validation re-declare this with their own constrained signature.
 */
export function apiQuery<const TKey extends string, const TSources extends readonly unknown[]>(
  _key: TKey,
  ..._sources: TSources
): void {
  return undefined
}

/** Marks request and response headers for OpenAPI discovery (documentation only). */
export function apiHeaders<const TKey extends string>(
  _key: TKey,
  _contract: ApiHeaderContract,
): void {
  return undefined
}

/** Formats an SSE frame and exposes its payload to the compiler. */
export function apiSseFrame<const TKey extends string, const TEvent extends ApiSseEvent>(
  _key: TKey,
  event: TEvent,
): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`
}

/** Annotates SDK response variants while preserving status, headers, bytes and body ownership. */
export function apiOpenApiHttpResponse<
  const TKey extends string,
  TVariants extends ApiHttpResponseVariant,
>(_key: TKey, response: ApiHttpResponse<TVariants>): ApiHttpResponse<TVariants> {
  return response
}
