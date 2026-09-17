/**
 * Adds the `notice` listener methods that owned transactions attach around `BEGIN`
 * to a mock pool client, mutating it so every reference sees them.
 */
export function withNoticeEvents<Client extends object>(
  client: Client,
): Client & { on: () => void; off: () => void } {
  return Object.assign(client, { on() {}, off() {} })
}
