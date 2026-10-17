import { describe, expect, it, vi } from 'vitest'
import {
  buildEmbeddingModelInput,
  buildInvokeEmbeddingInput,
  createEmbeddingImageRecordLine,
  createEmbeddingTextRecordLine,
  deriveBedrockBatchStatus,
  estimateEmbeddingTokens,
  extractEmbedding,
  InvalidEmbeddingError,
  invokeEmbedding,
  lifecycleColumnForBedrockStatus,
  minimumImageBatchSizeMB,
  minimumTextBatchSizeMB,
  parseEmbeddingResponseBody,
  parseImageBatchResult,
  parseTextBatchResult,
  requireDenseEmbedding,
  truncateEmbeddingText,
} from './index.mts'

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

describe('text and request building', () => {
  it('truncates at word and surrogate boundaries', () => {
    expect(truncateEmbeddingText('short')).toBe('short')
    expect(truncateEmbeddingText('hello wonderful world', 15)).toBe('hello')
    expect(truncateEmbeddingText('abcdefghij', 5)).toBe('abcde')
    expect(truncateEmbeddingText(`abcd${'😀'}`, 5)).toBe('abcd')
    expect(estimateEmbeddingTokens('abcdefgh')).toBe(2)
    expect(estimateEmbeddingTokens('abcdefgh', 2)).toBe(4)
  })

  it('builds text and image model inputs with overridable defaults', () => {
    expect(buildEmbeddingModelInput({ text: 'hi' })).toEqual({
      taskType: 'SINGLE_EMBEDDING',
      singleEmbeddingParams: {
        embeddingPurpose: 'GENERIC_INDEX',
        embeddingDimension: 1024,
        text: { truncationMode: 'END', value: 'hi' },
      },
    })
    expect(
      buildEmbeddingModelInput({ image: { format: 'png', bytes: 'AA==' } }, { dimension: 256 }),
    ).toMatchObject({
      singleEmbeddingParams: {
        embeddingDimension: 256,
        image: { format: 'png', source: { bytes: 'AA==' } },
      },
    })
    const input = buildInvokeEmbeddingInput('hi', { modelId: 'custom' })
    expect(input).toMatchObject({ modelId: 'custom', contentType: 'application/json' })
    expect(buildInvokeEmbeddingInput('hi').modelId).toContain('nova')
  })
})

describe('responses', () => {
  it('extracts embeddings from both shapes', () => {
    expect(extractEmbedding({ embedding: [1] })).toEqual([1])
    expect(extractEmbedding({ embeddings: [[2]] })).toEqual([2])
    expect(extractEmbedding({ embeddings: [{ embedding: [3] }] })).toEqual([3])
    expect(extractEmbedding({})).toBeUndefined()
    expect(extractEmbedding(undefined)).toBeUndefined()
  })

  it('parses bodies or throws typed errors', () => {
    expect(parseEmbeddingResponseBody(bytes({ embedding: [1, 2] }))).toEqual([1, 2])
    expect(() => parseEmbeddingResponseBody(undefined)).toThrow(InvalidEmbeddingError)
    expect(() => parseEmbeddingResponseBody(bytes({}))).toThrow(/did not include/)
  })

  it('validates dense vectors', () => {
    expect(requireDenseEmbedding([1, 2], 2)).toEqual([1, 2])
    expect(() => requireDenseEmbedding('x', 2)).toThrow(InvalidEmbeddingError)
    expect(() => requireDenseEmbedding([1], 2)).toThrow()
    expect(() => requireDenseEmbedding([1, NaN], 2)).toThrow()
    expect(() => requireDenseEmbedding([1, '2'], 2)).toThrow()
    expect(() => requireDenseEmbedding([])).toThrow()
  })

  it('invokes through the injected function', async () => {
    const invoke = vi.fn().mockResolvedValue({ body: bytes({ embedding: [9] }) })
    expect(await invokeEmbedding(invoke, 'hello')).toEqual([9])
    expect(invoke.mock.calls[0]?.[0].body).toContain('hello')
  })
})

