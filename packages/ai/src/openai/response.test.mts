import { describe, expect, it } from 'vitest'
import {
  computeOutputText,
  OpenAIResponseNotCompletedError,
  validateCompletedResponse,
} from './index.mts'

const output = [
  { type: 'reasoning' },
  {
    type: 'message',
    content: [{ type: 'output_text', text: 'he' }, { type: 'refusal' }, { type: 'output_text' }],
  },
  { type: 'message' },
  { type: 'message', content: [{ type: 'output_text', text: 'llo' }] },
]

describe('validateCompletedResponse', () => {
  it('returns completed responses with recomputed text', () => {
    const usage = { input_tokens: 1, output_tokens: 2 }
    expect(
      validateCompletedResponse({
        id: 'r',
        status: 'completed',
        output,
        usage,
        model: 'm',
        service_tier: 'default',
      }),
    ).toEqual({
      id: 'r',
      status: 'completed',
      output,
      output_text: 'hello',
      usage,
      model: 'm',
      service_tier: 'default',
    })
    expect(
      validateCompletedResponse({
        id: 'r2',
        status: 'completed',
        output: [],
        usage: null,
        service_tier: null,
      }),
    ).toMatchObject({
      usage: undefined,
      service_tier: undefined,
      output_text: '',
    })
    expect(computeOutputText(output)).toBe('hello')
  })

  it.each([
    [
      { status: 'failed', error: { code: 'server_error', message: 'boom' } },
      'failed (server_error): boom',
      'server_error',
      undefined,
    ],
    [{ status: 'failed' }, 'failed (unknown): Unknown error', undefined, undefined],
    [
      { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
      'incomplete: max_output_tokens',
      undefined,
      'max_output_tokens',
    ],
    [{ status: 'incomplete' }, 'incomplete: unknown reason', undefined, undefined],
    [{ status: 'queued' }, 'unsupported status: queued', undefined, undefined],
    [{}, 'unsupported status: missing', undefined, undefined],
  ])('throws with usage attached (%#)', (partial, message, code, reason) => {
    const usage = { input_tokens: 3, output_tokens: 4 }
    try {
      validateCompletedResponse({ id: 'r', usage, output: [], model: 'm', ...partial })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(OpenAIResponseNotCompletedError)
      expect((error as Error).message).toContain(message)
      expect(error).toMatchObject({ usage, code, reason, model: 'm', id: 'r' })
    }
  })

  it('rejects a completed response without an id, keeping its usage', () => {
    const usage = { input_tokens: 1, output_tokens: 1 }
    expect(() => validateCompletedResponse({ status: 'completed', output: [], usage })).toThrow(
      expect.objectContaining({ message: 'OpenAI response has no id.', usage }),
    )
  })

  it('tolerates a missing id', () => {
    const error = new OpenAIResponseNotCompletedError('x', { id: '', output: [] })
    expect(error).toMatchObject({ id: undefined, status: 'missing' })
  })
})
