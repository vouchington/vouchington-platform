import { AsyncLocalStorage } from 'node:async_hooks'
import type { QueryTimingInput } from '../types.mts'
import {
  summarizeRequestQueries,
  type RequestQuery,
  type RequestQuerySummary,
} from './query-summary.mts'

export interface WorkerQueryIdentity {
  queue: string
  jobs: readonly Readonly<{ id: string; name: string }>[]
}

export interface WorkerQueryProfile {
  readonly identity: WorkerQueryIdentity
  readonly queries: () => readonly Readonly<RequestQuery>[]
  readonly summarize: () => RequestQuerySummary
  /** Live direct children: callers can traverse every nested invocation without a request scope. */
  readonly workerProfiles: () => readonly WorkerQueryProfile[]
  readonly reportingFailures: () => readonly Readonly<{ stage: string; reason: unknown }>[]
  readonly reportFailure: (stage: string, reason: unknown) => undefined
}

export interface RequestQueryProfile {
  run: <Result>(handler: () => Result) => Result
  summarize: () => RequestQuerySummary
  /** Direct owned roots; each worker view exposes its own live descendants. */
  workerProfiles: () => readonly WorkerQueryProfile[]
}

export interface QueryProfilesOptions {
  /** Global registry key. Defaults to a package-owned `Symbol.for` key. */
  registryKey?: symbol
  /** Extra annotations excluded from repeat detection, added to transaction-control ones. */
  excludedFromRepeats?: Iterable<string>
}

export type QueryProfileObserverInput = Pick<
  QueryTimingInput,
  'annotation' | 'durationMs' | 'cursorBatches' | 'pipelined'
>

export interface QueryProfiles {
  /** Pass to `createQueryTimingRecorder({ observe })`; a no-op outside a profile scope. */
  observe: (input: QueryProfileObserverInput) => void
  createRequestQueryProfile: () => RequestQueryProfile
  /** Retains every worker timing separately; owners register synchronously, never join completion. */
  runIndependentWorker: <Result>(
    identity: WorkerQueryIdentity,
    handler: () => Result | PromiseLike<Result>,
    onOwnedProfile?: (profile: WorkerQueryProfile) => void,
  ) => { completion: Promise<Result>; profile: WorkerQueryProfile }
}

const DEFAULT_QUERY_PROFILES_KEY = Symbol.for('@vouchington/postgres.queryProfiles')
const TRANSACTION_CONTROL_ANNOTATIONS = [
  'beginTransaction',
  'beginBoundedTransaction',
  'withClientTransaction',
]

interface Registry {
  scopes: AsyncLocalStorage<RequestQuery[]>
  owners: WeakMap<RequestQuery[], WorkerQueryProfile[]>
}

function sharedRegistry(key: symbol): Registry {
  const holder = globalThis as typeof globalThis & { [slot: symbol]: Registry | undefined }
  return (holder[key] ??= { scopes: new AsyncLocalStorage(), owners: new WeakMap() })
}

function assertIdentity(identity: WorkerQueryIdentity): void {
  const valid =
    Boolean(identity.queue) &&
    identity.jobs.length > 0 &&
    identity.jobs.every(
      (job) => typeof job.id === 'string' && job.id && typeof job.name === 'string' && job.name,
    )
  if (!valid) {
    throw new Error('Independent worker query profiles require actual queue/job identities')
  }
}

function createWorkerProfile(identity: WorkerQueryIdentity, queries: RequestQuery[]) {
  const children: WorkerQueryProfile[] = []
  const failures: { stage: string; reason: unknown }[] = []
  const profile: WorkerQueryProfile = Object.freeze({
    identity: Object.freeze({
      queue: identity.queue,
      jobs: Object.freeze(
        identity.jobs.map((job) => Object.freeze({ id: job.id, name: job.name })),
      ),
    }),
    queries: () => queries.map((query) => ({ ...query })),
    summarize: () => summarizeRequestQueries(queries),
    workerProfiles: () => [...children],
    reportingFailures: () => failures.map((failure) => ({ ...failure })),
    reportFailure: (stage: string, reason: unknown): undefined => {
      failures.push({ stage, reason })
      return undefined
    },
  })
  return { profile, children }
}

/** Request and worker query profiling over an async-local registry shared across module graphs. */
export function createQueryProfiles(options: QueryProfilesOptions = {}): QueryProfiles {
  const { scopes, owners } = sharedRegistry(options.registryKey ?? DEFAULT_QUERY_PROFILES_KEY)
  const excluded = new Set([
    ...TRANSACTION_CONTROL_ANNOTATIONS,
    ...(options.excludedFromRepeats ?? []),
  ])
  return {
    observe(input) {
      const queries = scopes.getStore()
      if (!queries) return
      const endMs = performance.now()
      queries.push({
        annotation: input.annotation,
        startMs: endMs - input.durationMs,
        endMs,
        excludedFromRepeats:
          input.cursorBatches !== undefined ||
          input.pipelined === true ||
          (input.annotation !== null && excluded.has(input.annotation)),
      })
    },
    createRequestQueryProfile() {
      const queries: RequestQuery[] = []
      const workers: WorkerQueryProfile[] = []
      owners.set(queries, workers)
      return {
        run: (handler) => scopes.run(queries, handler),
        summarize: () => summarizeRequestQueries(queries),
        workerProfiles: () => [...workers],
      }
    },
    runIndependentWorker(identity, handler, onOwnedProfile) {
      assertIdentity(identity)
      const queries: RequestQuery[] = []
      const { profile, children } = createWorkerProfile(identity, queries)
      const parent = scopes.getStore()
      if (parent) owners.get(parent)?.push(profile)
      owners.set(queries, children)
      try {
        onOwnedProfile?.(profile)
      } catch (err) {
        profile.reportFailure('profile-owner', err)
      }
      const completion = scopes.run(queries, async () => handler())
      return { completion, profile }
    },
  }
}
