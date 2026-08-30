import type { EmbedProvider, EmbedProviderMatch } from './types.mts'

export const youtubeProvider: EmbedProvider = {
  key: 'youtube',
  match(url) {
    const id = youtubeId(url)
    if (!id) return null
    return {
      resourceId: id,
      playerUrl: new URL(`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`),
      oEmbedUrl: oEmbedUrl('https://www.youtube.com/oembed', url),
    }
  },
}

export const vimeoProvider: EmbedProvider = {
  key: 'vimeo',
  match(url) {
    if (!/^(www\.)?vimeo\.com$/i.test(url.hostname)) return null
    const id = url.pathname.match(/^\/(\d+)(?:\/|$)/)?.[1]
    if (!id) return null
    return {
      resourceId: id,
      playerUrl: new URL(`https://player.vimeo.com/video/${encodeURIComponent(id)}`),
      oEmbedUrl: oEmbedUrl('https://vimeo.com/api/oembed.json', url),
    }
  },
}

export const peerTubeProvider: EmbedProvider = {
  key: 'peertube',
  match(url) {
    const match = url.pathname.match(/^\/(?:videos\/watch|w)\/([^/?#]+)/)
    if (!match?.[1]) return null
    return {
      resourceId: match[1],
      playerUrl: new URL(`/videos/embed/${encodeURIComponent(match[1])}`, url.origin),
    }
  },
}

export function matchEmbedProvider(
  url: string | URL,
  providers: readonly EmbedProvider[],
): { provider: EmbedProvider; match: EmbedProviderMatch } | null {
  const parsed = url instanceof URL ? url : new URL(url)
  for (const provider of providers) {
    const match = provider.match(parsed)
    if (match) return { provider, match }
  }
  return null
}

function youtubeId(url: URL): string | null {
  if (/^(www\.)?youtube\.com$/i.test(url.hostname)) {
    if (url.pathname === '/watch') return nonempty(url.searchParams.get('v'))
    return nonempty(url.pathname.match(/^\/(?:embed|shorts)\/([^/?#]+)/)?.[1] ?? null)
  }
  if (/^youtu\.be$/i.test(url.hostname)) return nonempty(url.pathname.slice(1).split('/')[0]!)
  return null
}

function nonempty(value: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function oEmbedUrl(endpoint: string, source: URL): URL {
  const url = new URL(endpoint)
  url.searchParams.set('url', source.toString())
  url.searchParams.set('format', 'json')
  return url
}

export type { EmbedProvider, EmbedProviderMatch } from './types.mts'
