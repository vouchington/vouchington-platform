# @vouchington/image-resize

Server-side image byte transformation, metadata inspection, and `Accept` negotiation for Node.js.
It has no storage, HTTP, cache-key, CDN, AWS, Lambda, or product policy concepts.

```ts
import { negotiateImageFormat, transformImage } from '@vouchington/image-resize'

const format = negotiateImageFormat({ accept: request.headers.get('accept') ?? undefined })
const bytes = await transformImage(originalBytes, { width: 800, format, quality: 82 })
```

Callers select resize dimensions, pixel limits, output quality, transparent-background handling,
and response/cache policy. The package only transforms supplied bytes.
