import { describe, expect, it } from 'vitest'

import {
  matchEmbedProvider,
  peerTubeProvider,
  vimeoProvider,
  youtubeProvider,
} from './providers.mts'

describe('provider presets', () => {
  it.each([
    ['https://www.youtube.com/watch?v=abc_123', youtubeProvider, 'abc_123'],
    ['https://youtu.be/abc_123', youtubeProvider, 'abc_123'],
    ['https://vimeo.com/12345', vimeoProvider, '12345'],
    ['https://video.example/videos/watch/uuid', peerTubeProvider, 'uuid'],
    ['https://video.example/w/short-id', peerTubeProvider, 'short-id'],
  ])('matches %s', (url, provider, resourceId) => {
    expect(provider.match(new URL(url))?.resourceId).toBe(resourceId)
  })

  it('uses the privacy-enhanced YouTube player', () => {
    expect(
      youtubeProvider.match(new URL('https://youtube.com/watch?v=abc'))?.playerUrl?.origin,
    ).toBe('https://www.youtube-nocookie.com')
  })

  it('matches only caller-selected providers', () => {
    const url = new URL('https://youtube.com/watch?v=abc')
    expect(matchEmbedProvider(url, [])).toBeNull()
    expect(matchEmbedProvider(url, [youtubeProvider])?.provider.key).toBe('youtube')
    expect(matchEmbedProvider(url.href, [youtubeProvider])?.provider.key).toBe('youtube')
    expect(matchEmbedProvider(url, [vimeoProvider, youtubeProvider])?.provider.key).toBe('youtube')
  })

  it.each([
    ['https://youtube.com/embed/embedded', youtubeProvider, 'embedded'],
    ['https://youtube.com/shorts/short', youtubeProvider, 'short'],
    ['https://youtube.com/channel/no-video', youtubeProvider, null],
    ['https://youtube.com/watch?v=%20', youtubeProvider, null],
    ['https://youtu.be/', youtubeProvider, null],
    ['https://example.com/watch?v=abc', youtubeProvider, null],
    ['https://example.com/123', vimeoProvider, null],
    ['https://vimeo.com/not-a-number', vimeoProvider, null],
    ['https://example.com/article', peerTubeProvider, null],
  ])('handles provider edge %s', (url, provider, expected) => {
    expect(provider.match(new URL(url))?.resourceId ?? null).toBe(expected)
  })
})
