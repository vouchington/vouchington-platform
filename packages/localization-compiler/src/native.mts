import {
  compareCodePoints,
  type LocalizationLeaf,
  type MessageDescriptor,
  type PluralForms,
} from '@vouchington/localization'

export type NativeIdentifier = (id: string) => string
export type NativeResourceEntry = readonly [string, string]
export type NativeKeyConsumer = 'swift' | 'dotnet'

export type SwiftRenderOptions = Readonly<{
  headerComment?: string
}>

export type DotnetKeysRenderOptions = Readonly<{
  headerComment?: string
  namespace?: string
  includeAll?: boolean
}>

export type DotnetDescriptorsRenderOptions = Readonly<{
  headerComment?: string
  namespace?: string
  kindEnum?: boolean
}>

/** Converts a dotted, kebab, snake, or camelCase message key into a Swift or .NET identifier. */
export function nativeKeyIdentifier(key: string, consumer: NativeKeyConsumer): string {
  const words = key
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1.$2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  const upperFirst = consumer === 'dotnet'
  return words
    .map((word, index) => {
      const normalized = word.toLowerCase()
      return index === 0 && !upperFirst
        ? normalized
        : normalized.charAt(0).toUpperCase() + normalized.slice(1)
    })
    .join('')
}

export function nativeLeafVariants(id: string, leaf: LocalizationLeaf): NativeResourceEntry[] {
  if (typeof leaf === 'string') return [[id, leaf]]
  if (leaf.kind === 'plural') {
    return [
      [`${id}.__plural.one`, requireOne(id, leaf.forms)],
      [`${id}.__plural.other`, leaf.forms.other],
    ]
  }
  return Object.entries(leaf.cases)
    .toSorted(([left], [right]) => compareCodePoints(left, right))
    .flatMap(([selected, forms]) => [
      [`${id}.__select.${selected}.one`, requireOne(id, forms)] as const,
      [`${id}.__select.${selected}.other`, forms.other] as const,
    ])
}

export function renderSwiftStrings(
  entries: readonly NativeResourceEntry[],
  options: SwiftRenderOptions = {},
): string {
  const header = options.headerComment ?? '// Generated localization strings. Do not edit.'
  return `${header}\n${entries
    .map(([key, value]) => `"${key}" = "${escapeSwift(value)}";`)
    .join('\n')}\n`
}

