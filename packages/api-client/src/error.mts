/** Shared API error used by both the browser and server request wrappers. */
export class ApiError extends Error {
  status: number
  code?: string
  requestId?: string
  data?: unknown
  digest?: string

  constructor(message: string, status: number, data?: unknown) {
    const dataRecord =
      data && typeof data === 'object' && !(data instanceof Error)
        ? (data as Record<string, unknown>)
        : null

    super(dataRecord && typeof dataRecord.message === 'string' ? dataRecord.message : message)
    this.name = 'ApiError'
    this.status = status
    this.data = data

    // Next.js's HTTP access fallback digest silences 401/403/404 in its error handler.
    // Other 4xx use a generic digest so error reporters can drop expected client errors.
    if (status === 401 || status === 403 || status === 404) {
      this.digest = `NEXT_HTTP_ERROR_FALLBACK;${status}`
    } else if (status >= 400 && status < 500) {
      this.digest = `EXPECTED_CLIENT_ERROR;${status}`
    }

    if (dataRecord) {
      if (typeof dataRecord.code === 'string') this.code = dataRecord.code
      if (typeof dataRecord.request_id === 'string') this.requestId = dataRecord.request_id
    }
  }
}

/** Whether a value is a 4xx ApiError, for error-reporter `beforeSend` filters. */
export function isExpectedApiError(value: unknown): boolean {
  return (
    value != null &&
    typeof value === 'object' &&
    'name' in value &&
    value.name === 'ApiError' &&
    'status' in value &&
    typeof value.status === 'number' &&
    value.status >= 400 &&
    value.status < 500
  )
}
