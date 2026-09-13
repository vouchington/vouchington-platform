export const DEFAULT_LOCALIZATION_BOUNDS = {
  maxLocales: 8,
  maxSelectors: 64,
  maxMessages: 3000,
  maxBytes: 512 * 1024,
} as const

export class LocalizationBoundError extends RangeError {
  readonly code = 'LOCALIZATION_BOUNDS'
}
