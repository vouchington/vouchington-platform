const idOf = (message: unknown): string | number | undefined => {
  const id = (message as { id?: unknown } | null)?.id
  return typeof id === 'string' || typeof id === 'number' ? id : undefined
}

export function withUniqueIds(parsedBody: unknown): {
  parsedBody: unknown
  originalIds: Map<string | number, string | number>
} {
  const originalIds = new Map<string | number, string | number>()
  if (!Array.isArray(parsedBody)) return { parsedBody, originalIds }
  const ids = parsedBody.map(idOf).filter((id) => id !== undefined)
  if (new Set(ids).size === ids.length) return { parsedBody, originalIds }
  const unique = parsedBody.map((message: unknown, index) => {
    const id = idOf(message)
    if (id === undefined) return message
    originalIds.set(`batch-${index}`, id)
    return { ...(message as object), id: `batch-${index}` }
  })
  return { parsedBody: unique, originalIds }
}

export async function restoreIds(
  response: Response,
  originalIds: Map<string | number, string | number>,
): Promise<Response> {
  const restore = (reply: unknown) => {
    const id = idOf(reply)
    return id !== undefined && originalIds.has(id)
      ? { ...(reply as object), id: originalIds.get(id) }
      : reply
  }
  const payload: unknown = await response.json()
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new Response(
    JSON.stringify(Array.isArray(payload) ? payload.map(restore) : restore(payload)),
    {
      status: response.status,
      headers,
    },
  )
}
