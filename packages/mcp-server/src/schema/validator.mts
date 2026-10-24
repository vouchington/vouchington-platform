import * as AjvModule from 'ajv'
import type { FormatDefinition, ValidateFunction } from 'ajv'
import * as AddFormatsModule from 'ajv-formats'
import type { FormatsPlugin } from 'ajv-formats'

// One Ajv setup for everything the MCP surface validates: tool arguments on the way in and
// declared output schemas on the way out. Validators are cached per schema object identity.
const validators = new WeakMap<object, ValidateFunction>()
const selectedSchemas = new WeakMap<object, Map<object, object>>()
type AjvConstructor = typeof AjvModule.Ajv
// The default export is the CommonJS namespace under Node; bundlers may hand over the module itself.
/* v8 ignore next -- interop fallback for module shapes Node does not produce */
const AjvCtor = (AjvModule.default ?? AjvModule) as unknown as AjvConstructor
/* v8 ignore next -- interop fallback for module shapes Node does not produce */
const addFormats = (AddFormatsModule.default ?? AddFormatsModule) as unknown as FormatsPlugin

/**
 * The first violation of `schema` by `value`, or null when it conforms. The text names where and
 * which rule failed, never the offending value, so it is safe to log or report.
 */
export function findSchemaViolation(schema: object, value: unknown): string | null {
  const validate = validators.get(schema) ?? compileValidator(schema)
  validators.set(schema, validate)
  if (validate(value)) return null
  const selectedViolation = findSelectedArgumentViolation(schema, value)
  if (selectedViolation) return selectedViolation
  const error = validate.errors?.[0]
  /* v8 ignore next -- Ajv reports at least one error for an invalid value */
  return `${error?.instancePath || '/'} ${error?.message ?? 'is invalid'}`
}

// A failing oneOf can report another option's discriminator first. Preserve the selected source's
// argument diagnostic, after the complete envelope has already failed validation.
function findSelectedArgumentViolation(schema: object, value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('arguments' in value)) return null
  const input = value as Record<string, unknown>
  const root = schema as Record<string, unknown>
  const branches = root['oneOf']
  if (!Array.isArray(branches)) return null
  for (const branch of branches as Record<string, unknown>[]) {
    const properties = branch['properties'] as Record<string, Record<string, unknown>> | undefined
    const options = properties?.['option']?.['enum']
    const argumentsSchema = properties?.['arguments']
    if (!Array.isArray(options) || !options.includes(input['option']) || !argumentsSchema) continue
    const cached = selectedSchemas.get(schema) ?? new Map<object, object>()
    selectedSchemas.set(schema, cached)
    const selected = cached.get(branch) ?? { ...argumentsSchema, $defs: root['$defs'] ?? {} }
    cached.set(branch, selected)
    return findSchemaViolation(selected, input['arguments'])
  }
  return null
}

function compileValidator(schema: object): ValidateFunction {
  const ajv = new AjvCtor({ allErrors: false, strict: false })
  addFormats(ajv)
  const dateTime = addFormats.get('date-time') as FormatDefinition<string>
  if (
    typeof dateTime !== 'object' ||
    !('validate' in dateTime) ||
    typeof dateTime.validate !== 'function'
  )
    throw new Error('MCP date-time validation requires the synchronous Ajv full format')
  const validateDateTime = dateTime.validate
  ajv.addFormat('date-time', {
    ...dateTime,
    validate: (value: string) => validateDateTime(value) && hasValidLeapSecondPlacement(value),
  })
  return ajv.compile(schema)
}

/**
 * Called only after Ajv's full date-time validator accepts the value. This enforces structural
 * UTC month-end placement, not IERS announcement verification or future insertion prediction.
 */
function hasValidLeapSecondPlacement(value: string): boolean {
  const [date, time] = value.split(/t|\s/i)
  const parts = /^(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:z|([+-])(\d\d)(?::?(\d\d))?)$/i.exec(time!)
  if (!parts || Number(parts[3]) < 60) return true
  const year = Number(date!.slice(0, 4))
  const month = Number(date!.slice(5, 7))
  const day = Number(date!.slice(8, 10))
  const sign = parts[4] === '-' ? -1 : 1
  const offset = sign * (Number(parts[5] ?? 0) * 60 + Number(parts[6] ?? 0))
  const utcMinute = Number(parts[1]) * 60 + Number(parts[2]) - offset
  // An accepted leap-second minute is either 23:59 on this date, or 23:59 on the prior date.
  // Local day one therefore rolls back to the previous month's final day, including January.
  if (utcMinute === -1) return day === 1
  /* v8 ignore next -- Ajv accepts a leap second only in a 23:59 UTC minute */
  if (utcMinute !== 1439) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day === days[month - 1]
}
