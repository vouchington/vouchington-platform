import { describe, expect, it } from 'vitest'
import {
  getDeployEnvironment,
  isDeployedEnvironment,
  isProductionEnvironment,
} from './deploy-environment.mts'

describe('deployment environments', () => {
  it('prefers the explicit environment and falls back safely', () => {
    expect(getDeployEnvironment({ ENVIRONMENT: 'staging', NODE_ENV: 'production' })).toBe('staging')
    expect(getDeployEnvironment({ ENVIRONMENT: 'invalid', NODE_ENV: 'test' })).toBe('test')
    expect(getDeployEnvironment({})).toBe('development')
  })

  it('classifies deployed and production environments', () => {
    expect(isDeployedEnvironment({ ENVIRONMENT: 'production' })).toBe(true)
    expect(isDeployedEnvironment({ ENVIRONMENT: 'test' })).toBe(false)
    expect(isProductionEnvironment({ ENVIRONMENT: 'staging' })).toBe(false)
    expect(isProductionEnvironment({ ENVIRONMENT: 'production' })).toBe(true)
  })
})
