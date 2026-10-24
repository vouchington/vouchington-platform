import type { Job } from 'glide-mq'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkerLogger } from './logger.mts'

const job = (overrides: Record<string, unknown> = {}) =>
  ({ id: '1', name: 'send', data: { a: 1 }, ...overrides }) as unknown as Job

function create(options: Partial<ConstructorParameters<typeof WorkerLogger>[0]> = {}) {
  const lines: string[] = []
  const logger = new WorkerLogger({ enabled: true, write: (line) => lines.push(line), ...options })
  return { logger, lines }
}

afterEach(() => vi.restoreAllMocks())

describe('WorkerLogger', () => {
  it('reports whether it is enabled and does nothing when disabled', () => {
    const { logger, lines } = create({ enabled: false, level: 'info' })

    logger.onActive('q', job())
    logger.onCompleted('q', job())
    logger.onFailed('q', job(), new Error('x'))

    expect(logger.isEnabled()).toBe(false)
    expect(lines).toEqual([])
  })

  it('logs failures with name, message, label and data in error mode, but not completions', () => {
    const { logger, lines } = create()

    logger.onCompleted('q', job())
    logger.onFailed('q', job(), new TypeError('bad input'))

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('ERR')
    expect(lines[0]).toContain('q/send {"a":1} TypeError: bad input\n')
  })

  it('logs completions in info mode', () => {
    const { logger, lines } = create({ level: 'info' })

    logger.onCompleted('q', job())

    expect(lines[0]).toContain(' ok')
    expect(lines[0]).toContain('q/send {"a":1}')
    expect(lines[0]).not.toMatch(/\{"a":1\} \S/)
  })

  it('times from onActive, and clears the start time on completion in error mode', () => {
    const bigint = vi.spyOn(process.hrtime, 'bigint')
    bigint.mockReturnValueOnce(0n).mockReturnValueOnce(300_000_000n)
    const { logger, lines } = create()

    logger.onActive('q', job())
    logger.onFailed('q', job(), 'text failure')

    expect(lines[0]).toContain('\x1b[38;5;208m300ms\x1b[0m')
    expect(lines[0]).toContain('text failure')
    bigint.mockReturnValueOnce(0n)
    logger.onActive('q', job())
    logger.onCompleted('q', job())
    logger.onFailed('q', job({ processedOn: 1, finishedOn: 11 }), 'x')
    expect(lines[1]).toContain(' 10ms')
  })

  it.each([
    [10, ' 10ms', false],
    [60, '\x1b[33m 60ms\x1b[0m', true],
    [300, '\x1b[38;5;208m300ms\x1b[0m', true],
    [900, '\x1b[31m900ms\x1b[0m', true],
  ])('colors a %ims timing by threshold', (ms, expected) => {
    const { logger, lines } = create()

    logger.onFailed('q', job({ processedOn: 1000, finishedOn: 1000 + ms }), 'x')

    expect(lines[0]).toContain(expected)
  })

  it('uses custom thresholds and reports 0ms without any timing source', () => {
    const { logger, lines } = create({ timingThresholds: { yellow: 1, orange: 2, red: 3 } })

    logger.onFailed('q', job({ processedOn: 1, finishedOn: 3 }), 'x')
    logger.onFailed('q', job(), 'x')

    expect(lines[0]).toContain('\x1b[38;5;208m  2ms\x1b[0m')
    expect(lines[1]).toContain('  0ms')
  })

  it('truncates long data and errors at 120 characters', () => {
    const { logger, lines } = create()

    logger.onFailed('q', job({ data: { text: 'x'.repeat(300) } }), 'y'.repeat(300))

    expect(lines[0]).toContain(`${'x'.repeat(120 - 9)}...`)
    expect(lines[0]).toContain(`${'y'.repeat(120)}...`)
  })

  it('falls back for unserializable and undefined data', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const { logger, lines } = create()

    logger.onFailed('q', job({ data: circular }), 'x')
    logger.onFailed('q', job({ data: undefined }), 'x')

    expect(lines[0]).toContain('[unserializable]')
    expect(lines[1]).toContain('undefined')
  })

  it('formats nameless, empty-message and non-string errors', () => {
    const { logger, lines } = create()
    const nameless = new Error('boom')
    nameless.name = ''
    const empty = new RangeError('')
    const unformattable = Object.create(null, {
      [Symbol.toPrimitive]: {
        value: () => {
          throw new Error('no string form')
        },
      },
    })

    logger.onFailed('q', job(), nameless)
    logger.onFailed('q', job(), empty)
    logger.onFailed('q', job(), 42)
    logger.onFailed('q', job(), unformattable)

    expect(lines[0]).toContain('Error: boom')
    expect(lines[1]).toContain('RangeError\n')
    expect(lines[2]).toContain(' 42\n')
    expect(lines[3]).toContain('[unformattable error]')
  })

  it('release drops the timing entry without logging', () => {
    const bigint = vi.spyOn(process.hrtime, 'bigint')
    bigint.mockReturnValueOnce(0n)
    const { logger, lines } = create()

    logger.onActive('q', job())
    logger.release('q', job())
    logger.onFailed('q', job({ processedOn: 1, finishedOn: 8 }), 'x')

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('  7ms')
  })

  it('prints a supplied payload and error text instead of the job data and error', () => {
    const { logger, lines } = create({ level: 'info' })

    logger.onCompleted('q', job(), { safe: true })
    logger.onFailed('q', job(), new Error('ignored'), { safe: 1 }, 'full\ntext')

    expect(lines[0]).toContain('{"safe":true}')
    expect(lines[1]).toContain('{"safe":1} full\ntext')
    expect(lines.join('')).not.toContain('"a":1')
  })

  it('writes to stdout by default', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    new WorkerLogger({ enabled: true }).onFailed('q', job(), 'x')

    expect(write).toHaveBeenCalledTimes(1)
  })
})