export function renderResx(entries: readonly NativeResourceEntry[]): string {
  const data = entries
    .map(
      ([key, value]) =>
        `  <data name="${escapeXml(key)}" xml:space="preserve"><value>${escapeXml(value)}</value></data>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>\n<root>\n${data}\n</root>\n`
}

export function renderSwiftKeys(
  ids: readonly string[],
  identifier: NativeIdentifier,
  options: SwiftRenderOptions = {},
): string {
  const header = options.headerComment ?? '// Generated localization keys. Do not edit.'
  const lines = ids.map(
    (id) => `    public static let ${identifier(id)} = UiMessageKey(rawValue: "${id}")`,
  )
  return `${header}\npublic struct UiMessageKey: Hashable, Sendable {\n    public let rawValue: String\n    public init(rawValue: String) { self.rawValue = rawValue }\n${lines.join('\n')}\n}\n`
}

export function renderDotnetKeys(
  ids: readonly string[],
  identifier: NativeIdentifier,
  options: DotnetKeysRenderOptions = {},
): string {
  const header = options.headerComment ?? '// Generated localization keys. Do not edit.'
  const namespace = options.namespace ?? 'Localization'
  const lines = ids.map(
    (id) => `    public static readonly UiMessageKey ${identifier(id)} = new("${id}");`,
  )
  const allSection = options.includeAll
    ? `\n\n    public static IReadOnlyList<UiMessageKey> All { get; } =\n    [\n${ids.map((id) => `        ${identifier(id)},`).join('\n')}\n    ];`
    : ''
  return `${header}\n#nullable enable\nnamespace ${namespace};\n\npublic readonly record struct UiMessageKey(string Value)\n{\n${lines.join('\n')}${allSection}\n}\n`
}

export function renderSwiftDescriptors(
  entries: ReadonlyArray<readonly [string, MessageDescriptor]>,
  identifier: NativeIdentifier,
  options: SwiftRenderOptions = {},
): string {
  const header = options.headerComment ?? '// Generated localization descriptors. Do not edit.'
  const values = entries.map(([id, descriptor]) => swiftDescriptorLine(id, descriptor, identifier))
  return `${header}\npublic struct UiMessageDescriptor: Sendable {\n    public enum Kind: Sendable { case plural, selectPlural }\n    public let kind: Kind\n    public let valueParameter: String\n    public let selectParameter: String?\n    public let numberParameters: [String]\n    public let cases: [String]\n}\n\npublic let uiMessageDescriptors: [UiMessageKey: UiMessageDescriptor] = [\n${values.join(',\n')}\n]\n`
}

export function renderDotnetDescriptors(
  entries: ReadonlyArray<readonly [string, MessageDescriptor]>,
  identifier: NativeIdentifier,
  options: DotnetDescriptorsRenderOptions = {},
): string {
  const header = options.headerComment ?? '// Generated localization descriptors. Do not edit.'
  const namespace = options.namespace ?? 'Localization'
  const kindEnum = options.kindEnum ?? false
  const values = entries.map(([id, descriptor]) =>
    dotnetDescriptorLine(id, descriptor, identifier, kindEnum),
  )
  const typeHeader = kindEnum
    ? 'public enum UiMessageDescriptorKind { Plural, SelectPlural }\npublic sealed record UiMessageDescriptor(UiMessageDescriptorKind Kind, string ValueParameter, string? SelectParameter, IReadOnlyList<string> NumberParameters, IReadOnlyList<string> Cases);'
    : 'public sealed record UiMessageDescriptor(string Kind, string ValueParameter, string? SelectParameter, IReadOnlyList<string> NumberParameters, IReadOnlyList<string> Cases);'
  return `${header}\n#nullable enable\nnamespace ${namespace};\n\n${typeHeader}\n\npublic static class UiMessageDescriptors\n{\n    public static IReadOnlyDictionary<UiMessageKey, UiMessageDescriptor> All { get; } =\n        new Dictionary<UiMessageKey, UiMessageDescriptor>\n        {\n${values.join(',\n')}\n        };\n}\n`
}

function swiftDescriptorLine(
  id: string,
  descriptor: MessageDescriptor,
  identifier: NativeIdentifier,
): string {
  const select = descriptor.kind === 'select-plural' ? `"${descriptor.selectParameter}"` : 'nil'
  const cases =
    descriptor.kind === 'select-plural'
      ? JSON.stringify([...descriptor.cases].toSorted(compareCodePoints))
      : '[]'
  return `    .${identifier(id)}: UiMessageDescriptor(kind: .${identifier(descriptor.kind)}, valueParameter: "${descriptor.valueParameter}", selectParameter: ${select}, numberParameters: ${JSON.stringify(descriptor.numberParameters ?? [])}, cases: ${cases})`
}

function dotnetDescriptorLine(
  id: string,
  descriptor: MessageDescriptor,
  identifier: NativeIdentifier,
  kindEnum: boolean,
): string {
  const kind = kindEnum
    ? `UiMessageDescriptorKind.${identifier(descriptor.kind)}`
    : `"${descriptor.kind}"`
  const select = descriptor.kind === 'select-plural' ? `"${descriptor.selectParameter}"` : 'null'
  const cases =
    descriptor.kind === 'select-plural' ? [...descriptor.cases].toSorted(compareCodePoints) : []
  return `        [UiMessageKey.${identifier(id)}] = new(${kind}, "${descriptor.valueParameter}", ${select}, [${(descriptor.numberParameters ?? []).map((value) => `"${value}"`).join(', ')}], [${cases.map((value) => `"${value}"`).join(', ')}])`
}

function requireOne(id: string, forms: PluralForms): string {
  if (forms.one === undefined) {
    throw new TypeError(`Native descriptor "${id}" must define a one form`)
  }
  return forms.one
}

function escapeSwift(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
