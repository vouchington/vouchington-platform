# @vouchington/image-resize

Server-side image buffer/path transformation, file output, metadata inspection, and `Accept`
negotiation for Node.js.
It has no storage, HTTP, cache-key, CDN, AWS, Lambda, or product policy concepts.

```ts
import { negotiateImageFormat, transformImage } from '@vouchington/image-resize'

const format = negotiateImageFormat({ accept: request.headers.get('accept') ?? undefined })
const bytes = await transformImage(originalBytes, { width: 800, format, quality: 82 })
```

`transformImage` accepts supplied bytes or a local path and returns bytes. `transformImageToFile`
accepts the same input and writes to a caller-managed path. Both follow the current image Lambda
transform semantics: sequential decoding, EXIF auto-orientation, no upscaling, grayscale and alpha
preservation, white JPEG flattening, and format-specific encoder settings. A decode failure caused
by `maxInputPixels` is reported as `ImageInputPixelLimitError`.

Callers select dimensions, pixel limit, encoder options, transparent-background handling, format
order/fallback, and response/cache policy. The package has no Lambda or product presets.

`inspectImage` accepts either supplied bytes or a caller-managed local file path. Path support lets
worker processes inspect temporary downloads without loading the full object into memory.
