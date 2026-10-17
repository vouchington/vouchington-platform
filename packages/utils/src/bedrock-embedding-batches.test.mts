import { describe, expect, it } from 'vitest'
import {
  createEmbeddingImageRecordLine,
  createEmbeddingTextRecordLine,
  minimumImageBatchSizeMB,
  minimumTextBatchSizeMB,
  parseBatchResult,
} from './bedrock-embedding-batches.mts'

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
    expect(minimumTextBatchSizeMB(1, { maxRecordIdLength: 1000 })).toBeGreaterThan(
      minimumTextBatchSizeMB(1, { maxRecordIdLength: 0 }) + 0.005,
    )
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
