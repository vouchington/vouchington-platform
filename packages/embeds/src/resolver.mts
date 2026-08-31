import { extractHtmlContent, isHtmlContentType } from '@vouchington/crawler-html'

import { parseOEmbedResponse, type OEmbedMetadata } from './oembed.mts'
import { createResolutionPlan, enrichResolutionPlan } from './resolution.mts'
import { readBoundedBody } from './response.mts'
import {
  EmbedPolicyError,
  normalizeOptions,
  parseHttpUrl,
  requestInit,
  requireAuthorized,
  safeFetch,
  type Configuration,
  withTimeout,
} from './runtime.mts'
import type {
  EmbedResolutionPlan,
  EmbedResolver,
  EmbedResolverOptions,
  ResolveExtractedEmbedInput,
  ResolvedEmbed,
} from './types.mts'

export { EmbedPolicyError }

export class OEmbedHttpError extends Error {
  readonly retryAfter: string | null
  readonly status: number

  constructor(response: Response) {
    super(`oEmbed request failed with HTTP ${response.status}`)
    this.name = 'OEmbedHttpError'
    this.status = response.status
    this.retryAfter = response.headers.get('retry-after')
  }
}

export function createEmbedResolver(options: EmbedResolverOptions): EmbedResolver {
  const configuration = normalizeOptions(options)
  return {
    async resolve(input, callOptions) {
      const requestedUrl = parseHttpUrl(input)
      return await withTimeout(configuration.timeoutMs, callOptions, async (signal) => {
        const fetchDocument = safeFetch(configuration, 'document', requestedUrl)
        const response = await fetchDocument(
          requestedUrl,
          requestInit(configuration, signal, 'text/html'),
        )
        try {
          if (!response.ok)
            throw new TypeError(`Document request failed with HTTP ${response.status}`)
          const contentType = response.headers.get('content-type')
          if (!isHtmlContentType(contentType)) throw new TypeError('Document response is not HTML')
          const body = await readBoundedBody(response, configuration.maxDocumentSizeBytes)
          const content = await extractHtmlContent(body, contentType!, {})
          return await resolveContent(
            configuration,
            requestedUrl,
            new URL(response.url || requestedUrl),
            content,
            signal,
          )
        } finally {
          await response.body?.cancel().catch(() => undefined)
        }
      })
    },
    async planExtracted(input, callOptions) {
      const documentUrl = parseHttpUrl(input.documentUrl)
      return await withTimeout(configuration.timeoutMs, callOptions, async () => {
        await requireAuthorized(configuration, documentUrl, 'document', documentUrl)
        return await createResolutionPlan(configuration, documentUrl, documentUrl, input.content)
      })
    },
    async resolveOEmbed(plan, callOptions) {
      return await withTimeout(
        configuration.timeoutMs,
        callOptions,
        async (signal) => await resolveOEmbed(configuration, plan, signal),
      )
    },
    async resolveExtracted(input, callOptions) {
      const documentUrl = parseHttpUrl(input.documentUrl)
      return await withTimeout(configuration.timeoutMs, callOptions, async (signal) => {
        await requireAuthorized(configuration, documentUrl, 'document', documentUrl)
        const plan = await createResolutionPlan(
          configuration,
          documentUrl,
          documentUrl,
          input.content,
        )
        return await resolveOptionalOEmbed(configuration, plan, signal)
      })
    },
  }
}

async function resolveContent(
  options: Configuration,
  requestedUrl: URL,
  documentUrl: URL,
  content: ResolveExtractedEmbedInput['content'],
  signal: AbortSignal,
): Promise<ResolvedEmbed> {
  const plan = await createResolutionPlan(options, requestedUrl, documentUrl, content)
  return await resolveOptionalOEmbed(options, plan, signal)
}

async function resolveOEmbed(
  options: Configuration,
  plan: EmbedResolutionPlan,
  signal: AbortSignal,
): Promise<ResolvedEmbed> {
  if (!plan.oEmbedUrl) return plan.embed
  const endpoint = parseHttpUrl(plan.oEmbedUrl)
  const sourceUrl = parseHttpUrl(plan.embed.resolvedUrl)
  const oembed = await fetchOEmbed(options, endpoint, sourceUrl, signal)
  return await enrichResolutionPlan(options, plan, oembed)
}

async function resolveOptionalOEmbed(
  options: Configuration,
  plan: EmbedResolutionPlan,
  signal: AbortSignal,
): Promise<ResolvedEmbed> {
  if (!plan.oEmbedUrl) return plan.embed
  try {
    return await resolveOEmbed(options, plan, signal)
  } catch (error) {
    if (signal.aborted) throw error
    try {
      options.onOEmbedError?.(error, {
        endpoint: new URL(plan.oEmbedUrl),
        sourceUrl: new URL(plan.embed.resolvedUrl),
      })
    } catch {
      // Diagnostics must not turn optional enrichment into a fatal error.
    }
    return plan.embed
  }
}

async function fetchOEmbed(
  options: Configuration,
  endpoint: URL,
  sourceUrl: URL,
  signal: AbortSignal,
): Promise<OEmbedMetadata> {
  const response = await safeFetch(
    options,
    'oembed',
    sourceUrl,
  )(endpoint, requestInit(options, signal, 'application/json'))
  try {
    if (!response.ok) throw new OEmbedHttpError(response)
    const contentType = response.headers.get('content-type') ?? ''
    const body = await readBoundedBody(response, options.maxOEmbedSizeBytes)
    return parseOEmbedResponse(body, contentType, new URL(response.url || endpoint))
  } finally {
    await response.body?.cancel().catch(() => undefined)
  }
}
