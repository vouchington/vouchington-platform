import { describe, expect, it, vi } from 'vitest'
import { createScriptRegistry } from './script-registry.mts'

describe('createScriptRegistry', () => {
  it('creates scripts through the factory and hooks exit once', () => {
    const once = vi.fn()
    const registry = createScriptRegistry((code) => ({ code, release: vi.fn() }), { once } as never)
    const first = registry.register('return 1')
    const second = registry.register('return 2')
    expect([first.code, second.code]).toEqual(['return 1', 'return 2'])
    expect(once).toHaveBeenCalledOnce()
    expect(once).toHaveBeenCalledWith('exit', expect.any(Function))
  })

  it('releases every script once, however often it is called', () => {
    const registry = createScriptRegistry((code) => ({ code, release: vi.fn() }), {
      once: vi.fn(),
    } as never)
    const scripts = [registry.register('a'), registry.register('b')]
    registry.releaseAll()
    registry.releaseAll()
    for (const script of scripts) expect(script.release).toHaveBeenCalledOnce()
  })

  it('hooks the real process by default', () => {
    const once = vi.spyOn(process, 'once').mockImplementation(() => process)
    createScriptRegistry(() => ({ release() {} })).register('return 1')
    expect(once).toHaveBeenCalledWith('exit', expect.any(Function))
    once.mockRestore()
  })
})
