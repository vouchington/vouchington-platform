# @vouchington/robots

Evaluates `robots.txt` through caller-provided transport and optional cache implementations. RFC
9309 status fallbacks are the default; `statusFallback` lets callers override the rules and
cacheability for each HTTP status.

```ts
import { isUrlAllowed, parseRobotsTxt } from '@vouchington/robots'
```

`parseRobotsTxt(url, rules)` exposes parsing independently for applications that already own their
fetch and cache policy. Unlike `isUrlAllowed`, it preserves the parser's `undefined` result when the
requested URL does not match the robots.txt origin.

## Provenance

Generalized from Filaments revision `2bd1d813f858da613fa89eec76037379503d9fd1`, primarily
`backend/services/urls-domains-robots/index.mts` and
`backend/services/urls-domains-robots/robots-parser-adapter.mts`.
