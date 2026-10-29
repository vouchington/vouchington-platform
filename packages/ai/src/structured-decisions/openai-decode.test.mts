import { describe, expect, it } from 'vitest'
import { isStructuredDecisionError, type StructuredDecisionError } from './errors.mts'
import { decodeOpenAIResult, type DecodeOpenAIResultOptions } from './openai-decode.mts'
import type { StructuredDecisionRequest } from './types.mts'

const request: StructuredDecisionRequest = {
  state: 's',
  questions: [
    { id: 'n', type: 'noul', question: 'Is it?' },
    { id: 'c', type: 'choice', question: 'Pick', criteria: ['a', 'b'] },
    {
      id: 's',
      type: 'score',
      question: 'Rate',
      criteria: [
        { description: 'low', value: 0 },
        { description: 'high', value: 1 },
      ],
    },
  ],
}
const options: DecodeOpenAIResultOptions = { fallbackProvider: 'OpenAI' }
const usage = {
  input_tokens: 3,
  input_tokens_details: { cached_tokens: 1, cache_write_tokens: 0 },
  output_tokens: 4,
  output_tokens_details: { reasoning_tokens: 2 },
  total_tokens: 7,
}

const predicate = { name: 'n', type: 'predicate', probability: 0.2 }
const choice = {
  name: 'c',
  type: 'choice',
  choice: 'a',
  confidence: 0.9,
  probabilities: [
    { value: 'a', probability: 0.9 },
    { value: 'b', probability: 0.1 },
  ],
}
const score = {
  name: 's',
  type: 'score',
  score: 1,
  confidence: 0.8,
  probabilities: [
    { value: 1, label: 'high', probability: 0.8 },
    { value: 0, label: 'low', probability: 0.2 },
  ],
}

function body(...answers: unknown[]) {
  return { model: 'm', answers, usage }
}

function failure(
  raw: unknown,
  decodeOptions: DecodeOpenAIResultOptions = options,
): StructuredDecisionError | undefined {
  try {
    decodeOpenAIResult(raw, request, decodeOptions)
  } catch (error) {
    return error as StructuredDecisionError
  }
  return undefined
}

function withChoice(overrides: object) {
  return body(predicate, { ...choice, ...overrides }, score)
}

function withScore(overrides: object) {
  return body(predicate, choice, { ...score, ...overrides })
}

function levels(...entries: Array<[unknown, unknown, number]>) {
  return {
    probabilities: entries.map(([value, label, probability]) => ({ value, label, probability })),
  }
}

