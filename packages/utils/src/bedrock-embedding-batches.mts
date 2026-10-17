import {
  buildEmbeddingModelInput,
  extractEmbedding,
  NOVA_EMBEDDING_DEFAULTS,
  type EmbeddingOptions,
} from './bedrock-embeddings.mts'

/**
 * Nova accepts inline media up to 25 MB after Base64 encoding; 18,000,000 raw bytes encode to
 * 24,000,000, leaving room for framing; callers that enforce a smaller
 * decoded bound (e.g. after converting images) pass it as `maxImageBytes`.
 */
export const DEFAULT_MAX_IMAGE_EMBEDDING_BYTES = 18_000_000

export type BatchSizeOptions = EmbeddingOptions & {
  /** Decoded image bytes bound used to budget the worst-case record. */
  maxImageBytes?: number
  /**
   * Longest `recordId` in UTF-16 code units (default 128). Budgeted at JSON's worst case of six
   * bytes per unit, since escapes can expand the encoded line.
   */
  maxRecordIdLength?: number
}

const DEFAULT_MAX_RECORD_ID_LENGTH = 128
/** A control character JSON-escapes to six bytes (`\u0001`), the worst case per code unit. */
const WORST_CASE_ID_UNIT = '\u0001'

/** One JSONL line of a batch input file. `recordId` is opaque and comes back on the result line. */
export function createEmbeddingRecordLine(
  recordId: string,
  modelInput: Record<string, unknown>,
): string {
  return JSON.stringify({ recordId, modelInput })
}

export function createEmbeddingTextRecordLine(
  record: { recordId: string; content: string },
  options: EmbeddingOptions = {},
): string {
  return createEmbeddingRecordLine(
    record.recordId,
    buildEmbeddingModelInput({ text: record.content }, options),
  )
}

export function createEmbeddingImageRecordLine(
  record: { recordId: string; format: 'jpeg' | 'png' | 'webp'; bytes: string },
  options: EmbeddingOptions = {},
): string {
  return createEmbeddingRecordLine(
    record.recordId,
    buildEmbeddingModelInput({ image: { format: record.format, bytes: record.bytes } }, options),
  )
}

function framingBytes(line: string): number {
  return Buffer.byteLength(line) + 1
}

/** Lower bound on a batch file for `records` images: worst-case payload plus actual framing. */
export function minimumImageBatchSizeMB(records: number, options: BatchSizeOptions = {}): number {
  const recordId = WORST_CASE_ID_UNIT.repeat(
    options.maxRecordIdLength ?? DEFAULT_MAX_RECORD_ID_LENGTH,
  )
  const framing = framingBytes(
    createEmbeddingImageRecordLine({ recordId, format: 'jpeg', bytes: '' }, options),
  )
  const maxBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_EMBEDDING_BYTES
  return (records * (Math.ceil(maxBytes / 3) * 4 + framing)) / 1024 / 1024
}

/** Same for text; JSON control-character escapes cost up to six bytes per UTF-16 code unit. */
export function minimumTextBatchSizeMB(records: number, options: BatchSizeOptions = {}): number {
  const recordId = WORST_CASE_ID_UNIT.repeat(
    options.maxRecordIdLength ?? DEFAULT_MAX_RECORD_ID_LENGTH,
  )
  const maxTextLength = options.maxTextLength ?? NOVA_EMBEDDING_DEFAULTS.maxTextLength
  const framing = framingBytes(createEmbeddingTextRecordLine({ recordId, content: '' }, options))
  return (records * (maxTextLength * 6 + framing)) / 1024 / 1024
}

/** One line of a batch output file. */
export type BatchResultLine = {
  recordId: string
  error?: unknown
  modelOutput?: {
    embedding?: number[]
    embeddings?: Array<{ embedding: number[] } | number[]>
    inputTokenCount?: number
  }
}

export type BatchEmbeddingResult = {
  recordId: string
  embedding: number[]
  inputTokenCount: number | null
}

/**
 * The vector of a result line, or null for errored lines and lines without one. Decoding the
 * opaque `recordId` and validating the vector's dimension stay with the application.
 */
export function parseBatchResult(line: BatchResultLine): BatchEmbeddingResult | null {
  const embedding = line.error ? undefined : extractEmbedding(line.modelOutput)
  if (!embedding) return null
  return {
    recordId: line.recordId,
    embedding,
    inputTokenCount: line.modelOutput?.inputTokenCount ?? null,
  }
}
