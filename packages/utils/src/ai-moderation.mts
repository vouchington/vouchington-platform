/** The text or image parts a moderation endpoint accepts. */
export type ModerationInputPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/** The fields of a moderation result this module reads. A null category counts as not flagged. */
export type ModerationResultLike = {
  flagged: boolean
  categories: Readonly<Record<string, boolean | null>>
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

/** Names of the categories a result flagged. */
export function getFlaggedCategories(result: ModerationResultLike): string[] {
  return Object.entries(result.categories).flatMap(([category, flagged]) =>
    flagged === true ? [category] : [],
  )
}

/**
 * A violation naming every category flagged by any result, else null. Results line up with the
 * request's inputs, so a later flagged input is never masked by a clean earlier one.
 */
export function checkModerationResults(
  results: readonly ModerationResultLike[],
): MessageSafetyViolation | null {
  const flagged = results.filter((result) => result.flagged)
  if (flagged.length === 0) return null
  const categories = [...new Set(flagged.flatMap(getFlaggedCategories))]
  return { code: 'MODERATION_VIOLATION', categories }
}

/** Common instruction-override and chat-template markers. Callers may pass their own list. */
export const DEFAULT_PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|earlier)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+)?(previous|prior|earlier)\s+(instructions?|prompts?|rules?)/i,
  /forget\s+(all\s+)?(previous|prior|earlier)\s+(instructions?|prompts?|rules?)/i,
  // A chat-template style role prefix at the start of a line, not "operating system: Linux".
  /(?:^|\n)\s*system\s*:/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<system>/i,
  /<\/system>/i,
  // Require "now" to avoid benign phrases like "you are a great help"
  /you\s+are\s+now\s+(a|an)\s+/i,
  // A heading-style "new instructions:" at the start of a line, not "new instructions for the cake".
  /(?:^|\n)\s*new\s+instructions?\s*:/i,
  /override\s+(previous|prior|all)\s+(instructions?|rules?)/i,
]

/** A `PROMPT_INJECTION` violation when any pattern matches the message, else null. */
export function checkPromptInjection(
  message: string,
  patterns: readonly RegExp[] = DEFAULT_PROMPT_INJECTION_PATTERNS,
): MessageSafetyViolation | null {
  const matched = patterns.some((pattern) => {
    // Global and sticky patterns are stateful; test from the start, then leave the caller's regex
    // as it was found.
    const previous = pattern.lastIndex
    pattern.lastIndex = 0
    const result = pattern.test(message)
    pattern.lastIndex = previous
    return result
  })
  return matched ? { code: 'PROMPT_INJECTION' } : null
}
