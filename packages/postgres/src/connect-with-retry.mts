import type pg from 'pg'

import { nonNegativeInteger, positiveInteger } from './env-integers.mts'

const DEFAULT_CONNECT_RETRY_ATTEMPTS = 5
const DEFAULT_CONNECT_RETRY_DELAY_MS = 1_000

const RETRYABLE_CONNECT_ERROR_MESSAGES = new Set([
  'Connection terminated due to connection timeout',
  'timeout exceeded when trying to connect',
])

export interface ConnectRetryOptions {
  attempts: number
  delayMs: number
}

export function getConnectRetryOptions(env: NodeJS.ProcessEnv = process.env): ConnectRetryOptions {
  return {
    attempts: positiveInteger(env, 'PG_CONNECT_RETRY_ATTEMPTS', DEFAULT_CONNECT_RETRY_ATTEMPTS),
    delayMs: nonNegativeInteger(env, 'PG_CONNECT_RETRY_DELAY_MS', DEFAULT_CONNECT_RETRY_DELAY_MS),
  }
}

export function isRetryableConnectError(error: unknown): boolean {
  return error instanceof Error && RETRYABLE_CONNECT_ERROR_MESSAGES.has(error.message)
}

export async function withConnectRetry<Result>(
  operation: () => Promise<Result>,
  retry: ConnectRetryOptions = getConnectRetryOptions(),
): Promise<Result> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= retry.attempts || !isRetryableConnectError(error)) throw error
      await delay(retry.delayMs)
    }
  }
}

export function connectWithRetry(
  pool: Pick<pg.Pool, 'connect'>,
  retry?: ConnectRetryOptions,
): Promise<pg.PoolClient> {
  return withConnectRetry(() => pool.connect(), retry)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
