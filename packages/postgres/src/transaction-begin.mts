import type pg from 'pg'

import type { ClientQueryTimingExtras } from './execute-client-query.mts'
import type { QueryValues } from './types.mts'

const ACTIVE_SQL_TRANSACTION = '25001'
const NESTED_BEGIN_MESSAGE =
  'Cannot begin a transaction on a pool client that already has a transaction open'

type PipelineFlag = { pipeline?: boolean | undefined }

export type ControlExtras = Omit<ClientQueryTimingExtras, 'onQueryTiming' | 'queryTimeoutMs'>
type Control = (text: string, values?: QueryValues, extras?: ControlExtras) => Promise<unknown>

/**
 * Builds the statements that open a transaction. `BEGIN` is unnamed so it uses
 * the simple protocol and cannot fail on its own: pg sends a Sync after each
 * pipelined query, so a failed `BEGIN` would leave the first statement to run
 * in autocommit.
 */
export function transactionStartControls(
  control: Control,
  statementTimeoutMs: number | undefined,
  extras: ControlExtras,
  settings: boolean,
): Array<() => Promise<unknown>> {
  const begin = () => control('BEGIN', undefined, { ...extras, prepare: false })
  if (statementTimeoutMs === undefined || !settings) return [begin]
  const timeout = [`${statementTimeoutMs}ms`]
  return [begin, () => control("SELECT set_config('statement_timeout', $1, true)", timeout, extras)]
}

export type BeginBatchOutcome<T> =
  | { kind: 'begun'; first: PromiseSettledResult<T> }
  | { kind: 'failed'; error: unknown }

/**
 * Pipelines `BEGIN` and any session settings with the transaction's first
 * statement, so they share one round trip, and reports a nested `BEGIN`.
 *
 * A pool can hand out a connection whose previous holder released it
 * mid-transaction. PostgreSQL answers a nested `BEGIN` with only a `25001`
 * WARNING, so committing would also persist the abandoned work. The notice
 * arrives before `BEGIN`'s ReadyForQuery, so the listener has observed it once
 * the batch settles. Unlike `getTransactionStatus()`, this needs no extra round
 * trip and cannot read a stale status. By then the first statement has already
 * run inside the abandoned outer transaction, so a nested `BEGIN` reports
 * `failed` and never exposes that statement's result. A failed control
 * statement also reports `failed`; the caller must discard the connection
 * either way.
 *
 * The listener spans the whole batch, so a first statement that itself raises
 * `25001` (a caller-issued `BEGIN`) is also treated as a nested `BEGIN`. Pass
 * `pipeline: false` when the connection is about to receive queries outside
 * the batch, so pg's own queue orders them behind it.
 */
export async function beginTransactionBatch<T>(
  client: pg.PoolClient,
  controls: ReadonlyArray<() => Promise<unknown>>,
  first: () => Promise<T>,
  pipeline = true,
): Promise<BeginBatchOutcome<T>> {
  let active = false
  const onNotice = (notice: { code?: string | undefined }) => {
    if (notice.code === ACTIVE_SQL_TRANSACTION) active = true
  }
  const flag = client as unknown as PipelineFlag
  const previous = flag.pipeline
  client.on('notice', onNotice)
  let settled: PromiseSettledResult<unknown>[]
  try {
    if (pipeline) flag.pipeline = true
    const pending: Promise<unknown>[] = controls.map((control) => control())
    pending.push(first())
    settled = await Promise.allSettled(pending)
  } finally {
    if (pipeline) flag.pipeline = previous
    client.off('notice', onNotice)
  }
  if (active) return { kind: 'failed', error: new Error(NESTED_BEGIN_MESSAGE) }
  const control = settled.slice(0, -1).find((result) => result.status === 'rejected')
  if (control?.status === 'rejected') return { kind: 'failed', error: control.reason }
  return { kind: 'begun', first: settled.at(-1) as PromiseSettledResult<T> }
}
