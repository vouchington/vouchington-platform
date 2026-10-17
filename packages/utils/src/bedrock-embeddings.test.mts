import { describe, expect, it } from 'vitest'
import {
  buildEmbeddingModelInput,
  buildInvokeEmbeddingInput,
  estimateEmbeddingTokens,
  extractEmbedding,
  InvalidEmbeddingError,
  parseEmbeddingResponseBody,
  requireDenseEmbedding,
  truncateEmbeddingText,
} from './bedrock-embeddings.mts'

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
    expect(
      buildEmbeddingModelInput(
        { image: { format: 'png', bytes: 'AA==' } },
        { imageDetailLevel: 'DOCUMENT_IMAGE' },
      ),
    ).toMatchObject({ singleEmbeddingParams: { image: { detailLevel: 'DOCUMENT_IMAGE' } } })
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
    expect(() => parseEmbeddingResponseBody(new TextEncoder().encode('{oops'))).toThrow(
      InvalidEmbeddingError,
    )
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
})
