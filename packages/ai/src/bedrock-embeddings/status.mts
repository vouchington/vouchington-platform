export type BedrockBatchStatus =
  | 'preparing'
  | 'submitted'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type BedrockBatchLifecycle = {
  submitted_at: Date | null
  in_progress_at: Date | null
  completed_at: Date | null
  failed_at: Date | null
  cancelled_at: Date | null
}

export type BedrockBatchLifecycleColumn = keyof BedrockBatchLifecycle

/** The furthest lifecycle stage a row has reached; terminal stages win over progress stages. */
export function deriveBedrockBatchStatus(row: BedrockBatchLifecycle): BedrockBatchStatus {
  if (row.completed_at) return 'completed'
  if (row.failed_at) return 'failed'
  if (row.cancelled_at) return 'cancelled'
  if (row.in_progress_at) return 'in_progress'
  if (row.submitted_at) return 'submitted'
  return 'preparing'
}

/** The column a Bedrock job status stamps, or null for an unknown status. */
export function lifecycleColumnForBedrockStatus(
  bedrockStatus: string,
): BedrockBatchLifecycleColumn | null {
  switch (bedrockStatus) {
    case 'Submitted':
    case 'Validating':
    case 'Scheduled':
      return 'submitted_at'
    case 'InProgress':
    case 'Stopping':
      return 'in_progress_at'
    case 'Completed':
    case 'PartiallyCompleted':
      return 'completed_at'
    case 'Failed':
    case 'Expired':
      return 'failed_at'
    case 'Stopped':
      return 'cancelled_at'
    default:
      return null
  }
}
