# @vouchington/dynamic-config

The admin layer over [`valkyries/dynamic-config`](https://www.npmjs.com/package/valkyries) (>= 0.9):
`list`, `get`, `update`, and `history` with injected authorization, audit, and history hooks, and
snake_case admin output.

The registry, namespace definitions, field rules, validators, and update validation live in
`valkyries/dynamic-config`. Import them from there; this package does not re-export them.

`valkyries` is a peer dependency. The application owns the `DynamicConfig` instances, and a single
shared copy keeps `DynamicConfigValidationError` identity (`instanceof`) consistent between the
application and this package.

```ts
import {
  createDynamicConfigRegistry,
  defineDynamicConfigNamespace,
  validateStrictlyAscending,
} from 'valkyries/dynamic-config'
import {
  createDynamicConfigAdmin,
  createRoleAuthorizer,
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
    validate: (next) => validateStrictlyAscending(next, ['soft', 'hard']),
  }),
])

const admin = createDynamicConfigAdmin({
  registry,
  authorize: createRoleAuthorizer({
    getRoles: (user) => user.roles,
    adminRoles: ['administrator'],
    viewerRoles: ['moderator'],
  }),
  recordChange: async (user, namespace, previous, next) => {}, // audit persistence
  readHistory: async (user, namespace) => [], // history persistence
})
```

- `DynamicConfigRegistryEntry` is valkyries' `DynamicConfigNamespaceDefinition` plus `label`,
  `description`, and `access`. Field rules are valkyries' camelCase `DynamicConfigFieldRules`
  (`minValue`, `maxValue`, `maxValueExemption`, `integer`, `description`).
- `createDynamicConfigAdmin` returns `list`, `get`, `update`, and `history`. Unknown namespaces and
  unauthorized callers both resolve to `null`. `update` authorizes, waits for initialization,
  normalizes the current values, runs valkyries' `validateDynamicConfigUpdate`, awaits
  `recordChange` before `setFields`, and skips both when nothing changed.
- Admin output stays snake_case (`can_view`, `field_count`, `default_value`, `min_value`,
  `max_value`, `max_value_exemption`).
- `authorize` is any `(user, entry, permission) => boolean | Promise<boolean>`.
  `createRoleAuthorizer` is a default role policy.

Entries, product validators, audit persistence, and the authorization policy stay in the
application.

## Migrating from 0.1.x

- Import `createDynamicConfigRegistry`, `defineDynamicConfigNamespace`, `withMaxValueExemption`,
  `getChangedFields`, `DynamicConfigValidationError`, and the `validate*` helpers from
  `valkyries/dynamic-config` instead of this package.
- Rename field rules to camelCase: `min_value` to `minValue`, `max_value` to `maxValue`,
  `max_value_exemption` to `maxValueExemption`.
- Type entries as `DynamicConfigRegistryEntry` (pass it as the generic to
  `createDynamicConfigRegistry` and `defineDynamicConfigNamespace`).
- `entry.validate` now receives the merged fields from valkyries; `validateStrictlyAscending`
  requires real numbers, and `validateOneOf` reports `Field <f> must be one of: a, b`.
- Update errors now come from valkyries (`Changes must be an object`, `Unknown field: x`, strict
  types with no coercion). Field-rule drift reads `DynamicConfig field rules drift for <ns>:
  missing rules: a; extra rules: b`.
- Change objects and `getChangedFields` results have a null prototype; use `Object.hasOwn`.
