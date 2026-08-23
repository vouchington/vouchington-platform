export type HeaderValue = string | readonly string[] | undefined
export type ClientInfoHeaders = {
  client: string
  platform: string
  appVersion: string
  sdkVersion?: string
}
export type ClientInfoConfiguration<Client extends string, Platform extends string> = {
  headers: ClientInfoHeaders
  clients: readonly Client[]
  platforms: readonly Platform[]
  compatiblePlatforms: Readonly<Record<Client, readonly Platform[]>>
  versionPattern?: RegExp
}
export type ClientHeaders<Client extends string, Platform extends string> = {
  client: Client
  platform: Platform
  appVersion: string
  sdkVersion?: string
}

export class ClientInfoValidationError extends Error {
  readonly code = 'INVALID_CLIENT_INFO'
  readonly status = 400
  constructor(message: string) {
    super(message)
    this.name = 'ClientInfoValidationError'
  }
}

export function createClientInfoParser<Client extends string, Platform extends string>(
  configuration: ClientInfoConfiguration<Client, Platform>,
) {
  const clients = new Set(configuration.clients)
  const platforms = new Set(configuration.platforms)
  const versionPattern = configuration.versionPattern ?? /^[\x20-\x7e]{1,64}$/
  if (versionPattern.global || versionPattern.sticky)
    throw new TypeError('Version patterns cannot be global or sticky')
  return (headers: Record<string, HeaderValue>): ClientHeaders<Client, Platform> => {
    const client = requiredEnum(
      headers[configuration.headers.client],
      configuration.headers.client,
      clients,
    )
    const platform = requiredEnum(
      headers[configuration.headers.platform],
      configuration.headers.platform,
      platforms,
    )
    const appVersion = requiredVersion(
      headers[configuration.headers.appVersion],
      configuration.headers.appVersion,
      true,
      versionPattern,
    )!
    const sdkVersion = configuration.headers.sdkVersion
      ? requiredVersion(
          headers[configuration.headers.sdkVersion],
          configuration.headers.sdkVersion,
          false,
          versionPattern,
        )
      : undefined
    if (!configuration.compatiblePlatforms[client].includes(platform))
      throw new ClientInfoValidationError(`${client} and ${platform} are incompatible`)
    return { client, platform, appVersion, ...(sdkVersion === undefined ? {} : { sdkVersion }) }
  }
}

function requiredEnum<T extends string>(
  value: HeaderValue,
  name: string,
  allowed: ReadonlySet<T>,
): T {
  const single = requireSingle(value, name, true)!
  if (!allowed.has(single as T)) throw new ClientInfoValidationError(`${name} is invalid`)
  return single as T
}

function requiredVersion(
  value: HeaderValue,
  name: string,
  required: boolean,
  pattern: RegExp,
): string | undefined {
  const single = requireSingle(value, name, required)
  if (single !== undefined && !pattern.test(single))
    throw new ClientInfoValidationError(`${name} is invalid`)
  return single
}

function requireSingle(value: HeaderValue, name: string, required: boolean): string | undefined {
  if (typeof value !== 'string' && value !== undefined)
    throw new ClientInfoValidationError(`${name} must occur exactly once`)
  if (value === undefined || value === '') {
    if (required) throw new ClientInfoValidationError(`${name} is required`)
    return undefined
  }
  return value
}
