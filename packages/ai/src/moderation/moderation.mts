/** The text or image parts a moderation endpoint accepts. */
export type ModerationInputPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/** The fields of a moderation result this module reads. */
export type ModerationResultLike = { flagged: boolean; categories: Record<string, boolean> }

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
