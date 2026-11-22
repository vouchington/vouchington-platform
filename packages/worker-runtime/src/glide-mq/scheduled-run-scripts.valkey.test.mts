import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Queue } from 'glide-mq'
import { createScheduledRunLease, type ScheduledRunLeaseClient } from './scheduled-run-lease.mts'
import { RELEASE_SCHEDULED_RUN_LUA } from './scheduled-run-scripts.mts'

/**
 * Runs the Lua against a real Valkey. CI starts no Valkey service, so this file skips unless
 * `VALKEY_URL` (`host:port`) is set. Locally: `valkey-server --port 6390` then
 * `VALKEY_URL=127.0.0.1:6390 pnpm exec vitest run packages/worker-runtime`.
 */
const url = process.env.VALKEY_URL

describe.skipIf(!url)('scheduled run Lua on a real Valkey', () => {
  let queue: Queue
  let raw: { customCommand(args: string[]): Promise<unknown> }
  let client: ScheduledRunLeaseClient
  const prefix = `lease-test-${crypto.randomUUID()}`
  const name = 'lease-queue'
  const base = `${prefix}:{${name}}`

  const command = (...args: string[]) => raw.customCommand(args)

  beforeAll(async () => {
    const [host, port] = url!.split(':')
    queue = new Queue(name, {
      connection: { addresses: [{ host: host!, port: Number(port) }] },
      prefix,
    })
    raw = (await queue.getClient()) as unknown as typeof raw
    client = {
      hget: async (key, field) => (await command('HGET', key, field)) as string | null,
      get: async (key) => (await command('GET', key)) as string | null,
      set: (key, value, expiryMs) => command('SET', key, value, 'PX', String(expiryMs)),
      hincrBy: (key, field, amount) => command('HINCRBY', key, field, String(amount)),
      runScript: (lua, keys, args) => command('EVAL', lua, String(keys.length), ...keys, ...args),
    }
  })

  afterAll(async () => {
    await queue.obliterate({ force: true })
    await queue.close()
  })

  const tick = (id: string) => {
    const moves: number[] = []
    return {
      id,
      schedulerName: 'repeat',
      opts: {},
      moveToDelayed: async (at: number) => {
        moves.push(at)
      },
      moves,
    } as never as Parameters<ReturnType<typeof createScheduledRunLease>>[1] & { moves: number[] }
  }

  it('admits one holder, counts a colliding tick once, and frees the lease on release', async () => {
    const lease = createScheduledRunLease({
      client,
      prefix,
      logger: { info() {}, warn() {}, error() {} },
    })
    const first = await lease(name, tick('a'), { lockDuration: 20_000 })
    expect(await client.get(`${base}:run:repeat`)).toBe('a')
    expect(await client.get(`${base}:run-previous:repeat`)).toBe('a')

    expect(await lease(name, tick('b'), { lockDuration: 20_000 })).toBeNull()
    expect(await lease(name, tick('b'), { lockDuration: 20_000 })).toBeNull()
    expect(await client.hget(`${base}:run-metrics`, 'skipped_overlap')).toBe('1')
    expect(await client.hget(`${base}:job:b`, 'scheduledRunLeaseSkipped')).toBe('repeat')

    // The same job retrying re-acquires its own lease.
    expect(await lease(name, tick('a'), { lockDuration: 20_000 })).not.toBeNull()

    await first?.()
    expect(await client.get(`${base}:run:repeat`)).toBeNull()
    expect(await client.get(`${base}:run-previous:repeat`)).toBeNull()
    // A tick already recorded as skipped never runs once the holder is gone.
    expect(await lease(name, tick('b'), { lockDuration: 20_000 })).toBeNull()
  })

  it('defers admitted retained work instead of dropping it', async () => {
    const lease = createScheduledRunLease({
      client,
      prefix,
      logger: { info() {}, warn() {}, error() {} },
    })
    const holder = await lease(name, tick('holder'), { lockDuration: 20_000 })
    await command('HSET', `${base}:job:retained`, 'scheduledRunLeaseAdmitted', 'repeat')
    const retained = tick('retained')
    expect(await lease(name, retained, { lockDuration: 20_000 })).toBeNull()
    expect(retained.moves).toHaveLength(1)
    expect(await client.hget(`${base}:run-metrics`, 'deferred_admitted')).toBe('1')
    await holder?.()
  })

  it('still skips when the metrics key is damaged', async () => {
    const reports: Error[] = []
    const lease = createScheduledRunLease({
      client,
      prefix,
      onError: (error) => reports.push(error),
      logger: { info() {}, warn() {}, error() {} },
    })
    const holder = await lease(name, tick('holder2'), { lockDuration: 20_000 })
    await command('SET', `${base}:run-metrics`, 'wrong-type')
    expect(await lease(name, tick('late'), { lockDuration: 20_000 })).toBeNull()
    expect(reports.map((error) => error.message)).toEqual([
      `Scheduled overlap metric increment failed for ${name}/repeat`,
    ])
    await holder?.()
  })

  it('only releases a lease the caller holds', async () => {
    await command('SET', `${base}:run:other`, 'owner')
    expect(
      await client.runScript(
        RELEASE_SCHEDULED_RUN_LUA,
        [`${base}:run:other`, `${base}:x`],
        ['intruder'],
      ),
    ).toBe(0)
    expect(await client.get(`${base}:run:other`)).toBe('owner')
    expect(
      await client.runScript(
        RELEASE_SCHEDULED_RUN_LUA,
        [`${base}:run:other`, `${base}:x`],
        ['owner'],
      ),
    ).toBe(1)
    expect(await client.get(`${base}:run:other`)).toBeNull()
  })
})
