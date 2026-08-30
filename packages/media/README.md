# @vouchington/media

Schema-less direct media upload orchestration for Node.js. Applications provide identifiers,
object keys, persistence, authorization, lifecycle policy, queues, metadata extraction, and
failure reporting. The optional `@vouchington/media/s3` entrypoint supplies an S3 adapter with an
injected client and bucket.

This first release handles caller-uploaded objects only. Remote URL ingestion, HTTP fetching,
image transformation, and video processing are deliberately outside its scope. Compose metadata
processing with `@vouchington/image-resize` when Sharp-backed inspection is needed.

```ts
import { createMediaUpload } from '@vouchington/media'
import { createS3MediaStorage } from '@vouchington/media/s3'

const storage = createS3MediaStorage({ client, bucket: process.env.UPLOAD_BUCKET! })
const upload = await createMediaUpload(
  { contentType: request.headers.get('content-type'), contentLength: 42 },
  {
    policy: { acceptsContentType: (type) => type.startsWith('image/'), maxBytes: 50_000_000 },
    createId: crypto.randomUUID,
    createObjectKey: (id) => `pending/${id}`,
    expiresInSeconds: 3_600,
    presignUpload: ({ key, contentType, expiresInSeconds }) =>
      storage.presignUpload({ key, contentType, expiresInSeconds }),
    savePending: saveUpload,
  },
)
```

No bucket name, CDN URL, MIME allowlist, size limit, expiry, database schema, authorization rule,
moderation decision, or queue policy is built in.

The declared upload length is a request and signing input; it does not independently
prove the stored object's final size. Applications that require that guarantee should verify object
metadata during completion.
