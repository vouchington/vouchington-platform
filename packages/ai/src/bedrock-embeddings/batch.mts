import {
  buildEmbeddingModelInput,
  extractEmbedding,
  NOVA_EMBEDDING_DEFAULTS,
  type EmbeddingOptions,
} from './single.mts'

/** Converted image bytes have this provider-bound maximum before base64 encoding. */
export const MAX_IMAGE_EMBEDDING_BYTES = 4 * 1024 * 1024

export type EmbeddingTextInput = { entity_id: string; content: string; content_sha256: Buffer }
export type EmbeddingImageInput = {
  entity_id: string
  image_sha_256: Buffer
  format: 'jpeg' | 'png' | 'webp'
  /** Base64-encoded image bytes. */
  bytes: string
}

/** One JSONL line of a batch input file; the recordId round-trips the entity and content hash. */
export function createEmbeddingTextRecordLine(
  entity: EmbeddingTextInput,
  options: EmbeddingOptions = {},
): string {
  return JSON.stringify({
    recordId: JSON.stringify({
      entity_id: entity.entity_id,
      content_sha256: entity.content_sha256.toString('hex'),
    }),
    modelInput: buildEmbeddingModelInput({ text: entity.content }, options),
  })
}

export function createEmbeddingImageRecordLine(
  image: EmbeddingImageInput,
  options: EmbeddingOptions = {},
): string {
  return JSON.stringify({
    recordId: JSON.stringify({
      entity_id: image.entity_id,
      image_sha_256: image.image_sha_256.toString('hex'),
    }),
    modelInput: buildEmbeddingModelInput(
      { image: { format: image.format, bytes: image.bytes } },
      options,
    ),
  })
}

/** Lower bound on a batch file for `records` images: worst-case payload plus actual framing. */
export function minimumImageBatchSizeMB(records: number, options: EmbeddingOptions = {}): number {
  const framing =
    Buffer.byteLength(
      createEmbeddingImageRecordLine(
        {
          entity_id: '0'.repeat(36),
          image_sha_256: Buffer.alloc(32),
          format: 'jpeg',
          bytes: '',
        },
        options,
      ),
    ) + 1
  return (records * (Math.ceil(MAX_IMAGE_EMBEDDING_BYTES / 3) * 4 + framing)) / 1024 / 1024
}

/** Same for text; JSON control-character escapes cost up to six bytes per UTF-16 code unit. */
export function minimumTextBatchSizeMB(records: number, options: EmbeddingOptions = {}): number {
  const maxTextLength = options.maxTextLength ?? NOVA_EMBEDDING_DEFAULTS.maxTextLength
  const framing =
    Buffer.byteLength(
      createEmbeddingTextRecordLine(
        {
          // The longest identifier is a UUID plus a PostgreSQL INT order index.
          entity_id: `${'0'.repeat(36)}-${-(2 ** 31)}`,
          content: '',
          content_sha256: Buffer.alloc(32),
        },
        options,
      ),
    ) + 1
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

export type TextBatchUpdate = {
  entity_id: string
  content_sha256: Buffer
  embedding: number[]
  input_token_count: number | null
}
export type ImageBatchUpdate = {
  entity_id: string
  image_sha_256: Buffer
  embedding: number[]
}

function parseRecordId(line: BatchResultLine): Record<string, string> | null {
  try {
    return JSON.parse(line.recordId) as Record<string, string>
  } catch {
    return null
  }
}

/** A text update, or null for errored lines, lines without a vector, or an unreadable recordId. */
export function parseTextBatchResult(line: BatchResultLine): TextBatchUpdate | null {
  const embedding = line.error ? undefined : extractEmbedding(line.modelOutput)
  const meta = embedding ? parseRecordId(line) : null
  if (!embedding || !meta?.entity_id || !meta.content_sha256) return null
  return {
    entity_id: meta.entity_id,
    content_sha256: Buffer.from(meta.content_sha256, 'hex'),
    embedding,
    input_token_count: line.modelOutput?.inputTokenCount ?? null,
  }
}

export function parseImageBatchResult(line: BatchResultLine): ImageBatchUpdate | null {
  const embedding = line.error ? undefined : extractEmbedding(line.modelOutput)
  const meta = embedding ? parseRecordId(line) : null
  if (!embedding || !meta?.entity_id || !meta.image_sha_256) return null
  return {
    entity_id: meta.entity_id,
    image_sha_256: Buffer.from(meta.image_sha_256, 'hex'),
    embedding,
  }
}
