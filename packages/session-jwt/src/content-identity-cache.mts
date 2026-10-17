/**
 * Two-level memoizing cache: a WeakMap fast path keyed on an object's identity (for example a
 * binding stable for a process or isolate lifetime) over a Map keyed on a secondary value, falling
 * through to a content-keyed Map. `getContentKey` is a thunk so an identity hit skips deriving it.
 * Entries are never evicted, so callers must pass a small, bounded set of key-material combinations.
 */
export class ContentAndIdentityCache<TIdentityKey extends object, TSubKey, TValue> {
  private readonly byContent = new Map<string, TValue>()
  private readonly byIdentity = new WeakMap<TIdentityKey, Map<TSubKey, TValue>>()

  getOrCompute(
    identityKey: TIdentityKey | undefined,
    subKey: TSubKey,
    getContentKey: () => string,
    compute: () => TValue,
  ): TValue {
    const identityMap = identityKey && this.byIdentity.get(identityKey)
    const identityCached = identityMap?.get(subKey)
    if (identityCached !== undefined) return identityCached

    const contentKey = getContentKey()
    const value = this.byContent.get(contentKey) ?? compute()
    this.byContent.set(contentKey, value)
    if (identityKey) {
      const map = identityMap || new Map<TSubKey, TValue>()
      map.set(subKey, value)
      this.byIdentity.set(identityKey, map)
    }
    return value
  }
}
