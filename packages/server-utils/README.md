# @vouchington/server-utils

Dependency-free server-only utilities that run on both Node.js 24 and Bun. Code here may import
Node built-ins that both runtimes implement (`node:crypto`, `node:child_process`,
`node:fs/promises`, `node:stream`, `node:util`, `node:http`, `node:path`); it has no third-party
runtime dependencies. Portable code that imports no Node built-in belongs in
`@vouchington/utils`. Every export entry is bundled with Bun and compared with Node by
`pnpm run test:bun-bundles`. This package deliberately has no root export: import the capability
you use from an explicit subpath.

```ts
import { createTokenSecrets } from '@vouchington/server-utils/token-secrets'
import { buildSignatureHeaders, verifySignature } from '@vouchington/server-utils/http-signatures'
import { runCommand } from '@vouchington/server-utils/child-process'
```

## Subpaths

- `api-errors`: the house JSON error envelope (`message`, optional `code`, `request_id`, `stack`),
  status/message/code extraction helpers, and `buildApiErrorEnvelope`, which redacts 5xx details
  unless the caller sets `exposeDetails`. Callers own serialization, logging, and environment policy.
- `child-process`: `runCommand({ command, args, stdin, stdout, signal,
  timeoutMs, stderrCapBytes, env })` spawns an explicit argv with no shell, streams stdin and stdout,
  keeps stderr up to a byte cap, and SIGKILLs on abort or timeout. By default the child sees only
  `PATH`, `TMPDIR`, and `LC_ALL=C`; `env` replaces that. Non-zero exit, signal, abort, and timeout
  reject with `CommandFailedError` (`command`, `reason`, `exitCode`, `signal`, `stderr`, and
  `timeoutMs` when `reason` is `'timeout'`). The message includes at most the last 1 KiB of stderr;
  `.stderr` keeps the full captured buffer. Invalid arguments throw a `RangeError` or `TypeError`
  with a `command` attribute.
- `error-tree`: `formatErrorTree(error, { maxDepth?, maxNested? })` renders an error with its
  `errors[]` and `cause` chain, marks circular references, and reports how many nested errors the
  depth and count limits omitted (defaults 5 and 20).
- `graceful-shutdown`: `createGracefulShutdown({ gracePeriodMs, onError, closeResources, flush,
  log, logError, process, forceExit })` runs callbacks, then drain callbacks, then `closeResources`,
  then `flush`, once, with an unref'd force-exit fallback (code 0 after success, 1 on timeout);
  `installSignalHandlers()` wires SIGTERM and SIGINT. `createShutdownRegistry()` is a late-binding
  `register(name, shutdown)` / `close({ shutdowns, log })` registry that returns failures instead of
  throwing, and `shutdownForOneOffCommand({ gracePeriodMs, close })` bounds a short-lived command's
  close and throws an `AggregateError` whose message lists the failed resources. The grace period,
  resource names, error reporting, and signal-registration policy are all injected.
  Failures are `ShutdownError`s with fixed messages and attributes to filter on: `resource` and
  `cause` from the registry (`cause` is the original thrown value, including non-Errors), and
  `phase` (`'callbacks' | 'drain' | 'closeResources' | 'flush'`), `signal`, and `cause` from
  `onError`. `logError(message, context)` receives `{ errorCount, signal, phases, resources }` once
  when shutdown finished with failures, and `{ phase, signal, gracePeriodMs, exitCode }` when the
  force-exit timer fires (`phase` is `'completed'` if the steps had already finished).
- `http-signatures`: Cavage-12 HTTP Signatures. Callers pass signed
  headers, allowed algorithms, and `maxAgeSeconds` on both sign and verify. The package has no
  default header set or product keyId policy.
- `jsonl-partition-writer`: `createJsonlPartitionWriter({ directory, partition, onError })` buffers
  records and appends them to per-partition JSON Lines files on count, size, or time (defaults 500
  records, 4 MiB, 1 s). `partition(record)` returns the relative file path, which must stay inside
  `directory`; background failures go to `onError`, explicit `flush()` rejects with the first one.
- `token-secrets`: purpose-bound HMAC and AES-256-GCM encryption.
  `createTokenSecrets({ hashSecret, encryptionKeys })` throws for invalid keys or ciphertext.
- `url-signing`: HMAC SHA-256 path signing (`signPathWithKey`, `signPath`,
  `verifyPathSignature` with rotation, `signExpiringPath`/`verifyExpiringPath` with an injectable
  clock), `parseSigningKeys`, `buildSignedProxyUrl` (caller-owned origin, route prefix, query, and
  skip predicate), and `createProtectedHostPolicy` (Unicode bare hosts are
  canonicalized to punycode), and `matchRouteSegment`.
  Prefixes, hosts, and keys are injected; verification fails closed with no keys unless
  `allowUnsignedWhenNoKeys` is set.
- `web-push-vapid`: VAPID key generation/matching and ES256 JWT/`Authorization` builders.
  Applications own key storage, subject, and delivery.

Applications supply all product identifiers, policy, keys, and persistence.
