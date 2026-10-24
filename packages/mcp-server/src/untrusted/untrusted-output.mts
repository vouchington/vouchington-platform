import { sanitizePromptInjection, wrapExternalContent } from '@jongleberry/vurst-prompt'

/** Field names, injected by the application, that decide what is wrapped and what is dropped. */
export type UntrustedFieldSets = {
  /** Fields whose text an agent must treat as data, at any depth. */
  untrusted: ReadonlySet<string>
  /** Fields that are removed from output and from output schemas, at any depth. */
  private: ReadonlySet<string>
}

/** Turns the text of one untrusted field into what the agent sees. */
export type WrapUntrusted = (text: string, field: string) => unknown

/** The default wrap: strip prompt-injection markup, then mark the text as external content. */
export const wrapWithVurstPrompt: WrapUntrusted = async (text, field) =>
  wrapExternalContent(await sanitizePromptInjection(text), {
    source: 'api_response',
    contentType: field,
  })

/** The schema of an untrusted field once wrapped: text, or null when the field was absent. */
const untrustedText = () => ({ anyOf: [{ type: 'string' }, { type: 'null' }] })

/** Filter before serializing an untrusted JSON field, including its nested objects. */
export function filterPrivateOutputFields(
  value: unknown,
  privateFields: ReadonlySet<string>,
): unknown {
  if (value instanceof Date || Buffer.isBuffer(value)) return value
  if (Array.isArray(value))
    return value.map((child) => filterPrivateOutputFields(child, privateFields))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !privateFields.has(key))
      .map(([key, child]) => [key, filterPrivateOutputFields(child, privateFields)]),
  )
}

/**
 * An output schema as the agent will see it after `wrapUntrustedOutput`: untrusted fields become
 * `string | null`, and private fields disappear from `properties` and `required`.
 */
export function adminOutputSchema(value: unknown, fields: UntrustedFieldSets): unknown {
  if (Array.isArray(value)) return value.map((child) => adminOutputSchema(child, fields))
  if (!value || typeof value !== 'object') return value
  const schema = value as Record<string, unknown>
  const output = Object.fromEntries(
    Object.entries(schema).map(([key, child]) => {
      if (key === 'properties' && child && typeof child === 'object' && !Array.isArray(child))
        return [key, schemaProperties(child as Record<string, unknown>, fields)]
      // A required private field would reject the filtered output, wherever it is listed.
      if (key === 'required' && Array.isArray(child))
        return [key, child.filter((name) => !fields.private.has(String(name)))]
      return [key, adminOutputSchema(child, fields)]
    }),
  )
  return output
}

function schemaProperties(properties: Record<string, unknown>, fields: UntrustedFieldSets) {
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([key]) => !fields.private.has(key))
      .map(([key, child]) => [
        key,
        fields.untrusted.has(key) ? untrustedText() : adminOutputSchema(child, fields),
      ]),
  )
}

/**
 * A value with private fields removed, dates as ISO strings, and every untrusted field wrapped.
 * An object or array in an untrusted field is wrapped as its JSON text. `null` and `undefined`
 * stay as they are.
 */
export async function wrapUntrustedOutput(
  value: unknown,
  { wrap = wrapWithVurstPrompt, ...fields }: UntrustedFieldSets & { wrap?: WrapUntrusted },
): Promise<unknown> {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value))
    return Promise.all(value.map((child) => wrapUntrustedOutput(child, { ...fields, wrap })))
  if (!value || typeof value !== 'object') return value
  const entries = await Promise.all(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !fields.private.has(key))
      .map(async ([key, child]) => {
        if (fields.untrusted.has(key) && child !== null && child !== undefined) {
          // Private fields inside an untrusted object or array must not survive as wrapped text.
          const text =
            typeof child === 'string'
              ? child
              : JSON.stringify(filterPrivateOutputFields(child, fields.private))
          return [key, await wrap(text, key)]
        }
        return [key, await wrapUntrustedOutput(child, { ...fields, wrap })]
      }),
  )
  return Object.fromEntries(entries)
}
