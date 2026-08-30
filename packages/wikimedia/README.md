# @vouchington/wikimedia

An injected client for Wikimedia Core title search and REST page summaries.

```ts
import { createWikimediaClient } from '@vouchington/wikimedia'

const wikimedia = createWikimediaClient({
  fetch,
  project: 'wikipedia',
  language: 'en',
  userAgent: 'example-service/1.0 (https://example.com/contact)',
})

const results = await wikimedia.searchByTitle('Ada Lovelace')
const summary = await wikimedia.getPageSummary(results[0]!.title)
```

The caller provides the fetch implementation, project, language, and user agent. Each client caps
physical requests at three concurrent fetches, gives each attempt a 10-second timeout by default,
and retries 429, 5xx, internal timeouts, and retryable network failures for at most three attempts.
Caller cancellation, redirects, other 4xx responses, and invalid API payloads are terminal.

`getPageSummary` returns `null` for a 404. It does not select a global fetch implementation,
hard-code a Wikimedia project or language, or attach Vouchington credentials or identity.
