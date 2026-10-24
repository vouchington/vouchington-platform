import { assertNonEmptyString, validateScheduledJobRepeat } from './repeat.mts'
import type {
  ManifestValidationOptions,
  ScheduledJobDefinition,
  ScheduledJobManifest,
} from './types.mts'

/**
 * Validates manifests: nonempty trimmed names, one manifest per queue (stale-scheduler removal is
 * scoped to a queue, so two manifests for one queue would delete each other's schedulers),
 * unique scheduler keys across all manifests,
 * `data` xor `dataFactory`, a valid repeat for non-thunk repeats (thunks are validated when they
 * are resolved at registration), and a nonempty list of operator surfaces, each passed to
 * `validateSurface`.
 */
export function validateScheduledJobManifests<J extends ScheduledJobDefinition<any>>(
  manifests: readonly ScheduledJobManifest<J>[],
  { validateSurface }: ManifestValidationOptions<J> = {},
): void {
  const schedulerKeys = new Set<string>()
  const queueNames = new Set<string>()
  for (const manifest of manifests) {
    assertNonEmptyString(manifest.queueName, 'queueName')
    if (queueNames.has(manifest.queueName))
      throw new Error(`Duplicate manifest for queue: ${manifest.queueName}`)
    queueNames.add(manifest.queueName)
    for (const job of manifest.jobs) {
      assertNonEmptyString(job.schedulerId, 'schedulerId')
      assertNonEmptyString(job.template.name, 'job name')
      const schedulerKey = `${manifest.queueName}/${job.schedulerId}`
      const template = job.template as { data?: unknown; dataFactory?: unknown }
      if (template.dataFactory !== undefined && typeof template.dataFactory !== 'function') {
        throw new Error(`${schedulerKey} dataFactory must be a function`)
      }
      if (template.data !== undefined && template.dataFactory !== undefined) {
        throw new Error(`${schedulerKey} cannot define data and dataFactory`)
      }
      if (typeof job.repeat !== 'function') {
        validateScheduledJobRepeat(job.repeat, schedulerKey, job.subMinuteJustification)
      }
      if (job.operatorSurfaces.length === 0) {
        throw new Error(`${schedulerKey} must define an operator surface`)
      }
      if (schedulerKeys.has(schedulerKey))
        throw new Error(`Duplicate scheduled job: ${schedulerKey}`)
      schedulerKeys.add(schedulerKey)

      for (const surface of job.operatorSurfaces) validateSurface?.(surface, schedulerKey)
    }
  }
}

/** Builds and validates a manifest for one queue. */
export function defineScheduledJobManifest<J extends ScheduledJobDefinition<any>>(
  queueName: string,
  jobs: readonly J[],
  options?: ManifestValidationOptions<J>,
): ScheduledJobManifest<J> {
  const manifest = { queueName, jobs }
  validateScheduledJobManifests([manifest], options)
  return manifest
}
