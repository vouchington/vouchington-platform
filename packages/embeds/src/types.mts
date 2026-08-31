import type { CrawlerHtmlToMarkdownResult } from '@vouchington/crawler-html'
import type { ResolveHttpDestination, UndiciCompatibleFetch } from '@vouchington/http-transport'

export type EmbedUrlPurpose = 'document' | 'oembed' | 'player'

export interface EmbedAuthorizationContext {
  purpose: EmbedUrlPurpose
  sourceUrl: URL
}

export type AuthorizeEmbedUrl = (
  url: URL,
  context: EmbedAuthorizationContext,
) => boolean | Promise<boolean>

export interface EmbedProviderMatch {
  resourceId: string
  playerUrl?: URL
  oEmbedUrl?: URL
}

export interface EmbedProvider {
  key: string
  match(url: URL): EmbedProviderMatch | null
}

export interface EmbedPerson {
  name: string | null
  url: string | null
}

export interface EmbedProviderMetadata {
  key: string | null
  name: string | null
  url: string | null
  resourceId: string | null
}

export interface EmbedImage {
  url: string
  width: number | null
  height: number | null
}

export interface EmbedPlayer {
  url: string
  width: number | null
  height: number | null
}

export interface ResolvedEmbed {
  kind: 'article' | 'player'
  requestedUrl: string
  resolvedUrl: string
  title: string | null
  description: string | null
  author: EmbedPerson | null
  provider: EmbedProviderMetadata | null
  thumbnail: EmbedImage | null
  player: EmbedPlayer | null
}

export interface EmbedResolutionPlan {
  embed: ResolvedEmbed
  oEmbedUrl: string | null
}

export interface ResolveEmbedOptions {
  signal?: AbortSignal
}

export interface ResolveExtractedEmbedInput {
  documentUrl: string | URL
  content: CrawlerHtmlToMarkdownResult
}

export interface OEmbedFailureContext {
  endpoint: URL
  sourceUrl: URL
}

export interface EmbedResolverOptions {
  fetch: UndiciCompatibleFetch
  resolveDestination: ResolveHttpDestination
  authorizeUrl: AuthorizeEmbedUrl
  userAgent: string
  providers?: readonly EmbedProvider[]
  maxRedirects?: number
  maxDocumentSizeBytes?: number
  maxOEmbedSizeBytes?: number
  timeoutMs?: number
  onOEmbedError?: (error: unknown, context: OEmbedFailureContext) => void
}

export interface EmbedResolver {
  resolve(url: string | URL, options?: ResolveEmbedOptions): Promise<ResolvedEmbed>
  planExtracted(
    input: ResolveExtractedEmbedInput,
    options?: ResolveEmbedOptions,
  ): Promise<EmbedResolutionPlan>
  resolveOEmbed(plan: EmbedResolutionPlan, options?: ResolveEmbedOptions): Promise<ResolvedEmbed>
  resolveExtracted(
    input: ResolveExtractedEmbedInput,
    options?: ResolveEmbedOptions,
  ): Promise<ResolvedEmbed>
}
