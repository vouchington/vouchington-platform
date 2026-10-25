import { redactEmails } from './observability-email.mts'
import { SENSITIVE_VALUE, isRecord, transformRecord } from './observability-records.mts'

export const EMAIL_REDACTED = '[Filtered email]'
export const TOKEN_REDACTED = '[Filtered token]'
export const CIRCULAR_VALUE = '[Circular]'
export const DEFAULT_MAX_DEPTH = 12

const DEFAULT_KEY_PATTERN =
  /authorization|cookie|password|passwd|secret|token|api[_-]?key|access[_-]?key|email|dsn|credential/i
const AUTH_TOKEN_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi
const TOKEN_ASSIGNMENT_PATTERN =
  /\b((?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|password|passwd|api[_-]?key)=)[^&\s]+/gi

export interface DeepScrubOptions {
  /** Extra key patterns, added to the defaults, whose values are replaced with the filtered marker. */
  sensitiveKeyPatterns?: readonly RegExp[]
  /** Extra text redactors, run after the defaults, applied to every string in the event. */
  textRedactors?: ReadonlyArray<(text: string) => string>
  /** Containers nested deeper than this are replaced with the filtered marker. Default 12. */
  maxDepth?: number
}

/** Default text redactor: bearer/basic credentials, token assignments, then email addresses. */
export function redactText(text: string): string {
  return redactEmails(
    text
      .replace(AUTH_TOKEN_PATTERN, `$1 ${TOKEN_REDACTED}`)
      .replace(TOKEN_ASSIGNMENT_PATTERN, `$1${TOKEN_REDACTED}`),
    EMAIL_REDACTED,
  )
}

/** Stateless copy of a pattern, so `g` and `y` flags cannot make `test` order-dependent. */
function stateless(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''))
}

/** Redact a sensitive value; a plain object keeps its keys with every value filtered. */
function redactValue(value: unknown): unknown {
  return isRecord(value) && isPlain(value)
    ? transformRecord(value, () => SENSITIVE_VALUE)
    : SENSITIVE_VALUE
}

function isPlain(value: object): boolean {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Recursively redact sensitive keys and free-text secrets. Plain objects and arrays are walked;
 * Date, Error, and other class instances are returned as-is. Cycles become a marker, containers
 * beyond `maxDepth` are replaced (fail closed), and unchanged input is returned by identity.
 */
export function scrubDeep<T>(value: T, options: DeepScrubOptions = {}): T {
  const keyPatterns = [DEFAULT_KEY_PATTERN, ...(options.sensitiveKeyPatterns ?? []).map(stateless)]
  const redactors = [redactText, ...(options.textRedactors ?? [])]
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const ancestors = new WeakSet<object>()
  const isSensitiveKey = (key: string) => keyPatterns.some((pattern) => pattern.test(key))

  function walkArray(input: unknown[], depth: number): unknown[] {
    const mapped = input.map((child) => walk(child, depth + 1))
    return mapped.some((child, index) => !Object.is(child, input[index])) ? mapped : input
  }

  function walk(input: unknown, depth: number): unknown {
    if (typeof input === 'string') return redactors.reduce((text, redact) => redact(text), input)
    const isArray = Array.isArray(input)
    if (!isArray && !(isRecord(input) && isPlain(input))) return input
    if (ancestors.has(input)) return CIRCULAR_VALUE
    if (depth >= maxDepth) return SENSITIVE_VALUE
    ancestors.add(input)
    try {
      return isArray
        ? walkArray(input, depth)
        : transformRecord(input, (key, child) =>
            isSensitiveKey(key) ? redactValue(child) : walk(child, depth + 1),
          )
    } finally {
      ancestors.delete(input)
    }
  }

  return walk(value, 0) as T
}
