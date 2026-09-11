export const DEFAULT_LOCALIZATION_BOUNDS = {
  maxLocales: 8,
  maxSelectors: 32,
  maxMessages: 2000,
  maxBytes: 512 * 1024,
} as const

export class LocalizationBoundError extends RangeError {
  readonly code = 'LOCALIZATION_BOUNDS'
}
