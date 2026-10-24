export interface JobDataScrubOptions {
  /** Replacement for redacted values. Default `'[Filtered]'`. */
  redacted?: string
  /** Normalized (lowercase alphanumeric) key substrings that always redact. Default: generic PII/secret terms. */
  sensitiveSubstrings?: readonly string[]
  /** Normalized key names that redact only on an exact match. Default: none. */
  sensitiveNames?: readonly string[]
  /** Nesting depth at which containers are redacted. Default 4. */
  maxDepth?: number
  /** Array items kept before a `...N more` marker. Default 10. */
  maxArrayItems?: number
  /** Sorted object keys kept. Default 32. */
  maxKeys?: number
}

export const DEFAULT_SENSITIVE_SUBSTRINGS: readonly string[] = [
  'email',
  'phone',
  'address',
  'token',
  'secret',
  'password',
  'passwd',
  'credential',
  'sessionid',
  'ssn',
  'creditcard',
  'cardnumber',
  'cvv',
  'dob',
  'birthdate',
]

const SAFE_SCALAR_STRING = /^[a-z][a-z0-9_-]{0,63}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/

type Resolved = Required<JobDataScrubOptions>

/**
 * Safe-scalar allowlist scrubber for queue job payloads. Values default to redacted: only booleans,
 * numbers, UUID/ULID ids, and short slug-like strings survive, and sensitive key names redact
 * regardless of value. Plain non-empty objects produce output; anything else yields undefined.
 */
export function scrubJobData(
  data: unknown,
  options: JobDataScrubOptions = {},
): Record<string, unknown> | undefined {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return undefined
  if (Object.keys(data).length === 0) return undefined
  const resolved: Resolved = {
    redacted: options.redacted ?? '[Filtered]',
    sensitiveSubstrings: options.sensitiveSubstrings ?? DEFAULT_SENSITIVE_SUBSTRINGS,
    sensitiveNames: options.sensitiveNames ?? [],
    maxDepth: options.maxDepth ?? 4,
    maxArrayItems: options.maxArrayItems ?? 10,
    maxKeys: options.maxKeys ?? 32,
  }
  return scrubObject(data as Record<string, unknown>, 0, resolved) as Record<string, unknown>
}

function scrubValue(value: unknown, depth: number, o: Resolved): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return scrubString(value, o)
  if (Array.isArray(value)) return scrubArray(value, depth, o)
  if (typeof value === 'object') return scrubObject(value as Record<string, unknown>, depth, o)
  return o.redacted
}

function scrubString(value: string, o: Resolved): string {
  if (UUID_PATTERN.test(value) || ULID_PATTERN.test(value)) return value
  return SAFE_SCALAR_STRING.test(value) ? value : o.redacted
}

function scrubArray(value: unknown[], depth: number, o: Resolved): unknown {
  if (depth >= o.maxDepth) return o.redacted
  const items = value.slice(0, o.maxArrayItems).map((item) => scrubValue(item, depth + 1, o))
  if (value.length > o.maxArrayItems) items.push(`...${value.length - o.maxArrayItems} more`)
  return items
}

function scrubObject(value: Record<string, unknown>, depth: number, o: Resolved): unknown {
  if (depth >= o.maxDepth) return o.redacted
  // fromEntries defines own properties, so a JSON `__proto__` key cannot hit the prototype setter.
  return Object.fromEntries(
    Object.keys(value)
      .toSorted()
      .slice(0, o.maxKeys)
      .map((key) => [
        key,
        isSensitiveKey(key, o) ? o.redacted : scrubValue(value[key], depth + 1, o),
      ]),
  )
}

function isSensitiveKey(key: string, o: Resolved): boolean {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
  return (
    o.sensitiveNames.includes(normalized) ||
    o.sensitiveSubstrings.some((substring) => normalized.includes(substring))
  )
}
