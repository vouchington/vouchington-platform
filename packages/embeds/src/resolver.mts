import { extractHtmlContent, isHtmlContentType } from '@vouchington/crawler-html'

import { extractDocumentMetadata } from './metadata.mts'
import { parseOEmbedResponse, type OEmbedMetadata } from './oembed.mts'
import { matchEmbedProvider } from './providers.mts'
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
  EmbedProviderMatch,
  EmbedResolver,
  EmbedResolverOptions,
  ResolveExtractedEmbedInput,
  ResolvedEmbed,
} from './types.mts'

export { EmbedPolicyError }

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
    async resolveExtracted(input, callOptions) {
      const documentUrl = parseHttpUrl(input.documentUrl)
      return await withTimeout(configuration.timeoutMs, callOptions, async (signal) => {
        await requireAuthorized(configuration, documentUrl, 'document', documentUrl)
        return await resolveContent(configuration, documentUrl, documentUrl, input.content, signal)
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
  const document = extractDocumentMetadata(content, documentUrl)
  const provider = matchEmbedProvider(documentUrl, options.providers)
  const endpoint = provider?.match.oEmbedUrl ?? document.oEmbedUrl
  const oembed = endpoint ? await fetchOEmbed(options, endpoint, documentUrl, signal) : null
  const playerOEmbed =
    oembed && ['video', 'rich'].includes(oembed.type?.toLowerCase() ?? '') ? oembed : null
  const playerUrl = provider?.match.playerUrl ?? playerOEmbed?.playerUrl ?? null
  const player =
    playerUrl &&
    (await options.authorizeUrl(playerUrl, { purpose: 'player', sourceUrl: documentUrl }))
      ? {
          url: playerUrl.toString(),
          width: playerOEmbed?.width ?? null,
          height: playerOEmbed?.height ?? null,
        }
      : null
  return {
    kind: player ? 'player' : 'article',
    requestedUrl: requestedUrl.toString(),
    resolvedUrl: documentUrl.toString(),
    title: oembed?.title ?? document.title,
    description: document.description,
    author:
      oembed?.authorName || oembed?.authorUrl
        ? { name: oembed.authorName, url: oembed.authorUrl?.toString() ?? null }
        : null,
    provider:
      provider || oembed?.providerName || oembed?.providerUrl
        ? providerMetadata(provider?.provider.key ?? null, provider?.match ?? null, oembed)
        : null,
    thumbnail:
      oembed?.thumbnailUrl || document.thumbnailUrl
        ? {
            url: (oembed?.thumbnailUrl ?? document.thumbnailUrl)!.toString(),
            width: oembed?.thumbnailWidth ?? null,
            height: oembed?.thumbnailHeight ?? null,
          }
        : null,
    player,
  }
}

async function fetchOEmbed(
  options: Configuration,
  endpoint: URL,
  sourceUrl: URL,
  signal: AbortSignal,
): Promise<OEmbedMetadata | null> {
  try {
    const response = await safeFetch(
      options,
      'oembed',
      sourceUrl,
    )(endpoint, requestInit(options, signal, 'application/json'))
    try {
      if (!response.ok) throw new TypeError(`oEmbed request failed with HTTP ${response.status}`)
      const contentType = response.headers.get('content-type') ?? ''
      const body = await readBoundedBody(response, options.maxOEmbedSizeBytes)
      return parseOEmbedResponse(body, contentType, new URL(response.url || endpoint))
    } finally {
      await response.body?.cancel().catch(() => undefined)
    }
  } catch (error) {
    if (signal.aborted) throw error
    try {
      options.onOEmbedError?.(error, { endpoint, sourceUrl })
    } catch {
      // Diagnostics must not turn optional enrichment into a fatal error.
    }
    return null
  }
}

function providerMetadata(
  key: string | null,
  match: EmbedProviderMatch | null,
  oembed: OEmbedMetadata | null,
) {
  return {
    key,
    name: oembed?.providerName ?? null,
    url: oembed?.providerUrl?.toString() ?? null,
    resourceId: match?.resourceId ?? null,
  }
}
