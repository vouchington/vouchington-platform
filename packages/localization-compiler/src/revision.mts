import { createHash } from 'node:crypto'
import { serializeCatalogMessages, type CatalogMessage } from '@vouchington/localization'

export function catalogRevision(messages: readonly CatalogMessage[]): string {
  return createHash('sha256').update(serializeCatalogMessages(messages)).digest('hex')
}
