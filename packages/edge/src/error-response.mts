import { withHeaders } from './headers.mts'

export const NO_STORE_HEADERS = {
  'cache-control': 'no-store, max-age=0, must-revalidate',
  'cdn-cache-control': 'no-store',
  'cloudflare-cdn-cache-control': 'no-store',
} as const

/** JSON `{ message, code }` error that no cache layer will store. */
export function edgeErrorResponse(
  status: number,
  message: string,
  code: string,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ message, code }), {
    status,
    headers: { 'content-type': 'application/json', ...headers, ...NO_STORE_HEADERS },
  })
}

/** Returns 2xx/3xx unchanged; 4xx/5xx gain no-store headers with `set-cookie` preserved. */
export function withFailureNoStoreHeaders(response: Response): Response {
  if (response.status < 400) return response
  return withHeaders(response, NO_STORE_HEADERS)
}
