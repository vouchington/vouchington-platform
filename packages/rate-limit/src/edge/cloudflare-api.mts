export interface CloudflareEnvelope<T> {
  success: boolean
  result: T
  errors?: unknown[]
  result_info?: { page?: number; total_pages?: number }
}

export const CLOUDFLARE_API_ROOT = 'https://api.cloudflare.com/client/v4'

const RESPONSE_BODY_SNIPPET_LIMIT = 500

async function throwResponseError(response: Response, reason: string): Promise<never> {
  const body = (await response.text()).slice(0, RESPONSE_BODY_SNIPPET_LIMIT)
  throw new Error(`Cloudflare API ${reason} (${response.status}): ${body}`)
}

/**
 * Parses a Cloudflare API envelope. Status and content type are checked before parsing so an
 * upstream error (a WAF block, a 502, any non-JSON body) surfaces its real status and body.
 */
export async function readCloudflareEnvelope<T>(
  response: Response,
): Promise<CloudflareEnvelope<T>> {
  if (!response.ok) return throwResponseError(response, 'request failed')
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return throwResponseError(response, 'returned a non-JSON response')
  }
  const envelope = (await response.json()) as CloudflareEnvelope<T>
  if (!envelope.success) {
    throw new Error(
      `Cloudflare API request failed (${response.status}): ${JSON.stringify(envelope.errors ?? [])}`,
    )
  }
  return envelope
}
