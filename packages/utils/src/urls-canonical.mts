interface CanonicalUrl {
  /** The input without tracking noise, still on its own scheme and host, so it stays fetchable. */
  readonly url: string
  /** A scheme-less dedupe key: `http`, `https`, `www.`, `m.`, and YouTube aliases share one value. */
  readonly identity: string
}

const TRACKING_PARAMS = new Set([
  '_ga',
  '_gl',
  'dclid',
  'fbclid',
  'gbraid',
  'gclid',
  'gclsrc',
  'igsh',
  'igshid',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  'msclkid',
  'ref_src',
  'ref_url',
  'ttclid',
  'twclid',
  'wbraid',
  'yclid',
])
// `videoseries` and `live_stream` are embed paths for playlists and channels, not video ids.
const YOUTUBE_NON_VIDEO_IDS = new Set(['live_stream', 'videoseries'])

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)
}

function cleanUrl(input: string | URL): URL | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const hostname = url.hostname.replace(/\.+$/, '')
  if (!hostname) return null
  url.hostname = hostname
  url.username = ''
  url.password = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  const params = new URLSearchParams(
    [...url.searchParams].filter(([name]) => !isTrackingParam(name)),
  )
  params.sort()
  url.search = params.toString()
  return url
}

/** Drops one `www.` or `m.` label unless that would leave a bare top-level domain, as for `m.co`. */
function identityHost(hostname: string): string {
  const stripped = hostname.replace(/^(?:www|m)\./, '')
  return stripped.includes('.') ? stripped : hostname
}

function youtubeVideoId(host: string, url: URL): string | null {
  let id: string | null | undefined
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0]
  else if (host !== 'youtube.com') return null
  else if (url.pathname === '/watch') id = url.searchParams.get('v')
  else id = url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1]
  return id && /^[\w-]+$/.test(id) && !YOUTUBE_NON_VIDEO_IDS.has(id) ? id : null
}

/**
 * Canonicalizes an http(s) URL, or returns null for anything else. Both results drop credentials,
 * the fragment, default ports, trailing dots and slashes, and tracking params, and sort the rest.
 * `identity` also ignores the scheme, `www.`, and `m.`, and reduces YouTube links to their video,
 * so `t` and `list` do not split it.
 */
export function canonicalizeUrl(input: string | URL): CanonicalUrl | null {
  const url = cleanUrl(input)
  if (!url) return null
  const host = identityHost(url.hostname)
  const authority = url.port ? `${host}:${url.port}` : host
  const videoId = url.port ? null : youtubeVideoId(host, url)
  if (videoId) return { url: url.href, identity: `youtube.com/watch?v=${videoId}` }
  const path = url.pathname === '/' && !url.search ? '' : url.pathname
  return { url: url.href, identity: `${authority}${path}${url.search}` }
}

/** True for an http(s) URL with no meaningful path or query, such as `https://youtube.com/`. */
export function isBareDomainUrl(input: string | URL): boolean {
  const url = cleanUrl(input)
  return url !== null && url.pathname === '/' && !url.search
}
