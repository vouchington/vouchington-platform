/** Copies headers entry by entry so repeated `set-cookie` values survive. */
export function copyHeaders(headers: Headers): Headers {
  const copied = new Headers()
  headers.forEach((value, key) => {
    copied.append(key, value)
  })
  return copied
}

function rebuild(response: Response, headers: Headers): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/** Returns a response with `entries` set, replacing same-named headers and keeping `set-cookie`. */
export function withHeaders(response: Response, entries: Record<string, string>): Response {
  const headers = copyHeaders(response.headers)
  for (const [key, value] of Object.entries(entries)) headers.set(key, value)
  return rebuild(response, headers)
}

/** Returns a response with `entries` appended after the existing headers. */
export function appendHeaders(
  response: Response,
  entries: ReadonlyArray<readonly [string, string]>,
): Response {
  const headers = copyHeaders(response.headers)
  for (const [key, value] of entries) headers.append(key, value)
  return rebuild(response, headers)
}

/** Deletes every named header in place. */
export function deleteHeaders(headers: Headers, names: Iterable<string>): void {
  for (const name of names) headers.delete(name)
}
