# @vouchington/dynamic-config

A registry, descriptor, validator, and admin layer over
[`valkyries/dynamic-config`](https://www.npmjs.com/package/valkyries). `valkyries` is a peer
dependency; this package only imports its types, so tests and callers may pass any object that
satisfies `DynamicConfigLike`.

The application injects every registry entry, the namespaces, and the authorization policy.

```ts
import {
  createDynamicConfigAdmin,
  createDynamicConfigRegistry,
  createRoleAuthorizer,
  defineDynamicConfigNamespace,
  validateStrictlyAscending,
} from '@vouchington/dynamic-config'

const registry = createDynamicConfigRegistry([
  defineDynamicConfigNamespace({
    namespace: 'limits',
    label: 'Limits',
    description: 'Request limits.',
    config: limitsConfig, // a valkyries DynamicConfig
    access: { update_roles: ['developer'] },
    fields: { soft: { min_value: 1, integer: true }, hard: { min_value: 1, integer: true } },
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

- `defineDynamicConfigNamespace` throws when field metadata drifts from the config's `fieldTypes`.
- `createDynamicConfigRegistry` rejects duplicate namespaces.
- `createDynamicConfigAdmin` returns `list`, `get`, `update`, and `history`. Unknown namespaces and
  unauthorized callers both resolve to `null`. `update` validates types, `min_value`, `max_value`,
  `integer`, and the entry's `validate`; awaits `recordChange` before `setFields`; and skips both
  when nothing changed.
- `authorize` is any `(user, entry, permission) => boolean | Promise<boolean>`.
  `createRoleAuthorizer` is a default role policy.
- Generic validators: `validatePositiveNumberFields`, `validatePositiveIntegerFields`,
  `validateNumberRange`, `validateOneOf`, `validateStrictlyAscending`. Throw
  `DynamicConfigValidationError`.

Entries, product validators, audit persistence, and the authorization policy stay in the
application.
