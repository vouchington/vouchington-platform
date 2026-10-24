/**
 * Queue names are joined into a comma-separated `QUEUES` selection where a leading `-` means
 * exclude, so a name containing a comma or starting with `-` would change what is selected.
 */
export function assertSelectorSafeQueueName(name: string, where: string): void {
  if (name.includes(',') || name.startsWith('-')) {
    throw new Error(`${where} queue name "${name}" must not contain a comma or start with "-"`)
  }
}
