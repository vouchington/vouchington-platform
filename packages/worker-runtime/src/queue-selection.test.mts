import { describe, expect, it, vi } from 'vitest'

import { isQueueSelected, parseQueueSelection } from './queue-selection.mts'

const queueNames = ['email', 'images', 'webhook'] as const

describe('parseQueueSelection', () => {
  it('selects every queue when QUEUES is absent or blank', () => {
    const selection = parseQueueSelection(undefined, queueNames)

    expect(selection.mode).toBe('all')
    expect(queueNames.every((queueName) => isQueueSelected(selection, queueName))).toBe(true)
    expect(parseQueueSelection('  ', queueNames).mode).toBe('all')
  })

  it('supports include and exclude lists', () => {
    const include = parseQueueSelection('email, webhook', queueNames)
    const exclude = parseQueueSelection('-email,-webhook', queueNames)

    expect(isQueueSelected(include, 'email')).toBe(true)
    expect(isQueueSelected(include, 'images')).toBe(false)
    expect(isQueueSelected(exclude, 'email')).toBe(false)
    expect(isQueueSelected(exclude, 'images')).toBe(true)
  })

  it('rejects malformed and strict unknown selections', () => {
    expect(() => parseQueueSelection('email,-images', queueNames)).toThrow('not both')
    expect(() => parseQueueSelection('email,,images', queueNames)).toThrow('empty entries')
    expect(() => parseQueueSelection('-', queueNames)).toThrow('include a queue name')
    expect(() => parseQueueSelection('missing', queueNames)).toThrow('unknown queue name')
  })

  it('drops unknown names for tolerant include and exclude selections', () => {
    const onUnknownIncludes = vi.fn<(names: readonly string[]) => void>()
    const include = parseQueueSelection('email,missing', queueNames, {
      dropUnknownIncludes: true,
      onUnknownIncludes,
    })
    const exclude = parseQueueSelection('-email,-other-runtime', queueNames, {
      dropUnknownIncludes: true,
      onUnknownIncludes,
    })

    expect(isQueueSelected(include, 'email')).toBe(true)
    expect(isQueueSelected(include, 'images')).toBe(false)
    expect(isQueueSelected(exclude, 'email')).toBe(false)
    expect(isQueueSelected(exclude, 'images')).toBe(true)
    expect(onUnknownIncludes).toHaveBeenCalledExactlyOnceWith(['missing'])
  })

  it('does not report tolerant includes when every name is known', () => {
    const onUnknownIncludes = vi.fn<(names: readonly string[]) => void>()

    parseQueueSelection('email', queueNames, { dropUnknownIncludes: true, onUnknownIncludes })

    expect(onUnknownIncludes).not.toHaveBeenCalled()
  })
})
