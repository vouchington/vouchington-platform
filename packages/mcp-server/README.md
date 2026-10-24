# @vouchington/mcp-server

Generic building blocks for a Model Context Protocol server. The package is subpath-only: each
subpath is dependency-light and opinionated, and the application injects its tools, policy,
authorization, audit, and persistence.

| Subpath    | Contents                                                                            |
| ---------- | ----------------------------------------------------------------------------------- |
| `./types`  | Structural `McpTool`, `McpToolMeta`, `ToolOutputSchema`                             |
| `./schema` | JSON Schema validation, traversal, closing, factoring, pruning, and output pointers |

## Types

`McpTool` is a structural type. An application's own tool type satisfies it as long as its
declaration, curried handler, and optional `roles` and `meta` have the same shape. Application
meta fields (annotations, scopes, audiences, plans) pass through the `McpToolMeta` index
signature.

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

## Limitations

The schema utilities target the schemas this package and its callers emit: JSON Schema 2020-12
style objects with local `#/$defs/*` references. They do not handle:

- draft-07 tuple `items` arrays (use `prefixItems`), which traversal and closing leave untouched;
- remote or non-local `$ref` values, and `$dynamicRef` or `$anchor` resolution;
- `$id` rebasing. Factoring skips any subtree that declares its own `$id`;
- `dependentSchemas`, `unevaluatedProperties`, and other keywords that change which properties
  are declared. `pruneToSchema` reads only `properties`, `items`, `anyOf`, `oneOf`, and local refs.
