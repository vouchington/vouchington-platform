export interface CleanupAbandonedMediaDependencies<Record> {
  deleteObjects(records: readonly Record[]): Promise<void>
  deleteRecords(records: readonly Record[]): Promise<void>
  findAbandoned(): Promise<readonly Record[]>
  onDatabaseError?: (error: unknown, records: readonly Record[]) => Promise<void>
  onStorageError?: (error: unknown, records: readonly Record[]) => Promise<void>
}

export interface CleanupAbandonedMediaResult {
  deletedRecords: number
  storageDeleted: boolean
}

export async function cleanupAbandonedMedia<Record>(
  dependencies: CleanupAbandonedMediaDependencies<Record>,
): Promise<CleanupAbandonedMediaResult> {
  const records = await dependencies.findAbandoned()
  if (records.length === 0) return { deletedRecords: 0, storageDeleted: true }

  let storageDeleted = true
  try {
    await dependencies.deleteObjects(records)
  } catch (error) {
    storageDeleted = false
    try {
      await dependencies.onStorageError?.(error, records)
    } catch {
      // Continue with database cleanup even when storage reporting fails.
    }
  }

  try {
    await dependencies.deleteRecords(records)
  } catch (error) {
    try {
      await dependencies.onDatabaseError?.(error, records)
    } catch {
      // Preserve the database error; reporting is best effort.
    }
    throw error
  }
  return { deletedRecords: records.length, storageDeleted }
}
