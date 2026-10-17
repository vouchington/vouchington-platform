/** The text or image parts a moderation endpoint accepts. */
export type ModerationInputPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/** The fields of a moderation result this module reads. */
export type ModerationResultLike = { flagged: boolean; categories: Record<string, boolean> }

export type ModerationCreate<R> = (
  params: { input: ModerationInputPart[]; model: string },
  options?: { maxRetries: number; timeout: number; signal: AbortSignal },
) => PromiseLike<{ results: R[] }>

export type SafetyCheckLimits = {
  attemptTimeoutMs: number
  overallTimeoutMs: number
  maxRetries: number
}

/** Latency-bounded defaults for an interactive safety check. */
export const DEFAULT_SAFETY_CHECK_LIMITS: SafetyCheckLimits = {
  attemptTimeoutMs: 5_000,
  overallTimeoutMs: 10_000,
  maxRetries: 1,
}

export type MessageSafetyViolation =
  | { code: 'PROMPT_INJECTION' }
  | { code: 'MODERATION_VIOLATION'; categories: string[] }

/** Text first, then images, in the order given. */
export function buildModerationInput(
  texts: readonly string[],
  imageUrls: readonly string[] = [],
): ModerationInputPart[] {
  return [
    ...texts.map((text) => ({ type: 'text' as const, text })),
    ...imageUrls.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
  ]
}

/**
 * One moderation call through an injected `create`. With `apiSafetyCheck` the call is bounded by
 * per-attempt and overall timeouts and a retry budget; otherwise the client's defaults apply.
 * Metrics, errors, and sequencing stay with the caller.
 */
export async function requestModeration<R>(
  create: ModerationCreate<R>,
  input: ModerationInputPart[],
  model: string,
  options: { apiSafetyCheck?: boolean; limits?: SafetyCheckLimits } = {},
): Promise<R[]> {
  const limits = options.limits ?? DEFAULT_SAFETY_CHECK_LIMITS
  const requestOptions = options.apiSafetyCheck
    ? {
        maxRetries: limits.maxRetries,
        timeout: limits.attemptTimeoutMs,
        signal: AbortSignal.timeout(limits.overallTimeoutMs),
      }
    : undefined
  const response = await create({ input, model }, requestOptions)
  return response.results
}

/** Names of the categories a result flagged. */
export function getFlaggedCategories(result: ModerationResultLike): string[] {
  return Object.entries(result.categories).flatMap(([category, flagged]) =>
    flagged ? [category] : [],
  )
}

/** A violation for the first result when it is flagged, else null (no results is not a violation). */
export function checkModerationResults(
  results: readonly ModerationResultLike[],
): MessageSafetyViolation | null {
  const [result] = results
  if (!result?.flagged) return null
  return { code: 'MODERATION_VIOLATION', categories: getFlaggedCategories(result) }
}
