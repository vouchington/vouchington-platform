import { describe, expect, it, vi } from 'vitest'
import {
  acquireTerminalJobRemoval,
  type TerminalJobRemovalClient,
} from './terminal-job-removal.mts'

function fake(state: string | null, removal: readonly unknown[] | null = [1]) {
  return {
    watch: vi.fn(async () => 'OK'),
    unwatch: vi.fn(async () => 'OK'),
    hget: vi.fn(async (_key: string, field: string) => (field === 'state' ? state : 'payload')),
    removeJob: vi.fn(async () => removal),
  } satisfies TerminalJobRemovalClient
}

describe('acquireTerminalJobRemoval', () => {
  it.each(['missing', 'live'] as const)(
    'reports a %s job and releases the WATCH once',
    async (kind) => {
      const client = fake(kind === 'missing' ? null : 'active')
      const removal = await acquireTerminalJobRemoval(client, 'ns:{q}', 'j1')
      expect(removal.state).toBe(kind)
      expect(client.watch).toHaveBeenCalledWith(['ns:{q}:job:j1'])
      await removal.release()
      await removal.release()
      expect(client.unwatch).toHaveBeenCalledOnce()
    },
  )

  it.each(['completed', 'failed'])('exposes a %s job for reading and removal', async (state) => {
    const client = fake(state)
    const removal = await acquireTerminalJobRemoval(client, 'ns:{q}', 'j1')
    if (removal.state !== 'terminal') throw new Error('Expected a terminal job')
    expect(removal.terminalState).toBe(state)
    expect(await removal.readData()).toBe('payload')
    expect(await removal.remove()).toBe(true)
    expect(client.removeJob).toHaveBeenCalledWith(
      [
        'ns:{q}:job:j1',
        'ns:{q}:stream',
        'ns:{q}:scheduled',
        'ns:{q}:completed',
        'ns:{q}:failed',
        'ns:{q}:events',
        'ns:{q}:log:j1',
      ],
      ['j1'],
    )
    await removal.release()
    expect(client.unwatch).not.toHaveBeenCalled()
  })

  it('reports no removal when the native function removes nothing or a retry changed the hash', async () => {
    for (const reply of [[0], null]) {
      const removal = await acquireTerminalJobRemoval(fake('failed', reply), 'ns:{q}', 'j1')
      if (removal.state !== 'terminal') throw new Error('Expected a terminal job')
      // eslint-disable-next-line no-await-in-loop
      expect(await removal.remove()).toBe(false)
    }
  })

  it('drops the WATCH and rethrows when reading the state fails', async () => {
    const failure = new Error('read failed')
    const client = fake('failed')
    client.hget.mockRejectedValueOnce(failure)
    await expect(acquireTerminalJobRemoval(client, 'ns:{q}', 'j1')).rejects.toBe(failure)
    expect(client.unwatch).toHaveBeenCalledOnce()
    client.hget.mockRejectedValueOnce(failure)
    client.unwatch.mockRejectedValueOnce(new Error('unwatch failed'))
    await expect(acquireTerminalJobRemoval(client, 'ns:{q}', 'j1')).rejects.toBe(failure)
  })
})
