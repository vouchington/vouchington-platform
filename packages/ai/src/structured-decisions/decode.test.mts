import { describe, expect, it } from 'vitest'
import { decodeAnswer } from './answer-decoder.mts'
import { decodeResult } from './decode.mts'
import { StructuredDecisionError } from './errors.mts'
import type {
  ChoiceQuestion,
  NoulQuestion,
  ScoreQuestion,
  StructuredDecisionRequest,
} from './types.mts'
import { validateRequest } from './validation.mts'

const noul: NoulQuestion = { id: 'n', type: 'noul', question: 'Is it?' }
const choice: ChoiceQuestion = { id: 'c', type: 'choice', question: 'Pick', criteria: ['a', 'b'] }
const score: ScoreQuestion = {
  id: 's',
  type: 'score',
  question: 'Rate',
  criteria: [
    { description: 'low', value: 0 },
    { description: 'high', value: 1 },
  ],
}

function code(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (error) {
    return (error as StructuredDecisionError).code
  }
  return undefined
}

describe('decodeAnswer', () => {
  it('decodes noul, choice and score answers', () => {
    expect(decodeAnswer({ type: 'noul', noul: 0.2 }, noul, 'n')).toMatchObject({ probability: 0.2 })
    expect(
      decodeAnswer(
        {
          id: 'c',
          type: 'choice',
          choice: 'a',
          confidence: 0.9,
          probabilities: { a: 0.9, b: 0.1 },
        },
        choice,
        'c',
      ),
    ).toMatchObject({ choice: 'a', confidence: 0.9 })
    const named = decodeAnswer(
      {
        type: 'score',
        score: 1,
        confidence: 1,
        legend: ['low', 'high'],
        probabilities: { low: 0, high: 1 },
      },
      score,
      's',
    )
    expect(named).toMatchObject({ score: 1, legend: ['low', 'high'] })
    const indexed = decodeAnswer(
      {
        type: 'score',
        score: 0,
        confidence: 1,
        legend: { 0: 'low', 1: 'high' },
        probabilities: { 0: 1, 1: 0 },
      },
      score,
      's',
    )
    expect(indexed).toMatchObject({ probabilities: { 0: 1, 1: 0 } })
  })

  it.each([
    [null, noul, 'n'],
    [{ type: 'choice' }, noul, 'n'],
    [{ type: 'noul' }, noul, 'other'],
    [{ type: 'noul', id: 'x', noul: 0.5 }, noul, 'n'],
    [{ type: 'noul', noul: 2 }, noul, 'n'],
    [{ type: 'noul', noul: 'x' }, noul, 'n'],
    [{ type: 'choice', choice: 'z', confidence: 1 }, choice, 'c'],
    [{ type: 'choice', choice: 1, confidence: 1 }, choice, 'c'],
    [{ type: 'choice', choice: 'a', confidence: 1, probabilities: { a: 1 } }, choice, 'c'],
    [
      { type: 'choice', choice: 'a', confidence: 1, probabilities: { a: 0.5, b: 0.1 } },
      choice,
      'c',
    ],
    [{ type: 'choice', choice: 'a', confidence: 1, probabilities: [] }, choice, 'c'],
    [{ type: 'score', score: 5, confidence: 1 }, score, 's'],
    [{ type: 'score', score: 'x', confidence: 1 }, score, 's'],
    [{ type: 'score', score: 0, confidence: 1, legend: { 0: 'low' } }, score, 's'],
    [{ type: 'score', score: 0, confidence: 1, legend: ['low', 'wrong'] }, score, 's'],
    [{ type: 'score', score: 0, confidence: 1, legend: 'x' }, score, 's'],
  ])('rejects invalid answers (%#)', (raw, question, id) => {
    expect(code(() => decodeAnswer(raw, question, id))).toBe('invalid-response')
  })
})

