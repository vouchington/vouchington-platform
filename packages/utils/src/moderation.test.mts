import { describe, expect, it, vi } from 'vitest'

import { createReportInputParser, ReportValidationError } from './moderation.mts'

describe('createReportInputParser', () => {
  it('parses configured values, normalizes notes, and preserves immutable catalogs', () => {
    const validate = vi.fn((draft: { target: { type: string }; reason: string }) => {
      if (draft.target.type === 'entry' && draft.reason === 'unsafe')
        throw new Error('incompatible')
    })
    const parser = createReportInputParser({
      targetTypes: ['entry', 'account'] as const,
      reasons: ['incorrect', 'unsafe'] as const,
      parseTargetId: (value) => (value.startsWith('id-') ? value : null),
      maxNoteLength: 5,
      validate,
    })

    expect(
      parser.parse({ targetType: 'entry', targetId: 'id-1', reason: 'incorrect', note: ' hi ' }),
    ).toEqual({ target: { type: 'entry', id: 'id-1' }, reason: 'incorrect', note: 'hi' })
    expect(
      parser.parse({ targetType: 'entry', targetId: 'id-1', reason: 'incorrect', note: ' ' }).note,
    ).toBeNull()
    expect(
      parser.parse({ targetType: 'account', targetId: 'id-2', reason: 'unsafe' }).note,
    ).toBeNull()
    expect(() => parser.parse({ targetType: 'entry', targetId: 'id-1', reason: 'unsafe' })).toThrow(
      'incompatible',
    )
    expect(validate).toHaveBeenCalledTimes(4)
    expect(Object.isFrozen(parser.targetTypes)).toBe(true)
    expect(Object.isFrozen(parser.reasons)).toBe(true)
  })

  it('rejects malformed inputs with typed validation errors', () => {
    const parser = createReportInputParser({
      targetTypes: ['entry'] as const,
      reasons: ['incorrect'] as const,
      parseTargetId: (value) => (value === 'valid' ? value : null),
      maxNoteLength: 1,
    })

    for (const [raw, code] of [
      [{ targetType: 'other', targetId: 'valid', reason: 'incorrect' }, 'invalid_target_type'],
      [{ targetType: 'entry', targetId: 'bad', reason: 'incorrect' }, 'invalid_target_identifier'],
      [{ targetType: 'entry', targetId: 1, reason: 'incorrect' }, 'invalid_target_identifier'],
      [{ targetType: 'entry', targetId: 'valid', reason: 'other' }, 'invalid_reason'],
      [{ targetType: 'entry', targetId: 'valid', reason: 'incorrect', note: 1 }, 'invalid_note'],
      [
        { targetType: 'entry', targetId: 'valid', reason: 'incorrect', note: 'xx' },
        'note_too_long',
      ],
    ] as const) {
      expect(() => parser.parse(raw)).toThrow(ReportValidationError)
      try {
        parser.parse(raw)
      } catch (error) {
        expect(error).toMatchObject({ code })
      }
    }
  })

  it('rejects invalid parser configuration', () => {
    expect(() =>
      createReportInputParser({
        targetTypes: [],
        reasons: ['reason'],
        parseTargetId: (value) => value,
        maxNoteLength: 1,
      }),
    ).toThrow(TypeError)
    expect(() =>
      createReportInputParser({
        targetTypes: ['type'],
        reasons: ['reason'],
        parseTargetId: (value) => value,
        maxNoteLength: -1,
      }),
    ).toThrow(TypeError)
  })
})
