import { describe, expect, it } from 'vitest'
import {
  envContractsByName,
  envNamesBySensitivity,
  envNamesForSurface,
  groupEnvContracts,
  normalizeEnvContractGroups,
} from './env-contract.mts'

describe('environment contracts', () => {
  it('normalizes groups and supports surface and sensitivity lookups', () => {
    const contract = normalizeEnvContractGroups([
      groupEnvContracts('deployment', 'secret', ['runtime'] as const, ['TOKEN']),
      groupEnvContracts('local', 'public', ['runtime', 'build'] as const, ['PUBLIC_URL']),
    ])
    expect(contract).toContainEqual(expect.objectContaining({ key: 'deployment:runtime:TOKEN' }))
    expect(envNamesForSurface(contract, 'runtime')).toEqual(['TOKEN', 'PUBLIC_URL'])
    expect(envNamesBySensitivity(contract, 'public')).toEqual(['PUBLIC_URL'])
    expect(envContractsByName(contract).get('PUBLIC_URL')).toHaveLength(1)
  })

  it('rejects delimiter collisions and duplicate normalized keys', () => {
    expect(() => groupEnvContracts('bad:source', 'secret', ['runtime'], ['TOKEN'])).toThrow(
      'cannot contain',
    )
    expect(() => groupEnvContracts('source', 'secret', ['bad+surface'], ['TOKEN'])).toThrow(
      'cannot contain',
    )
    expect(() => groupEnvContracts('source', 'secret', ['runtime'], ['bad:name'])).toThrow(
      'cannot contain',
    )
    const group = groupEnvContracts('source', 'secret', ['runtime'], ['TOKEN'])
    expect(() => normalizeEnvContractGroups([group, group])).toThrow('unique')

    const mutableSurfaces = ['runtime']
    const mutableNames = ['TOKEN']
    const copied = groupEnvContracts('source', 'secret', mutableSurfaces, mutableNames)
    mutableSurfaces[0] = 'bad+surface'
    mutableNames[0] = 'bad:name'
    expect(normalizeEnvContractGroups([copied])[0]).toMatchObject({
      key: 'source:runtime:TOKEN',
    })

    expect(() =>
      normalizeEnvContractGroups([
        {
          sourceOfTruth: 'bad:source',
          sensitivity: 'secret',
          surfaces: ['runtime'],
          names: ['TOKEN'],
        },
      ]),
    ).toThrow('cannot contain')

    const normalized = normalizeEnvContractGroups([copied])
    expect(Object.isFrozen(normalized[0]?.surfaces)).toBe(true)
  })
})
