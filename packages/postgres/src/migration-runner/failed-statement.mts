const failedStatements = new WeakMap<object, string>()

/** Records which statement of an online migration raised `error`, for failure logging. */
export function rememberFailedStatement(error: unknown, statement: string): void {
  if (typeof error === 'object' && error !== null) failedStatements.set(error, statement)
}

/** Returns the statement recorded for `error`, if an online migration raised it. */
export function failedStatementOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null ? failedStatements.get(error) : undefined
}
