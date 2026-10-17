import { scrubSpanAttributes, type ScrubOptions } from '@vouchington/utils/observability'

/** Build a `beforeSendSpan` that scrubs span attributes; unchanged spans are returned as-is. */
export function createSpanScrubber(
  options: ScrubOptions,
): <T extends { attributes: Record<string, unknown> }>(span: T) => T {
  return (span) => {
    const attributes = scrubSpanAttributes(span.attributes, options)
    return attributes === span.attributes ? span : { ...span, attributes }
  }
}
