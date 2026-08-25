# @vouchington/http-transport

Redirect-safe HTTP transport primitives for server-side URL fetching. The caller supplies both an
Undici-compatible `fetch` and an address resolver. The resolver is invoked before every request
and redirect hop, and returns the dispatcher that has pinned the validated address to the socket.

```ts
import { createRedirectingFetch } from '@vouchington/http-transport'

const safeFetch = createRedirectingFetch({ fetch: undiciFetch, resolveDestination })
const response = await safeFetch('https://example.com/image.png')
```

`resolveDestination` is the SSRF security boundary. It must reject non-public addresses and return
a dispatcher that uses the resolved address, preventing DNS rebinding. This package deliberately
does not select hostname policy, DNS provider, user agent, timeout, or credential policy.
