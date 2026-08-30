import { withTemporaryMediaFile } from './streams.mts'
import type { MediaBody } from './types.mts'

export interface ProcessMediaMetadataDependencies<Record, Metadata> {
  canProcess(record: Record): boolean
  extractMetadata(path: string): Promise<Metadata>
  finalize(record: Record, metadata: Metadata): Promise<Record | null>
  getObjectKey(record: Record): string
  load(id: string): Promise<Record | null>
  markFailed(record: Record, error: unknown): Promise<void>
  onFailed?: (record: Record, error: unknown) => Promise<void>
  onFinalized?: (record: Record) => Promise<void>
  onPostFinalizeError?: (error: unknown, record: Record) => Promise<void>
  readObject(key: string): Promise<MediaBody>
  validateMetadata?: (metadata: Metadata, record: Record) => void | Promise<void>
}

export async function processMediaMetadata<Record, Metadata>(
  id: string,
  dependencies: ProcessMediaMetadataDependencies<Record, Metadata>,
): Promise<Record | null> {
  const record = await dependencies.load(id)
  if (record === null) return null
  if (!dependencies.canProcess(record)) return null

  try {
    const body = await dependencies.readObject(dependencies.getObjectKey(record))
    const metadata = await withTemporaryMediaFile(body, (path) =>
      dependencies.extractMetadata(path),
    )
    await dependencies.validateMetadata?.(metadata, record)
    const finalized = await dependencies.finalize(record, metadata)
    if (finalized === null) return null
    await runPostFinalize(finalized, dependencies)
    return finalized
  } catch (error) {
    try {
      await dependencies.markFailed(record, error)
      await dependencies.onFailed?.(record, error)
    } catch {
      // Preserve the processing error; failure reporting is best effort.
    }
    throw error
  }
}

async function runPostFinalize<Record, Metadata>(
  record: Record,
  dependencies: ProcessMediaMetadataDependencies<Record, Metadata>,
): Promise<void> {
  try {
    await dependencies.onFinalized?.(record)
  } catch (error) {
    try {
      await dependencies.onPostFinalizeError?.(error, record)
    } catch {
      // Completion is durable; post-finalize reporting must not undo it.
    }
  }
}
