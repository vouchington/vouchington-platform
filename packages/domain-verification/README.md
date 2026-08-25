# @vouchington/domain-verification

Generic DNS TXT and HTTPS well-known-file verification primitives. Applications choose records,
paths, DNS providers, and secure HTTP transport policy.

## DNS TXT verification

```ts
import { hasDnsTxtRecord } from '@vouchington/domain-verification'

const verified = await hasDnsTxtRecord('example.test', 'example-verification=token', {
  lookup: (hostname) => dns.resolveTxt(hostname),
})
```

`resolveTxtRecords` has a bounded timeout and retries only timeout failures. Inject `lookup` and
`clock` for custom resolvers and deterministic tests.

## Well-known verification

```ts
import { verifyWellKnownText } from '@vouchington/domain-verification'

const verified = await verifyWellKnownText('example.test', 'token', {
  path: '/.well-known/example-verification.txt',
  transport: secureTransport,
})
```

`transport` is intentionally injected: it must enforce SSRF protection, DNS resolution and
connection pinning appropriate to the host application. The package requests only plain text,
caps the body size, and returns `null`/`false` for transport, status, or body failures.
