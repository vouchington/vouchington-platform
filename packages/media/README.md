# @vouchington/media

Utility primitives for validating direct-upload request metadata and safely consuming media streams.
Applications own identifiers, object keys, persistence, authorization, lifecycle policy, queues,
metadata extraction, and failure reporting.

`@vouchington/media/s3` contains caller-configured object writes plus reads, deletes, and batched
deletes. Reads return the body with optional length, content type, ETag, and metadata. The separately
imported `@vouchington/media/s3-presign` entrypoint creates upload URLs, keeping object consumers
independent from the request-presigner at runtime.

```ts
import { validateMediaUpload } from '@vouchington/media'
import { createS3MediaObjects } from '@vouchington/media/s3'
import { createS3MediaUploadPresigner } from '@vouchington/media/s3-presign'

const metadata = validateMediaUpload(
  { contentType: request.headers.get('content-type'), contentLength: 42 },
  { acceptsContentType: (type) => type.startsWith('image/'), maxBytes: 50_000_000 },
)
const objects = createS3MediaObjects({ client, bucket: process.env.UPLOAD_BUCKET! })
const presigner = createS3MediaUploadPresigner({ client, bucket: process.env.UPLOAD_BUCKET! })
const uploadUrl = await presigner.presignUpload({ key, ...metadata, expiresInSeconds: 3_600 })
```

No bucket name, CDN URL, MIME allowlist, size limit, expiry, database schema, authorization rule,
moderation decision, or queue policy is built in. `hashMediaBody` hashes an async byte stream.
`spoolMediaBody` creates an owned private temporary file with optional incremental size enforcement;
its caller invokes `cleanup()`. `withTemporaryMediaFile` builds on that lifecycle and cleans up after
its callback.

The declared upload length is a request and signing input; it does not independently prove the
stored object's final size. Applications that require that guarantee should verify object metadata.

Pass `ifNoneMatch: '*'` to the presigner when a caller wants a write-once upload URL. Upload clients
must send that header, and bucket CORS policy must allow it.
