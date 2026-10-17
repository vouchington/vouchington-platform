import createHttpError from 'http-errors'

export type CodedError = Error & { status: number; code: string }

/** Create an `http-errors` error carrying a stable machine-readable `code`. */
export function createCodedError(status: number, message: string, code: string): CodedError {
  const error = createHttpError(status, message) as unknown as CodedError
  error.code = code
  return error
}
