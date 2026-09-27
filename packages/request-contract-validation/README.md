# @vouchington/request-contract-validation

Compile a caller supplied JSON Schema request bundle once, then validate body, header, path, and
query carriers with Ajv and standard formats. Unknown operations throw; a known operation without
a schema for a carrier accepts that carrier unchanged. Only supplied carriers are checked by
`validateOperation`.
The API is synchronous; asynchronous Ajv validators are rejected during construction.

```ts
import { RequestContractValidatorRegistry } from '@vouchington/request-contract-validation'

const registry = new RequestContractValidatorRegistry({
  components: {},
  operations: { 'POST:/items': { body: { type: 'object', required: ['name'] } } },
})
const error = registry.validateOperation('POST:/items', { body: { name: 'example' } })
```

Applications supply generated or hand-written contracts and decide authentication, authorization,
rate limits, request lifecycle, HTTP status, and error mapping. Header names in object inputs are
lowercased before validation; case-insensitive duplicates are rejected when a header contract is
present. This package has no generated bundle or shared registry.
