export function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  return parseInteger(env, name, fallback, (value) => value > 0, 'a positive integer')
}

export function nonNegativeInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  return parseInteger(env, name, fallback, (value) => value >= 0, 'a non-negative integer')
}

function parseInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  valid: (value: number) => boolean,
  label: string,
): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || !valid(value)) {
    throw new Error(`${name} must be ${label}, got "${raw}"`)
  }
  return value
}
