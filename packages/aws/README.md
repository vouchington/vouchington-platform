# @vouchington/aws

Primitives for AWS SDK v3: command builders, batching and chunking, attribute and record codecs,
and error classifiers. The application constructs and owns the clients, regions, credentials,
queue URLs, stream names, and namespaces, and decides when and how to send, retry, or record.
Each client package is an optional peer; install only the services you use. S3 stays in
`@vouchington/media`.

## Subpaths

- `/ses`: `buildEmailCommand`, `buildSendEmailCommand`, `buildSendRawEmailCommand`,
  `buildRawEmailMessage` (base64 MIME with caller headers, CR/LF rejected), and `SES_CLIENT_CONFIG`
  (`maxAttempts: 1`, dual-stack). Source, reply-to, and BCC addresses are inputs.
- `/sqs`: `SQS_CLIENT_CONFIG`, `encodeMessageAttributes`, `decodeMessageAttributes`,
  `chunkSendEntries`, `chunkDeleteEntries`, `buildSendMessageBatchCommand`,
  `buildDeleteMessageBatchCommand`, `buildReceiveMessageCommand`, `classifyBatchFailures`.
- `/firehose`: `encodeJsonRecord`, `chunkFirehoseRecords`, `buildPutRecordBatchCommand`,
  `getFailedFirehoseRecords`, and `createFirehoseBatcher({ putRecordBatch, onError })`, which
  buffers records per delivery stream (`write`, `writeJson`), flushes on 500 records, 4 MiB, or a
  timer (`flushIntervalMs`, default 1000), and retries records Firehose rejects once
  (`retryDelayMs`, default 100) before reporting them to `onError`. Stream names and the send
  function are inputs; `flush()` drains everything and never rejects for send failures.
- `/cloudwatch`: `chunkMetricData`, `buildPutMetricDataCommand`.
- `/request-handler`: `createAwsRequestHandler` (default connection and socket deadlines,
  timeout constants, `AWS_DUALSTACK_CLIENT_CONFIG`.
- `/errors`: `isAwsThrottlingError` and `getAwsErrorStatus`. `isAwsThrottlingError` also matches
  SES's HTTP 400 "Maximum sending rate exceeded" message. Pass `getAwsErrorStatus` as `getStatus`
  to `@vouchington/queue-errors` helpers; this package does not duplicate them. `wrapHttpForRetry`
  treats that SES 400 as terminal, so check `isAwsThrottlingError` first and rethrow a match
  unchanged to keep the queue's normal retry policy:

  ```ts
  import { getAwsErrorStatus, isAwsThrottlingError } from '@vouchington/aws/errors'
  import { wrapHttpForRetry } from '@vouchington/queue-errors'

  await sendEmail().catch((error: unknown) => {
    if (isAwsThrottlingError(error)) throw error
    wrapHttpForRetry(error, { getStatus: getAwsErrorStatus })
  })
  ```
- `/testing`: AWS Emulator harness for Vitest or any test runner; see below.

## Example

```ts
import { SESClient } from '@aws-sdk/client-ses'
import { SES_CLIENT_CONFIG, buildEmailCommand } from '@vouchington/aws/ses'
import { createAwsRequestHandler } from '@vouchington/aws/request-handler'

const ses = new SESClient({
  region,
  requestHandler: createAwsRequestHandler(),
  ...SES_CLIENT_CONFIG,
})
await ses.send(buildEmailCommand({ source, to, subject, text }))
```

## Testing harness (`@vouchington/aws/testing`)

Starts the AWS Emulator from a pinned, digest-verified package and
provides seeding and inspection helpers. It runs natively on Linux and in a Docker container
elsewhere. It imports the S3, IAM, SQS and Firehose client packages, so install all four to use
this subpath; they stay optional peers, so consumers of the other subpaths never need S3 or IAM. Image tags, version pins, bucket, queue and stream
names, cache paths, and environment variable names are all inputs.

```ts
import {
  startAwsEmulator,
  trustAwsEmulatorCertificate,
  provisionFirehoseStreams,
} from '@vouchington/aws/testing'

const emulator = await startAwsEmulator({
  package: { pin: { version, sha256: { amd64, arm64 } }, cacheDir: '.cache/aws-emulator' },
  dockerImage: 'node:24-trixie-slim@sha256:...', // runs the Linux binary on macOS
})
trustAwsEmulatorCertificate(emulator.caPem)
await provisionFirehoseStreams(emulator, { streamNames: ['events-test'] })
// ... run tests against emulator.endpoint with emulator.accessKeyId/secretAccessKey ...
await emulator.stop()
```

- `startAwsEmulator`, `trustAwsEmulatorCertificate`, `ensureAwsEmulatorBinary`, `debArch`,
  `startAwsEmulatorInDocker`, `readAnnouncedPort`: lifecycle. The download `fetch` is injectable
  for proxies; the caller records the version and SHA-256 pins after verifying AWS's signature.
- `createTestS3Bucket`, `uniqueS3Prefix`, `putS3Object`, `readS3ObjectText`, `readS3ObjectBytes`,
  `s3ObjectExists`, `listS3Keys`, `listS3Versions`, `deleteS3Object`, `sendToPresignedS3Url`:
  helpers that take the test's own `S3Client`.
- `createTestSqsQueue`, `sendTestSqsMessage`, `countTestSqsMessages`: helpers that take the test's
  own `SQSClient` (build it with `useQueueUrlAsEndpoint: false`).
- `provisionFirehoseStreams`: bucket, delivery role, and one ACTIVE DirectPut stream per name.
