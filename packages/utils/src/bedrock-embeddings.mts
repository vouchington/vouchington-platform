/** Defaults for Amazon Nova multimodal embeddings; every field can be overridden. */
export const NOVA_EMBEDDING_DEFAULTS = {
  modelId: 'amazon.nova-2-multimodal-embeddings-v1:0',
  dimension: 1024,
  /** Nova's inline `text.value` cap (UTF-16 code units). */
  maxTextLength: 8_192,
  /** Nova documents no input token count; this approximate estimate is for analytics only. */
  charactersPerToken: 4,
} as const

export type EmbeddingOptions = {
  modelId?: string
  dimension?: number
  maxTextLength?: number
  /** `embeddingPurpose`: `GENERIC_INDEX` (default) for stored content, a retrieval purpose for queries. */
  purpose?: string
  /** Nova image `detailLevel` (e.g. `STANDARD_IMAGE` or `DOCUMENT_IMAGE`); omitted by default. */
  imageDetailLevel?: string
}

/** The `InvokeModel` input; the app wraps it in its own command and client. */
export type InvokeEmbeddingInput = {
  modelId: string
  contentType: 'application/json'
  accept: 'application/json'
  body: string
}

type EmbeddingEntry = { embedding: number[] } | number[]
type EmbeddingResponseBody = { embedding?: number[]; embeddings?: EmbeddingEntry[] }

export class InvalidEmbeddingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'InvalidEmbeddingError'
  }
}

/**
 * Slices to the limit. When the cut falls inside a word, drops a trailing high surrogate and backs
 * up to the last whitespace so the word is not cut; a cut that already ends a word is kept. Falls
 * back to the hard slice when the head has no whitespace.
 */
export function truncateEmbeddingText(
  text: string,
  maxLength: number = NOVA_EMBEDDING_DEFAULTS.maxTextLength,
): string {
  if (text.length <= maxLength) return text
  let sliced = text.slice(0, maxLength)
  if (/\s/.test(text.charAt(maxLength))) return sliced
  const last = sliced.charCodeAt(sliced.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) sliced = sliced.slice(0, -1)
  const lastWhitespace = sliced.search(/\s\S*$/)
  return lastWhitespace > 0 ? sliced.slice(0, lastWhitespace) : sliced
}

export function estimateEmbeddingTokens(
  text: string,
  charactersPerToken: number = NOVA_EMBEDDING_DEFAULTS.charactersPerToken,
): number {
  return Math.ceil(text.length / charactersPerToken)
}

/** The model input for one text or image, shared by the single and batch record formats. */
export function buildEmbeddingModelInput(
  content: { text: string } | { image: { format: 'jpeg' | 'png' | 'webp'; bytes: string } },
  options: EmbeddingOptions = {},
): Record<string, unknown> {
  const dimension = options.dimension ?? NOVA_EMBEDDING_DEFAULTS.dimension
  const common = {
    embeddingPurpose: options.purpose ?? 'GENERIC_INDEX',
    embeddingDimension: dimension,
  }
  return {
    taskType: 'SINGLE_EMBEDDING',
    singleEmbeddingParams:
      'text' in content
        ? {
            ...common,
            text: {
              truncationMode: 'END',
              value: truncateEmbeddingText(content.text, options.maxTextLength),
            },
          }
        : {
            ...common,
            image: {
              format: content.image.format,
              source: { bytes: content.image.bytes },
              ...(options.imageDetailLevel ? { detailLevel: options.imageDetailLevel } : {}),
            },
          },
  }
}

export function buildInvokeEmbeddingInput(
  text: string,
  options: EmbeddingOptions = {},
): InvokeEmbeddingInput {
  return {
    modelId: options.modelId ?? NOVA_EMBEDDING_DEFAULTS.modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(buildEmbeddingModelInput({ text }, options)),
  }
}

/** The first embedding of a response or batch `modelOutput`, in either documented shape. */
export function extractEmbedding(body: EmbeddingResponseBody | undefined): number[] | undefined {
  if (body?.embedding) return body.embedding
  const first = body?.embeddings?.[0]
  return Array.isArray(first) ? first : first?.embedding
}

/**
 * Parses an `InvokeModel` response body into a dense vector of `dimension` finite numbers; throws
 * `InvalidEmbeddingError` when the body is empty or holds no valid vector.
 */
export function parseEmbeddingResponseBody(
  body: Uint8Array | undefined,
  dimension: number = NOVA_EMBEDDING_DEFAULTS.dimension,
): number[] {
  if (!body) throw new InvalidEmbeddingError('Bedrock embedding response body is empty')
  let parsed: EmbeddingResponseBody
  try {
    parsed = JSON.parse(new TextDecoder().decode(body)) as EmbeddingResponseBody
  } catch (err) {
    throw new InvalidEmbeddingError('Bedrock embedding response is not valid JSON', { cause: err })
  }
  const embedding = extractEmbedding(parsed)
  if (!embedding) {
    throw new InvalidEmbeddingError('Bedrock embedding response did not include an embedding')
  }
  return requireDenseEmbedding(embedding, dimension)
}

/** Narrows to a finite-number vector of exactly `dimension` entries or throws. */
export function requireDenseEmbedding(
  value: unknown,
  dimension: number = NOVA_EMBEDDING_DEFAULTS.dimension,
): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== dimension ||
    value.some((element) => typeof element !== 'number' || !Number.isFinite(element))
  ) {
    throw new InvalidEmbeddingError('Bedrock embedding is not a dense vector')
  }
  return value as number[]
}
