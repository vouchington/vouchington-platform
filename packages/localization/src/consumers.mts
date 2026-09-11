import {
  LOCALIZATION_CONSUMERS,
  PUBLIC_LOCALIZATION_CONSUMERS,
  type LocalizationConsumer,
  type PublicLocalizationConsumer,
} from './types.mts'

export function isLocalizationConsumer(value: string): value is LocalizationConsumer {
  return (LOCALIZATION_CONSUMERS as readonly string[]).includes(value)
}

export function isPublicLocalizationConsumer(value: string): value is PublicLocalizationConsumer {
  return (PUBLIC_LOCALIZATION_CONSUMERS as readonly string[]).includes(value)
}

export function assertLocalizationConsumer(value: string): LocalizationConsumer {
  if (!isLocalizationConsumer(value)) {
    throw new TypeError(`Unknown localization consumer "${value}"`)
  }
  return value
}

export function assertPublicLocalizationConsumer(value: string): PublicLocalizationConsumer {
  const consumer = assertLocalizationConsumer(value)
  if (!isPublicLocalizationConsumer(consumer)) {
    throw new TypeError(`Localization consumer "${value}" is not public`)
  }
  return consumer
}

export function uniqueConsumers(values: readonly string[]): readonly LocalizationConsumer[] {
  const seen = new Set<LocalizationConsumer>()
  for (const value of values) seen.add(assertLocalizationConsumer(value))
  return LOCALIZATION_CONSUMERS.filter((consumer) => seen.has(consumer))
}
