import { createHash } from 'node:crypto'
import {
  canonicalJson,
  catalogFromMessages,
  type CatalogMessage,
  type LocalizationCatalog,
} from '@vouchington/localization'

export function catalogRevision(source: LocalizationCatalog | readonly CatalogMessage[]): string {
  const catalog = Array.isArray(source) ? catalogFromMessages(source) : source
  return createHash('sha256').update(canonicalJson(catalog)).digest('hex')
}
