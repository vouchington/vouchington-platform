import { ReportValidationError } from './types.mts'
import type { ReportDraft } from './types.mts'

export interface ReportInputConfig<TType extends string, TId, TReason extends string> {
  targetTypes: readonly TType[]
  reasons: readonly TReason[]
  parseTargetId(value: string): TId | null
  maxNoteLength: number
  validate?(draft: ReportDraft<TType, TId, TReason>): void
}

export interface RawReportInput {
  targetType?: unknown
  targetId?: unknown
  reason?: unknown
  note?: unknown
}

export interface ReportInputParser<TType extends string, TId, TReason extends string> {
  parse(raw: RawReportInput): ReportDraft<TType, TId, TReason>
  readonly targetTypes: readonly TType[]
  readonly reasons: readonly TReason[]
}

export function createReportInputParser<TType extends string, TId, TReason extends string>(
  config: ReportInputConfig<TType, TId, TReason>,
): ReportInputParser<TType, TId, TReason> {
  const targetTypes = readonlyCatalog(config.targetTypes, 'targetTypes')
  const reasons = readonlyCatalog(config.reasons, 'reasons')
  if (!Number.isSafeInteger(config.maxNoteLength) || config.maxNoteLength < 0)
    throw new TypeError('maxNoteLength must be a non-negative safe integer')

  return {
    targetTypes,
    reasons,
    parse(raw) {
      const targetType = enumValue(
        raw.targetType,
        targetTypes,
        'invalid_target_type',
        'target type',
      )
      if (typeof raw.targetId !== 'string')
        invalid('invalid_target_identifier', 'target identifier')
      const targetId = config.parseTargetId(raw.targetId)
      if (targetId === null) invalid('invalid_target_identifier', 'target identifier')
      const reason = enumValue(raw.reason, reasons, 'invalid_reason', 'reason')
      if (raw.note !== undefined && raw.note !== null && typeof raw.note !== 'string')
        invalid('invalid_note', 'note')
      if (typeof raw.note === 'string' && raw.note.length > config.maxNoteLength)
        throw new ReportValidationError('note_too_long', 'Note is too long')
      const note = typeof raw.note === 'string' ? raw.note.trim() || null : null
      const draft = { target: { type: targetType, id: targetId }, reason, note }
      config.validate?.(draft)
      return draft
    },
  }
}

function readonlyCatalog<T extends string>(values: readonly T[], name: string): readonly T[] {
  if (
    values.length === 0 ||
    values.some((value) => typeof value !== 'string' || value.length === 0)
  )
    throw new TypeError(`${name} must contain non-empty strings`)
  return Object.freeze([...new Set(values)])
}

function enumValue<T extends string>(
  value: unknown,
  catalog: readonly T[],
  code: ReportValidationError['code'],
  name: string,
): T {
  if (typeof value !== 'string' || !catalog.includes(value as T)) invalid(code, name)
  return value as T
}

function invalid(code: ReportValidationError['code'], name: string): never {
  throw new ReportValidationError(code, `Invalid ${name}`)
}
