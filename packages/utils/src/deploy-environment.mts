export type DeployEnvironment = 'development' | 'test' | 'staging' | 'production'
export type DeployEnvironmentSource = {
  ENVIRONMENT?: string | undefined
  NODE_ENV?: string | undefined
}

const known = new Set<DeployEnvironment>(['development', 'test', 'staging', 'production'])

export function getDeployEnvironment(
  source: DeployEnvironmentSource = process.env,
): DeployEnvironment {
  return normalize(source.ENVIRONMENT) ?? normalize(source.NODE_ENV) ?? 'development'
}

export function isDeployedEnvironment(source: DeployEnvironmentSource = process.env): boolean {
  const environment = getDeployEnvironment(source)
  return environment === 'staging' || environment === 'production'
}

export function isProductionEnvironment(source: DeployEnvironmentSource = process.env): boolean {
  return getDeployEnvironment(source) === 'production'
}

function normalize(value: string | undefined): DeployEnvironment | undefined {
  const trimmed = value?.trim()
  return trimmed && known.has(trimmed as DeployEnvironment)
    ? (trimmed as DeployEnvironment)
    : undefined
}
