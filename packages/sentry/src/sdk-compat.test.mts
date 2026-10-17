import * as SentryBrowser from '@sentry/browser'
import * as SentryNode from '@sentry/node'
import { describe, expect, it } from 'vitest'
import type { BrowserSentryClient } from './browser.mts'
import type { NodeSentryClient } from './node.mts'

// Type-level contract: the real SDK modules must satisfy the structural clients the helpers take.
const node = SentryNode satisfies NodeSentryClient
const browser = SentryBrowser satisfies BrowserSentryClient

describe('SDK compatibility', () => {
  it('accepts the real Sentry modules', () => {
    expect(typeof node.init).toBe('function')
    expect(typeof browser.init).toBe('function')
  })
})
