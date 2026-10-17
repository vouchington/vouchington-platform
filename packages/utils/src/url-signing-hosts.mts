export type DependencyAuthorization = 'allow' | 'withheld' | 'unknown'

/** Empty manifests have no dependency bytes. Any withheld or unknown dependency denies delivery. */
export function authorizeDependencyStates(
  states: readonly DependencyAuthorization[],
): 'allow' | 'deny' {
  return states.every((state) => state === 'allow') ? 'allow' : 'deny'
}

export function normalizeHostname(hostname: string): string {
  return hostname.replace(/\.$/, '').toLowerCase()
}

/** Hostname of a URL string or a bare host. Returns undefined when empty or unparsable. */
export function hostnameOf(value: string): string | undefined {
  if (value.includes('://')) {
    try {
      return normalizeHostname(new URL(value).hostname)
    } catch {
      return undefined
    }
  }
  const host = value.trim()
  return host ? normalizeHostname(host) : undefined
}

/** Route matcher: `<prefix><one non-empty segment>`. Returns the segment, or undefined. */
export function matchRouteSegment(pathname: string, prefix: string): string | undefined {
  if (!pathname.startsWith(prefix)) return undefined
  const rest = pathname.slice(prefix.length)
  return rest && !rest.includes('/') ? rest : undefined
}

export type ProtectedHostPolicy = {
  hosts: () => string[]
  isProtected: (url: URL, extraHosts?: readonly string[]) => boolean
  blockedHosts: () => { exact: string[]; suffixes: string[] }
}

/**
 * Protected-host policy. Each entry (URL or bare host) protects the host and all subdomains.
 * The caller supplies the host list; nothing is read from the environment.
 */
export function createProtectedHostPolicy(entries: readonly string[]): ProtectedHostPolicy {
  const collect = (extra: readonly string[] = []): Set<string> => {
    const hosts = new Set<string>()
    for (const entry of [...entries, ...extra]) {
      const host = hostnameOf(entry)
      if (host) hosts.add(host)
    }
    return hosts
  }
  return {
    hosts: () => [...collect()],
    isProtected(url, extraHosts) {
      const host = normalizeHostname(url.hostname)
      for (const protectedHost of collect(extraHosts)) {
        if (host === protectedHost || host.endsWith(`.${protectedHost}`)) return true
      }
      return false
    },
    blockedHosts() {
      const hosts = [...collect()]
      return { exact: hosts, suffixes: hosts.map((host) => `.${host}`) }
    },
  }
}