describe('decodeOpenAIResult', () => {
  it('decodes predicate, choice and score answers', () => {
    const raw = body(predicate, choice, score)
    const result = decodeOpenAIResult(raw, request, options)
    expect(result).toMatchObject({ model: 'm', provider: 'OpenAI', usage, raw })
    expect(result.answers).toEqual([
      { id: 'n', type: 'noul', probability: 0.2, raw: predicate },
      {
        id: 'c',
        type: 'choice',
        choice: 'a',
        confidence: 0.9,
        probabilities: { a: 0.9, b: 0.1 },
        raw: choice,
      },
      {
        id: 's',
        type: 'score',
        score: 1,
        confidence: 0.8,
        legend: ['low', 'high'],
        probabilities: { low: 0.2, high: 0.8 },
        raw: score,
      },
    ])
  })

  it('orders answers by request and nulls absent usage', () => {
    const result = decodeOpenAIResult(
      { model: 'm', answers: [score, choice, predicate] },
      request,
      options,
    )
    expect(result.answers.map((answer) => answer.id)).toEqual(['n', 'c', 's'])
    expect(result.usage).toBeNull()
  })

  it('keeps __proto__ criteria and labels as probability keys', () => {
    const proto: StructuredDecisionRequest = {
      state: 's',
      questions: [
        { id: 'c', type: 'choice', question: 'Pick', criteria: ['__proto__', 'b'] },
        {
          id: 's',
          type: 'score',
          question: 'Rate',
          criteria: [
            { description: '__proto__', value: 0 },
            { description: 'high', value: 1 },
          ],
        },
      ],
    }
    const raw = body(
      {
        ...choice,
        choice: '__proto__',
        probabilities: [
          { value: '__proto__', probability: 0.9 },
          { value: 'b', probability: 0.1 },
        ],
      },
      {
        ...score,
        probabilities: [
          { value: 0, label: '__proto__', probability: 0.2 },
          { value: 1, label: 'high', probability: 0.8 },
        ],
      },
    )
    expect(decodeOpenAIResult(raw, proto, options).answers.map((answer) => answer.id)).toEqual([
      'c',
      's',
    ])
  })

  it('checks the served model with the injected predicate', () => {
    const raw = body(predicate, choice, score)
    expect(failure(raw, { ...options, isExpectedModel: (model) => model === 'm' })).toBeUndefined()
    expect(failure(raw, { ...options, isExpectedModel: () => false })?.code).toBe(
      'invalid-response',
    )
  })

  it('treats a refusal as a permanent invalid response', () => {
    const error = failure(body({ name: 'n', type: 'refusal', refusal: 'no' }, choice, score))
    expect(isStructuredDecisionError(error)).toBe(true)
    expect(error).toMatchObject({ code: 'invalid-response', retryClass: 'permanent' })
  })

  it.each([
    ['non-record body', null],
    ['missing model', { answers: [predicate, choice, score] }],
    ['answers not an array', { model: 'm', answers: {} }],
    ['answer not a record', body(predicate, choice, 'x')],
    ['answer without name', body(predicate, choice, { type: 'score' })],
    ['unknown answer type', body(predicate, choice, { name: 's', type: 'other' })],
    ['missing answer', body(predicate, choice)],
    ['duplicate answer', body(predicate, choice, score, predicate)],
    ['unknown name', body(predicate, choice, { ...score, name: 'z' })],
    ['type mismatch', body({ ...predicate, name: 'c' }, choice, score)],
    ['predicate probability out of range', body({ ...predicate, probability: 2 }, choice, score)],
    ['choice not requested', withChoice({ choice: 'z' })],
    ['choice confidence invalid', withChoice({ confidence: 'x' })],
    ['choice probabilities not array', withChoice({ probabilities: { a: 1 } })],
    ['choice probabilities entry not record', withChoice({ probabilities: ['a', 'b'] })],
    [
      'choice probabilities duplicate',
      withChoice({
        probabilities: [
          { value: 'a', probability: 0.5 },
          { value: 'a', probability: 0.5 },
        ],
      }),
    ],
    [
      'choice probabilities non-string value',
      withChoice({
        probabilities: [
          { value: 1, probability: 0.5 },
          { value: 'b', probability: 0.5 },
        ],
      }),
    ],
    [
      'choice probabilities wrong keys',
      withChoice({
        probabilities: [
          { value: 'a', probability: 0.5 },
          { value: 'z', probability: 0.5 },
        ],
      }),
    ],
    [
      'choice probabilities do not sum to one',
      withChoice({
        probabilities: [
          { value: 'a', probability: 0.5 },
          { value: 'b', probability: 0.4 },
        ],
      }),
    ],
    ['score fractional', withScore({ score: 0.5 })],
    ['score out of range', withScore({ score: 2 })],
    ['score confidence invalid', withScore({ confidence: -1 })],
    ['score probabilities not array', withScore({ probabilities: {} })],
    ['score level not a number', withScore(levels(['0', 'low', 0.2], [1, 'high', 0.8]))],
    ['score level fractional', withScore(levels([0.5, 'low', 0.2], [1, 'high', 0.8]))],
    ['score level negative', withScore(levels([-1, 'low', 0.2], [1, 'high', 0.8]))],
    ['score level beyond range', withScore(levels([0, 'low', 0.2], [2, 'high', 0.8]))],
    ['score level duplicate', withScore(levels([0, 'low', 0.2], [0, 'high', 0.8]))],
    ['score label not a string', withScore(levels([0, 1, 0.2], [1, 'high', 0.8]))],
    ['score labels differ from criteria', withScore(levels([0, 'high', 0.2], [1, 'low', 0.8]))],
    ['score probabilities do not sum to one', withScore(levels([0, 'low', 0.2], [1, 'high', 0.2]))],
  ])('rejects %s', (_name, raw) => {
    const error = failure(raw)
    expect(error?.code).toBe('invalid-response')
    expect(error?.retryClass).toBeUndefined()
  })
})
