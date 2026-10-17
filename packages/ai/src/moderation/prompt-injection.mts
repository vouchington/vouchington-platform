import type { MessageSafetyViolation } from './moderation.mts'

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
  /new\s+instructions?/i,
  /override\s+(previous|prior|all)\s+(instructions?|rules?)/i,
]

/** A `PROMPT_INJECTION` violation when any pattern matches the message, else null. */
export function checkPromptInjection(
  message: string,
  patterns: readonly RegExp[] = DEFAULT_PROMPT_INJECTION_PATTERNS,
): MessageSafetyViolation | null {
  const matched = patterns.some((pattern) => {
    // Global and sticky patterns are stateful; reset so the result never depends on prior calls.
    pattern.lastIndex = 0
    return pattern.test(message)
  })
  return matched ? { code: 'PROMPT_INJECTION' } : null
}
