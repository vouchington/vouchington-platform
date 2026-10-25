# @vouchington/mcp-server

Generic building blocks for a Model Context Protocol server. The package is subpath-only: each
subpath is dependency-light and opinionated, and the application injects its tools, policy,
authorization, audit, and persistence.

| Subpath       | Contents                                                                            |
| ------------- | ----------------------------------------------------------------------------------- |
| `./types`     | Structural `McpTool`, `McpToolMeta`, `ToolOutputSchema`                             |
| `./schema`    | JSON Schema validation, traversal, closing, factoring, pruning, and output pointers |
| `./tools`     | Merged tools, the add/update/remove tool, and per-argument REST route selection     |
| `./results`   | Bounded, cycle-safe result serialization and validated MCP tool results             |
| `./untrusted` | Private-field filtering and untrusted-text wrapping with injected field sets        |
| `./http`      | Stateless Streamable HTTP request handler with injected tools and hooks             |

## Types

`McpTool` is a structural type. An application's own tool type satisfies it as long as its
declaration, curried handler, and optional `roles` and `meta` have the same shape. Application
meta fields (annotations, scopes, audiences, plans) pass through the `McpToolMeta` index
signature. Pass an application metadata type as the final generic argument to `McpTool` or the
tool helpers to require fields such as `annotations` and retain their types in the returned tool.

## Schema

```ts
import {
  findSchemaViolation,
  closeDeclaredInputObjects,
  factorToolSchema,
} from '@vouchington/mcp-server/schema'

const violation = findSchemaViolation(schema, args) // string | null, never contains the value
```

- `findSchemaViolation(schema, value)`: Ajv with a per-schema cache and full `date-time` validation,
  including UTC month-end leap-second placement. The message names the path and rule, never the
  value, so it is safe to log.
- `mapSchema` and `visitSchema`: traverse every schema position.
- `closeDeclaredInputObjects`: set `additionalProperties: false` on objects that declare
  properties; free-form maps stay open.
- `factorToolSchema`: hoist repeated nodes into `$defs` named `S1`, `S2`, ... only when the
  serialized schema shrinks.
- `pruneToSchema`: reduce a value to the properties a schema declares.
- `objectSchema`, `successSchema`, `oneOfSchema`, `outcomeSchema`, `nullable`: output shape helpers.
- `validateOptionOutputPointers` and `getOptionOutputSchema`: validate and resolve the local
  pointers that map each merged-tool option to its output branch.
- `resolveRouteResponse(endpoint, responses, components, { missingContractHint? })`,
  `inlineSchemaReferences`, `routePropertySchema`, and `successResultSchema`: derive a
  self-contained output schema from `#/components/schemas/*` contracts the application injects.
  A self-referencing component stays a `$ref` into a root `$defs`.

## Tools

- `createMergedTool(name, title, options, { compatibilityKey })`: one tool with an `option`
  discriminator. Each source keeps its own validator, handler, REST routes, and output contract.
  Input `$defs` are scoped as `Option{n}_*`, output branches with equal schemas are shared, and
  `meta.optionOutputPointers` maps every option to its branch. `compatibilityKey` is required: it
  returns a string that must be equal for every source, so the application decides which declared
  fields (scopes, audience, plan, roles, annotations) must match before sources may merge.
- `createManageEntityTool({ toolName, description, addProperties, updateProperties, requireUser,
  addFn, updateFn, removeFn, entitySchema, meta })`: add, update, and remove actions. The
  application injects the active-user check and the entity schema. A missing id raises a
  `ManageEntityInputError` carrying status `422`.
- `selectApiByArgument(argument, endpoints)`: builds `meta.selectApi` so a call names only the REST
  route its argument exercises.

## Results

- `serializeMcpToolResult(result, maxBytes?)`: JSON with a byte bound (1 MiB by default,
  `MAX_MCP_TOOL_RESULT_BYTES`) and a visit bound (`MAX_MCP_TOOL_RESULT_VISITS`). It honors
  `toJSON`, rejects cycles and BigInt, and throws `McpToolResultTooLargeError` before it builds an
  oversized string.
