# @vouchington/robots

Evaluates `robots.txt` through caller-provided transport and optional cache implementations. RFC
9309 status fallbacks are the default; `statusFallback` lets callers override the rules and
cacheability for each HTTP status.

```ts
import { isUrlAllowed } from '@vouchington/robots'
```

## Provenance

Generalized from Filaments revision `2bd1d813f858da613fa89eec76037379503d9fd1`, primarily
`backend/services/urls-domains-robots/index.mts` and
`backend/services/urls-domains-robots/robots-parser-adapter.mts`.
