// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { watchStaleAriaReferences } from './stale-aria.js'

afterEach(() => {
  document.body.innerHTML = ''
})

function mount(html: string): HTMLInputElement {
  document.body.innerHTML = html
  return document.querySelector('input')!
}

describe('watchStaleAriaReferences', () => {
  it('removes dangling references immediately', () => {
    const input = mount('<input aria-activedescendant="gone" aria-controls="missing" />')
    watchStaleAriaReferences(input)
    expect(input.hasAttribute('aria-activedescendant')).toBe(false)
    expect(input.hasAttribute('aria-controls')).toBe(false)
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps references that resolve and ignores absent ones', () => {
    const input = mount(
      '<div id="a"></div><div id="b"></div><input aria-activedescendant="a" aria-controls="b" aria-expanded="true" />',
    )
    watchStaleAriaReferences(input)
    expect(input.getAttribute('aria-activedescendant')).toBe('a')
    expect(input.getAttribute('aria-controls')).toBe('b')
    expect(input.getAttribute('aria-expanded')).toBe('true')
    const bare = mount('<input />')
    watchStaleAriaReferences(bare)
    expect(bare.attributes.length).toBe(0)
  })

  it('cleans up again when attributes change, until stopped', async () => {
    const input = mount('<input />')
    const stop = watchStaleAriaReferences(input)
    input.setAttribute('aria-activedescendant', 'later-gone')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(input.hasAttribute('aria-activedescendant')).toBe(false)
    stop()
    input.setAttribute('aria-activedescendant', 'later-gone')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(input.getAttribute('aria-activedescendant')).toBe('later-gone')
  })

  it('watches the cmdk root subtree when present', async () => {
    document.body.innerHTML =
      '<div cmdk-root=""><input aria-controls="list" /><div id="list"></div></div>'
    const input = document.querySelector('input')!
    watchStaleAriaReferences(input)
    expect(input.getAttribute('aria-controls')).toBe('list')
    document.getElementById('list')!.remove()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(input.hasAttribute('aria-controls')).toBe(false)
  })
})
