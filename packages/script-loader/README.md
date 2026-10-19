# @vouchington/script-loader

React 19 hooks that load a third-party script once per URL and run a Cloudflare Turnstile widget.
There is no runtime dependency. React is a required peer. Like
`@vouchington/api-client/paginated-list`, these modules do not emit a `'use client'` directive:
import them from a client component.

## `@vouchington/script-loader`

`useLoadScript(src, options)` returns `{ isLoaded, isError }`. An empty `src` loads nothing.
Options are `nonce`, `integrity`, `crossOrigin`, and `errorRetryMs` (default 30 seconds before a
failed URL may be requested again). Hooks share one `<script>` tag per `src`.
`resetScriptLoaderForTests()` clears that shared state.

## `@vouchington/script-loader/turnstile`

`useTurnstile({ siteKey, onSuccess, onExpire, onError, enabled, scriptSrc })` returns
`{ ref, reset, isError }`. `enabled: false` loads nothing. `scriptSrc` defaults to
`TURNSTILE_SCRIPT_SRC`. The application supplies the site key and callbacks. This module declares
`window.turnstile`.
