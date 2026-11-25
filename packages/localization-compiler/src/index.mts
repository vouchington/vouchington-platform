export { compileLocalizationSqlite } from './compile.mts'
export {
  catalogDirectoryDigest,
  ensureCompiledLocalizationCatalog,
  type EnsureCompiledCatalogOptions,
} from './local-cache.mts'
export { writeCatalogTablesAtomically, type AuthoringCatalogTables } from './catalog-tables-io.mts'
export { exportLocalizationCsv, importLocalizationCsv } from './csv.mts'
export { loadCatalogDirectory } from './load.mts'
export { checkCatalogDirectory } from './catalog-format.mts'
export { openLocalizationDatabase, type LocalizationDatabase } from './open.mts'
export { explainLocalizationPlan, resolveLocalizationBatch } from './resolve.mts'
export {
  nativeKeyIdentifier,
  nativeLeafVariants,
  renderDotnetDescriptors,
  renderDotnetKeys,
  renderResx,
  renderSwiftDescriptors,
  renderSwiftKeys,
  renderSwiftStrings,
  type DotnetDescriptorsRenderOptions,
  type DotnetKeysRenderOptions,
  type NativeDescriptor,
  type NativeIdentifier,
  type NativeKeyConsumer,
  type NativeResourceEntry,
  type SwiftRenderOptions,
} from './native.mts'
export {
  syncGeneratedNativeFiles,
  type GeneratedNativeFile,
  type SyncGeneratedNativeFilesOptions,
} from './native-files.mts'
export { stripCodeCommentsAndStrings } from './source-mask.mts'
export { catalogRevision } from './revision.mts'
export { validateLocalizationCatalog, sortedCatalog } from './catalog.mts'
export { exportCatalogCsv, importCatalogCsv } from './catalog-csv.mts'
export { validateCatalogMessages, parseCatalogFile } from './validate.mts'
export { runLocalizationCli } from './cli.mts'
export { CatalogRowNotFoundError } from './catalog-row-not-found.mts'