describe('batch records', () => {
  const sha = Buffer.from('ab', 'hex')

  it('creates JSONL lines whose recordId round-trips', () => {
    const line = JSON.parse(
      createEmbeddingTextRecordLine({ entity_id: 'e1', content: 'hi', content_sha256: sha }),
    )
    expect(JSON.parse(line.recordId)).toEqual({ entity_id: 'e1', content_sha256: 'ab' })
    expect(line.modelInput.singleEmbeddingParams.text.value).toBe('hi')
    const image = JSON.parse(
      createEmbeddingImageRecordLine({
        entity_id: 'e2',
        image_sha_256: sha,
        format: 'webp',
        bytes: 'AA==',
      }),
    )
    expect(JSON.parse(image.recordId)).toEqual({ entity_id: 'e2', image_sha_256: 'ab' })
  })

  it('bounds batch file sizes', () => {
    expect(minimumTextBatchSizeMB(10)).toBeGreaterThan(0.4)
    expect(minimumTextBatchSizeMB(10, { maxTextLength: 100 })).toBeLessThan(
      minimumTextBatchSizeMB(10),
    )
    expect(minimumImageBatchSizeMB(2)).toBeGreaterThan(10)
  })

  it('parses result lines defensively', () => {
    const recordId = JSON.stringify({ entity_id: 'e', content_sha256: 'ab', image_sha_256: 'cd' })
    const ok = { recordId, modelOutput: { embedding: [1], inputTokenCount: 7 } }
    expect(parseTextBatchResult(ok)).toEqual({
      entity_id: 'e',
      content_sha256: sha,
      embedding: [1],
      input_token_count: 7,
    })
    expect(
      parseTextBatchResult({ recordId, modelOutput: { embeddings: [[2]] } })?.input_token_count,
    ).toBeNull()
    expect(parseImageBatchResult(ok)).toEqual({
      entity_id: 'e',
      image_sha_256: Buffer.from('cd', 'hex'),
      embedding: [1],
    })
    expect(parseTextBatchResult({ ...ok, error: { code: 1 } })).toBeNull()
    expect(parseTextBatchResult({ recordId })).toBeNull()
    expect(parseTextBatchResult({ ...ok, recordId: 'not json' })).toBeNull()
    expect(parseTextBatchResult({ ...ok, recordId: JSON.stringify({ entity_id: 'e' }) })).toBeNull()
    expect(
      parseImageBatchResult({ ...ok, recordId: JSON.stringify({ entity_id: 'e' }) }),
    ).toBeNull()
    expect(parseImageBatchResult({ recordId })).toBeNull()
    expect(parseImageBatchResult({ ...ok, error: { code: 1 } })).toBeNull()
    const noEntity = { recordId: '{}', modelOutput: { embedding: [1] } }
    expect(parseImageBatchResult(noEntity)).toBeNull()
    expect(parseTextBatchResult(noEntity)).toBeNull()
  })
})

describe('batch status', () => {
  const none = {
    submitted_at: null,
    in_progress_at: null,
    completed_at: null,
    failed_at: null,
    cancelled_at: null,
  }
  const now = new Date()

  it('derives the furthest stage', () => {
    expect(deriveBedrockBatchStatus(none)).toBe('preparing')
    expect(deriveBedrockBatchStatus({ ...none, submitted_at: now })).toBe('submitted')
    expect(deriveBedrockBatchStatus({ ...none, in_progress_at: now, submitted_at: now })).toBe(
      'in_progress',
    )
    expect(deriveBedrockBatchStatus({ ...none, cancelled_at: now, in_progress_at: now })).toBe(
      'cancelled',
    )
    expect(deriveBedrockBatchStatus({ ...none, failed_at: now, cancelled_at: now })).toBe('failed')
    expect(deriveBedrockBatchStatus({ ...none, completed_at: now, failed_at: now })).toBe(
      'completed',
    )
  })

  it.each([
    ['Submitted', 'submitted_at'],
    ['Validating', 'submitted_at'],
    ['Scheduled', 'submitted_at'],
    ['InProgress', 'in_progress_at'],
    ['Stopping', 'in_progress_at'],
    ['Completed', 'completed_at'],
    ['PartiallyCompleted', 'completed_at'],
    ['Failed', 'failed_at'],
    ['Expired', 'failed_at'],
    ['Stopped', 'cancelled_at'],
    ['Nope', null],
  ])('maps %s', (status, column) => {
    expect(lifecycleColumnForBedrockStatus(status)).toBe(column)
  })
})
