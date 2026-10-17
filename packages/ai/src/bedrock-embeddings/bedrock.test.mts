import { describe, expect, it, vi } from 'vitest'
import {
  buildEmbeddingModelInput,
  buildInvokeEmbeddingInput,
  createEmbeddingImageRecordLine,
  createEmbeddingTextRecordLine,
  estimateEmbeddingTokens,
  extractEmbedding,
  InvalidEmbeddingError,
  invokeEmbedding,
  minimumImageBatchSizeMB,
  minimumTextBatchSizeMB,
  parseBatchResult,
  parseEmbeddingResponseBody,
  requireDenseEmbedding,
  truncateEmbeddingText,
} from './index.mts'

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const vector = (n: number) => Array.from({ length: n }, (_, i) => i)

describe('text and request building', () => {
  it('truncates at word and surrogate boundaries', () => {
    expect(truncateEmbeddingText('short')).toBe('short')
    expect(truncateEmbeddingText('hello wonderful world', 15)).toBe('hello wonderful')
    expect(truncateEmbeddingText('hello wonderful world', 18)).toBe('hello wonderful')
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
      buildEmbeddingModelInput(
        { image: { format: 'png', bytes: 'AA==' } },
        { dimension: 256, purpose: 'GENERIC_RETRIEVAL' },
      ),
    ).toMatchObject({
      singleEmbeddingParams: {
        embeddingPurpose: 'GENERIC_RETRIEVAL',
        embeddingDimension: 256,
        image: { format: 'png', source: { bytes: 'AA==' } },
      },
    })
    expect(buildInvokeEmbeddingInput('hi', { modelId: 'custom' })).toMatchObject({
      modelId: 'custom',
      contentType: 'application/json',
    })
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

  it('parses and validates bodies or throws typed errors', () => {
    expect(parseEmbeddingResponseBody(bytes({ embedding: [1, 2] }), 2)).toEqual([1, 2])
    expect(parseEmbeddingResponseBody(bytes({ embedding: vector(1024) }))).toHaveLength(1024)
    expect(() => parseEmbeddingResponseBody(undefined)).toThrow(InvalidEmbeddingError)
    expect(() => parseEmbeddingResponseBody(bytes({}))).toThrow(/did not include/)
    expect(() => parseEmbeddingResponseBody(bytes({ embedding: 'bad' }), 2)).toThrow(/dense/)
    expect(() => parseEmbeddingResponseBody(bytes({ embedding: [1] }), 2)).toThrow(/dense/)
  })

  it('validates dense vectors', () => {
    expect(requireDenseEmbedding([1, 2], 2)).toEqual([1, 2])
    expect(() => requireDenseEmbedding('x', 2)).toThrow(InvalidEmbeddingError)
    expect(() => requireDenseEmbedding([1], 2)).toThrow()
    expect(() => requireDenseEmbedding([1, NaN], 2)).toThrow()
    expect(() => requireDenseEmbedding([1, '2'], 2)).toThrow()
    expect(() => requireDenseEmbedding([])).toThrow()
  })

  it('invokes through the injected function with the requested dimension', async () => {
    const invoke = vi.fn().mockResolvedValue({ body: bytes({ embedding: [9, 8] }) })
    expect(await invokeEmbedding(invoke, 'hello', { dimension: 2 })).toEqual([9, 8])
    expect(invoke.mock.calls[0]?.[0].body).toContain('hello')
    invoke.mockResolvedValue({ body: bytes({ embedding: vector(1024) }) })
    expect(await invokeEmbedding(invoke, 'hello')).toHaveLength(1024)
  })
})

describe('batch records', () => {
  it('creates JSONL lines with an opaque recordId', () => {
    const line = JSON.parse(createEmbeddingTextRecordLine({ recordId: 'r1', content: 'hi' }))
    expect(line.recordId).toBe('r1')
    expect(line.modelInput.singleEmbeddingParams.text.value).toBe('hi')
    const image = JSON.parse(
      createEmbeddingImageRecordLine({ recordId: 'r2', format: 'webp', bytes: 'AA==' }),
    )
    expect(image.modelInput.singleEmbeddingParams.image.format).toBe('webp')
  })

  it('bounds batch file sizes from injected limits', () => {
    expect(minimumTextBatchSizeMB(10)).toBeGreaterThan(0.4)
    expect(minimumTextBatchSizeMB(10, { maxTextLength: 100 })).toBeLessThan(
      minimumTextBatchSizeMB(10),
    )
    expect(minimumTextBatchSizeMB(10, { maxRecordIdLength: 500 })).toBeGreaterThan(
      minimumTextBatchSizeMB(10),
    )
    const small = minimumImageBatchSizeMB(2, { maxImageBytes: 1024 * 1024 })
    expect(minimumImageBatchSizeMB(2)).toBeGreaterThan(small)
    expect(minimumImageBatchSizeMB(2)).toBeGreaterThan(40)
  })

  it('parses result lines defensively', () => {
    const ok = { recordId: 'r', modelOutput: { embedding: [1], inputTokenCount: 7 } }
    expect(parseBatchResult(ok)).toEqual({ recordId: 'r', embedding: [1], inputTokenCount: 7 })
    expect(parseBatchResult({ recordId: 'r', modelOutput: { embeddings: [[2]] } })).toEqual({
      recordId: 'r',
      embedding: [2],
      inputTokenCount: null,
    })
    expect(parseBatchResult({ ...ok, error: { code: 1 } })).toBeNull()
    expect(parseBatchResult({ recordId: 'r' })).toBeNull()
  })
})
