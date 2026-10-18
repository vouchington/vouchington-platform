# @vouchington/dynamic-config

Pure primitives for building a dynamic-config admin on top of
[`valkyries/dynamic-config`](https://www.npmjs.com/package/valkyries) (^0.10.0). There is no
orchestration here: the application owns the sequence of authorize, validate, record, and write.

- `createRoleAuthorizer`: a pure role predicate `(user, entry, permission) => boolean`.
- `toAdminNamespaceSummary` / `toAdminNamespaceView`: snake_case admin view serializers over a
  registry entry. The caller supplies `{ can_view, can_update }`, and calls
  `waitForInitialization()` before `toAdminNamespaceView`.
- `normalizeFields`: reads every declared field with default fallback and verifies runtime types.
- Types: `DynamicConfigRegistryEntry` is valkyries' `DynamicConfigNamespaceDefinition` plus `label`,
  `description`, and `access`. Field rules are valkyries' camelCase `DynamicConfigFieldRules`.

The registry, namespace definitions, validators, `DynamicConfigValidationError`, and
`validateDynamicConfigUpdate` live in `valkyries/dynamic-config`; import them from there.
`valkyries` is a peer dependency because the application owns the `DynamicConfig` instances and
this package only uses its types.

## Example: the update sequence the application writes itself

```ts
import {
  createDynamicConfigRegistry,
  defineDynamicConfigNamespace,
  validateDynamicConfigUpdate,
} from 'valkyries/dynamic-config'
import {
  createRoleAuthorizer,
  normalizeFields,
  toAdminNamespaceView,
  type DynamicConfigRegistryEntry,
} from '@vouchington/dynamic-config'

const registry = createDynamicConfigRegistry<DynamicConfigRegistryEntry>([
  defineDynamicConfigNamespace<DynamicConfigRegistryEntry>({
    namespace: 'limits',
    label: 'Limits',
    description: 'Request limits.',
    config: limitsConfig, // a valkyries DynamicConfig
    access: { update_roles: ['developer'] },
    fields: { soft: { minValue: 1, integer: true }, hard: { minValue: 1, integer: true } },
  }),
])
const authorize = createRoleAuthorizer({
  getRoles: (user: User) => user.roles,
  adminRoles: ['administrator'],
  viewerRoles: ['moderator'],
})

async function update(user: User, namespace: string, body: unknown) {
  const entry = registry.get(namespace)
  if (!entry || !authorize(user, entry, 'update')) return null
  await entry.config.waitForInitialization()
  const current = normalizeFields(entry, entry.config.getFields())
  const result = validateDynamicConfigUpdate(entry, current, body)
  if (result.changed) {
    await recordAudit(user, namespace, current, result.next) // application persistence
    await entry.config.setFields(result.changes)
  }
  return toAdminNamespaceView(entry, {
    can_view: authorize(user, entry, 'view'),
    can_update: true,
  })
}
```

## Migrating from 0.1.x

- `createDynamicConfigAdmin` is removed. Compose `list` / `get` / `update` / `history` in the
  application as above (unknown namespace and unauthorized both returning `null`, audit before
  `setFields`, history persistence).
- Import `createDynamicConfigRegistry`, `defineDynamicConfigNamespace`, `withMaxValueExemption`,
  `getChangedFields`, `DynamicConfigValidationError`, and the `validate*` helpers from
  `valkyries/dynamic-config`.
- Rename field rules to camelCase: `min_value` to `minValue`, `max_value` to `maxValue`,
  `max_value_exemption` to `maxValueExemption`. Admin output stays snake_case.
- Type entries as `DynamicConfigRegistryEntry` and pass it as the generic to
  `createDynamicConfigRegistry` and `defineDynamicConfigNamespace`.
- Error texts follow valkyries (`Changes must be an object`, `Unknown field: x`,
  `Field <f> must be one of: a, b`, `DynamicConfig field rules drift for <ns>: missing rules: a;
  extra rules: b`). Updates use strict types (no coercion); `validateStrictlyAscending` requires
  real numbers. Valkyries result objects have a null prototype: use `Object.hasOwn`.
