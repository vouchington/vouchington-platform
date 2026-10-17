import type { DynamicConfigPermission, DynamicConfigRegistryEntry } from './types.mts'

export type RoleAuthorizerOptions<TUser> = {
  getRoles(user: TUser): readonly string[]
  /** Roles that may do everything. */
  adminRoles: readonly string[]
  /** Roles that may view every namespace. Updates still need `entry.access.update_roles`. */
  viewerRoles: readonly string[]
}

/** A safe default role-based policy. The result is a synchronous predicate and satisfies `DynamicConfigAuthorizer`. */
export function createRoleAuthorizer<TUser>(
  options: RoleAuthorizerOptions<TUser>,
): (
  user: TUser,
  entry: DynamicConfigRegistryEntry,
  permission: DynamicConfigPermission,
) => boolean {
  return (user, entry, permission) => {
    const roles = options.getRoles(user)
    if (roles.some((role) => options.adminRoles.includes(role))) return true
    if (permission === 'view') return roles.some((role) => options.viewerRoles.includes(role))
    return entry.access.update_roles.some((role) => roles.includes(role))
  }
}