- `buildToolResult(toolName, result, outputSchema?, selectedOutputSchema?)`: one text block, plus
  `structuredContent` validated against the published schema when there is one. The assembled
  response is held to the bound, since the escaped text copy is larger than the JSON it carries. A
  result that breaks its own schema throws `McpToolOutputMismatchError`, naming the tool and the
  rule but never the value.

## Untrusted output

The application injects two field-name sets: fields whose text an agent must treat as data, and
private fields that never leave the server.

- `filterPrivateOutputFields(value, privateFields)`: drops private fields at every depth.
- `adminOutputSchema(schema, { untrusted, private })`: the matching schema transform. Untrusted
  fields become `string | null`; private fields leave `properties` and `required`.
- `wrapUntrustedOutput(value, { untrusted, private, wrap? })`: removes private fields, serializes
  dates, and wraps each untrusted field. The default `wrap` is `wrapWithVurstPrompt`, which uses
  `@jongleberry/vurst-prompt`; pass your own `(text, field) => unknown` to replace it.

## HTTP

`handleStatelessMcpRequest` handles one Streamable HTTP request with a fresh server and transport
in JSON-response mode, and needs `@modelcontextprotocol/sdk` as a peer.

```ts
import { handleStatelessMcpRequest } from '@vouchington/mcp-server/http'

const response = await handleStatelessMcpRequest({
  serverInfo: { name: 'example-mcp', version: '1.0.0' },
  instructions,
  request,
  parsedBody,
  listTools: () => listToolsFor(user),
  callTool: (call, controls) => runTool(user, call, controls),
  isDispatchedToolCall,
  rateLimitedCalls,
  buildRateLimitedResult,
  resolveAuditOption: (call) => auditOptionFor(call),
  hooks: { onToolError, onToolRateLimited, onToolCallSettled },
})
```

- Calls are indexed by message position, so duplicate JSON-RPC ids in a batch stay distinct. A call
  whose position is in `rateLimitedCalls` is refused in-band with `buildRateLimitedResult` and never
  runs. Each map value is `{ retryAfterSeconds, message? }`, and the builder receives that exact
  value so it can explain the refusal.
- `callTool` receives `{ onInvoked, onRateLimited }`: report the tool duration and a rate limit
  found while running, so `onToolError` fires only for real tool errors.
- `onToolCallSettled` fires once per dispatched call, including a call that throws. It only
  observes: if it throws, the error is swallowed and the tool's result is unchanged.
- Any method but POST is refused with `405` and `Allow: POST`.
- All started calls finish before the response returns, and the transport and server are closed
  even on error.
- `validateRequest` defaults to `validateToolsRequest`, which answers a malformed `tools/list` or
  `tools/call` with a JSON-RPC `InvalidRequest` before the transport sees it.

Authentication, scope and plan gating, route charging, audit persistence, usage metering, and
error-code mapping stay in the application, behind `callTool` and the hooks.

## Limitations

The schema utilities target the schemas this package and its callers emit: JSON Schema 2020-12
style objects with local `#/$defs/*` references. They do not handle:

- draft-07 tuple `items` arrays (use `prefixItems`), which traversal and closing leave untouched;
- remote or non-local `$ref` values, and `$dynamicRef` or `$anchor` resolution;
- `$id` rebasing. Factoring skips any subtree that declares its own `$id`;
- `dependentSchemas`, `unevaluatedProperties`, and other keywords that change which properties
  are declared. `pruneToSchema` reads only `properties`, `items`, `anyOf`, `oneOf`, and local refs.
- merged tools and route-response inlining read only `$defs`, local `#/$defs/*` references and
  schema positions: draft-07 `definitions`, `$ref: '#'` recursion, a property literally named
  `$ref`, `$ref` objects inside `const` or `enum` data, and keywords written beside a `$ref` (they
  win over the referenced schema) are not supported;
- the manage tool publishes `result` as `oneOf` the entity or `{ id }`, so an entity schema that
  also accepts `{ id }` alone needs its own discriminator.
