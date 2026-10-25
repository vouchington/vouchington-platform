import { brandedHasInstance, hasBrand } from '../providers/brand.mts'
import type { OpenAIUsageLike } from '../providers/usage.mts'

/** The fields of a Responses API response this module reads. */
export type OpenAIResponseShape = {
  id?: string
  status?: string | null
  model?: string
  service_tier?: string | null
  usage?: OpenAIUsageLike | null
  error?: { code?: string | null; message?: string | null } | null
  incomplete_details?: { reason?: string | null } | null
  output: ReadonlyArray<{ type: string; content?: ReadonlyArray<{ type: string; text?: string }> }>
}

/** Brands shared by every copy of this package, so errors are recognized across module copies. */
export const OPENAI_RESPONSE_NOT_COMPLETED_ERROR_BRAND = Symbol.for(
  '@vouchington/ai/OpenAIResponseNotCompletedError',
)
export const OPENAI_RESPONSE_STREAM_ITERATION_ERROR_BRAND = Symbol.for(
  '@vouchington/ai/OpenAIResponseStreamIterationError',
)

/** Recognizes an `OpenAIResponseNotCompletedError` from any installed copy of the package. */
export function isOpenAIResponseNotCompletedError(
  value: unknown,
): value is OpenAIResponseNotCompletedError {
  return hasBrand(value, OPENAI_RESPONSE_NOT_COMPLETED_ERROR_BRAND)
}

/** Recognizes an `OpenAIResponseStreamIterationError` from any installed copy of the package. */
export function isOpenAIResponseStreamIterationError(
  value: unknown,
): value is OpenAIResponseStreamIterationError {
  return hasBrand(value, OPENAI_RESPONSE_STREAM_ITERATION_ERROR_BRAND)
}

/**
 * A terminal-but-not-completed response (failed, incomplete, or another status). The provider
 * still bills tokens for these (e.g. hitting `max_output_tokens`), so the usage, model, and service
 * tier the response carried are attached for the caller's ledger. `instanceof` works across
 * package copies because it checks the shared brand.
 */
export class OpenAIResponseNotCompletedError extends Error {
  static [Symbol.hasInstance](this: unknown, value: unknown): boolean {
    return brandedHasInstance(
      OpenAIResponseNotCompletedError,
      OPENAI_RESPONSE_NOT_COMPLETED_ERROR_BRAND,
      this,
      value,
    )
  }

  readonly [OPENAI_RESPONSE_NOT_COMPLETED_ERROR_BRAND] = true as const
  readonly id: string | undefined
  readonly status: string
  readonly usage: OpenAIUsageLike | undefined
  readonly model: string | undefined
  readonly service_tier: string | undefined
  /** The provider's error taxonomy for a `failed` response (e.g. `server_error`). */
  readonly code: string | undefined
  /** The provider's incomplete-details taxonomy (e.g. `max_output_tokens`). */
  readonly reason: string | undefined

  constructor(message: string, response: OpenAIResponseShape) {
    super(message)
    this.name = 'OpenAIResponseNotCompletedError'
    this.id = response.id || undefined
    this.status = response.status ?? 'missing'
    this.usage = response.usage ?? undefined
    this.model = response.model
    this.service_tier = response.service_tier ?? undefined
    this.code = response.error?.code ?? undefined
    this.reason = response.incomplete_details?.reason ?? undefined
  }
}

/**
 * A response stream that died part-way. `emittedTextDelta` records whether any text had reached
 * the caller: `false` is the signature of upstream weather rather than a consumption defect.
 * `instanceof` works across package copies because it checks the shared brand.
 */
export class OpenAIResponseStreamIterationError extends Error {
  static [Symbol.hasInstance](this: unknown, value: unknown): boolean {
    return brandedHasInstance(
      OpenAIResponseStreamIterationError,
      OPENAI_RESPONSE_STREAM_ITERATION_ERROR_BRAND,
      this,
      value,
    )
  }

  readonly [OPENAI_RESPONSE_STREAM_ITERATION_ERROR_BRAND] = true as const
  readonly emittedTextDelta: boolean

  constructor(emittedTextDelta: boolean, options: { cause: unknown }) {
    const timing = emittedTextDelta
      ? 'after at least one text delta was emitted'
      : 'before any text delta was emitted'
    super(`OpenAI response stream iteration failed ${timing}`, options)
    this.name = 'OpenAIResponseStreamIterationError'
    this.emittedTextDelta = emittedTextDelta
  }
}

export type CompletedOpenAIResponse = {
  id: string
  status: 'completed'
  output: OpenAIResponseShape['output']
  output_text: string
  usage: OpenAIUsageLike | undefined
  model: string | undefined
  service_tier: string | undefined
}

/**
 * Concatenates every `output_text` part of every `message` output item. Stream-sourced responses
 * never carry the SDK's post-processed `output_text`, so it is recomputed here.
 */
export function computeOutputText(output: OpenAIResponseShape['output']): string {
  const texts: string[] = []
  for (const item of output) {
    if (item.type !== 'message') continue
    for (const part of item.content ?? []) {
      if (part.type === 'output_text') texts.push(part.text ?? '')
    }
  }
  return texts.join('')
}

/**
 * Returns the completed response, whose `id` is guaranteed, or throws
 * `OpenAIResponseNotCompletedError` with its usage (also when a completed response has no id).
 */
export function validateCompletedResponse(response: OpenAIResponseShape): CompletedOpenAIResponse {
  if (response.status === 'failed') {
    throw new OpenAIResponseNotCompletedError(
      `OpenAI response failed (${response.error?.code ?? 'unknown'}): ${response.error?.message ?? 'Unknown error'}`,
      response,
    )
  }
  if (response.status === 'incomplete') {
    throw new OpenAIResponseNotCompletedError(
      `OpenAI response incomplete: ${response.incomplete_details?.reason ?? 'unknown reason'}`,
      response,
    )
  }
  if (response.status !== 'completed') {
    throw new OpenAIResponseNotCompletedError(
      `OpenAI response has unsupported status: ${response.status ?? 'missing'}`,
      response,
    )
  }
  if (!response.id) {
    throw new OpenAIResponseNotCompletedError('OpenAI response has no id.', response)
  }
  return {
    id: response.id,
    status: 'completed',
    output: response.output,
    output_text: computeOutputText(response.output),
    usage: response.usage ?? undefined,
    model: response.model,
    service_tier: response.service_tier ?? undefined,
  }
}
