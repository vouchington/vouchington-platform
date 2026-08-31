import { extractDocumentMetadata } from './metadata.mts'
import type { OEmbedMetadata } from './oembed.mts'
import { matchEmbedProvider } from './providers.mts'
import type { Configuration } from './runtime.mts'
import type { EmbedResolutionPlan, ResolveExtractedEmbedInput, ResolvedEmbed } from './types.mts'

export async function createResolutionPlan(
  options: Configuration,
  requestedUrl: URL,
  documentUrl: URL,
  content: ResolveExtractedEmbedInput['content'],
): Promise<EmbedResolutionPlan> {
  const document = extractDocumentMetadata(content, documentUrl)
  const provider = matchEmbedProvider(documentUrl, options.providers)
  const endpoint = provider?.match.oEmbedUrl ?? document.oEmbedUrl
  const playerUrl = provider?.match.playerUrl ?? null
  const player =
    playerUrl &&
    (await options.authorizeUrl(playerUrl, { purpose: 'player', sourceUrl: documentUrl }))
      ? { url: playerUrl.toString(), width: null, height: null }
      : null
  return {
    embed: {
      kind: player ? 'player' : 'article',
      requestedUrl: requestedUrl.toString(),
      resolvedUrl: documentUrl.toString(),
      title: document.title,
      description: document.description,
      author: null,
      provider: provider
        ? {
            key: provider.provider.key,
            name: null,
            url: null,
            resourceId: provider.match.resourceId,
          }
        : null,
      thumbnail: document.thumbnailUrl
        ? { url: document.thumbnailUrl.toString(), width: null, height: null }
        : null,
      player,
    },
    oEmbedUrl: endpoint?.toString() ?? null,
  }
}

export async function enrichResolutionPlan(
  options: Configuration,
  plan: EmbedResolutionPlan,
  oembed: OEmbedMetadata,
): Promise<ResolvedEmbed> {
  const sourceUrl = new URL(plan.embed.resolvedUrl)
  const playerOEmbed = ['video', 'rich'].includes(oembed.type?.toLowerCase() ?? '') ? oembed : null
  const playerUrl = plan.embed.player?.url
    ? new URL(plan.embed.player.url)
    : (playerOEmbed?.playerUrl ?? null)
  const player =
    playerUrl && (await options.authorizeUrl(playerUrl, { purpose: 'player', sourceUrl }))
      ? {
          url: playerUrl.toString(),
          width: playerOEmbed?.width ?? plan.embed.player?.width ?? null,
          height: playerOEmbed?.height ?? plan.embed.player?.height ?? null,
        }
      : null
  return {
    ...plan.embed,
    kind: player ? 'player' : 'article',
    title: oembed.title ?? plan.embed.title,
    author:
      oembed.authorName || oembed.authorUrl
        ? { name: oembed.authorName, url: oembed.authorUrl?.toString() ?? null }
        : plan.embed.author,
    provider:
      plan.embed.provider || oembed.providerName || oembed.providerUrl
        ? {
            key: plan.embed.provider?.key ?? null,
            name: oembed.providerName ?? plan.embed.provider?.name ?? null,
            url: oembed.providerUrl?.toString() ?? plan.embed.provider?.url ?? null,
            resourceId: plan.embed.provider?.resourceId ?? null,
          }
        : null,
    thumbnail:
      oembed.thumbnailUrl || plan.embed.thumbnail
        ? {
            url: oembed.thumbnailUrl?.toString() ?? plan.embed.thumbnail!.url,
            width: oembed.thumbnailWidth ?? plan.embed.thumbnail?.width ?? null,
            height: oembed.thumbnailHeight ?? plan.embed.thumbnail?.height ?? null,
          }
        : null,
    player,
  }
}
