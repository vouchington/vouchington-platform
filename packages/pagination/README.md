# @vouchington/pagination

Portable opaque cursor codecs, cursor shape guards, and configuration-owned query parsing.

This package does not define resource identifiers, allowed filter values, public request limits, or
response serialization. Those are application policy. It uses `http-errors` to report invalid
client input as status 400 errors.

```ts
import { createPaginationParser, csvEnumFilter, enumFilter } from '@vouchington/pagination'

const parser = createPaginationParser({
  cursor: { paramName: 'after', legacyParamNames: ['cursor'] },
  limit: { paramName: 'limit', min: 1, max: 50, default: 20 },
  filters: {
    order: enumFilter('order', ['recent', 'popular'] as const),
    labels: csvEnumFilter('label', ['news', 'events'] as const),
  },
})

const options = parser.parse({ after: 'eyJpZCI6Ii4uLiJ9', limit: '10', order: 'recent' })
```

Use `encodeCursor` and `decodeCursor` for an opaque base64url JSON envelope. Decode the result with
one of the exported guards, or use a scoped decoder to validate a UUID key and prevent reuse across
caller-defined scopes. `buildPageInfo` returns camelCase fields; applications choose their own wire
format.