describe('decodeResult', () => {
  const request: StructuredDecisionRequest = { state: 'state', questions: [noul, choice] }
  const answers = [
    { id: 'n', type: 'noul', noul: 0.1 },
    { id: 'c', type: 'choice', choice: 'b', confidence: 1, probabilities: { a: 0, b: 1 } },
  ]
  const body = { model: 'm1', provider: 'P', answers, usage: { input_tokens: 1 } }

  it('decodes array and record answers', () => {
    const result = decodeResult(body, request, { fallbackProvider: 'F' })
    expect(result).toMatchObject({ model: 'm1', provider: 'P', usage: { input_tokens: 1 } })
    expect(result.answers).toHaveLength(2)
    const byId = decodeResult({ model: 'm1', answers: { n: answers[0], c: answers[1] } }, request, {
      fallbackProvider: 'F',
    })
    expect(byId).toMatchObject({ provider: 'F', usage: null })
  })

  it('runs injected identity checks', () => {
    const options = {
      fallbackProvider: 'F',
      isExpectedModel: (model: string) => model === 'm1',
      isExpectedProvider: (provider: unknown) => provider === 'P',
    }
    expect(decodeResult(body, request, options).model).toBe('m1')
    expect(code(() => decodeResult({ ...body, model: 'm2' }, request, options))).toBe(
      'invalid-response',
    )
    expect(code(() => decodeResult({ ...body, provider: 'Q' }, request, options))).toBe(
      'invalid-response',
    )
  })

  it.each([
    [null],
    [{ model: 1 }],
    [{ model: 'm', answers: 'x' }],
    [{ model: 'm', answers: [{ type: 'noul' }] }],
    [{ model: 'm', answers: [null] }],
    [{ model: 'm', answers: { n: null } }],
    [{ model: 'm', answers: [answers[0], answers[0]] }],
    [{ model: 'm', answers: [answers[0]] }],
  ])('rejects malformed envelopes (%#)', (raw) => {
    expect(code(() => decodeResult(raw, request, { fallbackProvider: 'F' }))).toBe(
      'invalid-response',
    )
  })
})

describe('validateRequest', () => {
  const ok: StructuredDecisionRequest = { state: 's', questions: [noul, choice, score] }

  it('accepts valid requests', () => {
    expect(() => validateRequest(ok)).not.toThrow()
  })

  it.each([
    [null],
    [{ state: ' ', questions: [noul] }],
    [{ state: 's', questions: 'x' }],
    [{ state: 's', questions: [] }],
    [{ state: 's', questions: [noul, noul] }],
    [{ state: 's', questions: [{ ...noul, question: ' ' }] }],
    [{ state: 's', questions: ['x'] }],
    [{ state: 's', questions: [{ id: 'q', type: 'other', question: 'q' }] }],
    [{ state: 's', questions: [{ ...choice, criteria: ['a'] }] }],
    [{ state: 's', questions: [{ ...choice, criteria: ['a', 'a'] }] }],
    [{ state: 's', questions: [{ ...choice, criteria: ['a', ''] }] }],
    [{ state: 's', questions: [{ ...score, criteria: [{ description: 'x', value: 0 }] }] }],
    [
      {
        state: 's',
        questions: [
          {
            ...score,
            criteria: [
              { description: 'x', value: 0 },
              { description: 'y', value: 2 },
            ],
          },
        ],
      },
    ],
    [
      {
        state: 's',
        questions: [
          {
            ...score,
            criteria: [
              { description: 'x', value: 0 },
              { description: 'x', value: 1 },
            ],
          },
        ],
      },
    ],
    [{ state: 's', questions: [{ ...score, criteria: ['x', 'y'] }] }],
  ])('rejects invalid requests (%#)', (raw) => {
    expect(code(() => validateRequest(raw as StructuredDecisionRequest))).toBe('invalid-request')
  })
})

describe('StructuredDecisionError', () => {
  it('carries failure details', () => {
    const error = new StructuredDecisionError('provider-error', 'x', 429, {
      failure: { retryClass: 'transient', retryAfterMs: 5 },
    })
    expect(error).toMatchObject({ status: 429, retryClass: 'transient', retryAfterMs: 5 })
    expect(new StructuredDecisionError('invalid-request', 'y').retryClass).toBeUndefined()
  })
})
