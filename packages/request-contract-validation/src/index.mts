import Ajv from 'ajv'
import type { AnySchema, ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'

const AjvCtor = Ajv as unknown as typeof import('ajv').Ajv
const installFormats = addFormats as unknown as (ajv: InstanceType<typeof AjvCtor>) => void

export type RequestCarrier = 'body' | 'header' | 'path' | 'query'
export type RequestContract = Partial<Record<RequestCarrier, unknown>>
export type RequestContractsBundle = {
  components: Record<string, unknown>
  operations: Record<string, RequestContract>
}
export type RequestValidationError = { message: string }

const requestCarriers: readonly RequestCarrier[] = ['body', 'header', 'path', 'query']

/** Compiles caller-owned request contracts once; callers choose the request boundary and error policy. */
export class RequestContractValidatorRegistry {
  private readonly validators = new Map<string, Partial<Record<RequestCarrier, ValidateFunction>>>()

  constructor(bundle: RequestContractsBundle) {
    if (!bundle || !isRecord(bundle.components) || !isRecord(bundle.operations)) {
      throw new TypeError('Request contract bundle needs components and operations maps')
    }
    const ajv = new AjvCtor({ allErrors: false, strict: false, strictSchema: true })
    installFormats(ajv)
    for (const [name, schema] of Object.entries(bundle.components)) {
      ajv.addSchema(schema as AnySchema, `#/components/schemas/${name}`)
    }
    for (const [operation, contract] of Object.entries(bundle.operations)) {
      if (!isRecord(contract)) throw new TypeError(`Invalid request contract for ${operation}`)
      const carriers: Partial<Record<RequestCarrier, ValidateFunction>> = {}
      for (const carrier of requestCarriers) {
        if (Object.hasOwn(contract, carrier)) {
          carriers[carrier] = ajv.compile(contract[carrier] as AnySchema)
        }
      }
      this.validators.set(operation, carriers)
    }
  }

  hasOperation(operation: string): boolean {
    return this.validators.has(operation)
  }

  validateBody(operation: string, value: unknown): RequestValidationError | null {
    return this.validate(operation, 'body', value)
  }

  validate(
    operation: string,
    carrier: RequestCarrier,
    value: unknown,
  ): RequestValidationError | null {
    const validators = this.validators.get(operation)
    if (!validators) throw new Error(`No request contract for ${operation}`)
    const validator = validators[carrier]
    if (!validator || validator(normalizeCarrierValue(carrier, value))) return null
    return { message: `Invalid request ${carrier}` }
  }

  validateOperation(
    operation: string,
    input: Partial<Record<RequestCarrier, unknown>>,
  ): RequestValidationError | null {
    if (!this.hasOperation(operation)) throw new Error(`No request contract for ${operation}`)
    for (const carrier of requestCarriers) {
      if (!Object.hasOwn(input, carrier)) continue
      const error = this.validate(operation, carrier, input[carrier])
      if (error) return error
    }
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeCarrierValue(carrier: RequestCarrier, value: unknown): unknown {
  if (carrier !== 'header' || !isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([name, headerValue]) => [name.toLowerCase(), headerValue]),
  )
}
