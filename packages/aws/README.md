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
  `getFailedFirehoseRecords`.
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
