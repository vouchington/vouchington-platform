import { describe, expect, it } from 'vitest'

import { HostnameClaimedError, InvalidHostnameError, PolicyDeniedError } from './index.mts'
import { fixture } from './test-helpers.mts'

describe('exclusive hostname claims', () => {
  it('sets one primary, many additional claims, and resolves their owner', async () => {
    const subject = fixture()
    await subject.engine.claimPrimaryHostname(subject.context, 'one', 'HTTPS://ONE.TEST/path')
    await subject.engine.claimAdditionalHostname(subject.context, 'one', 'alt.one.test')
    await subject.engine.claimAdditionalHostname(subject.context, 'one', 'alt.one.test')
    await subject.engine.claimPrimaryHostname(subject.context, 'one', 'new.one.test')
    await expect(subject.engine.listHostnameClaims(subject.context, 'one')).resolves.toEqual([
      { entityId: 'one', hostname: 'alt.one.test', primary: false },
      { entityId: 'one', hostname: 'new.one.test', primary: true },
    ])
    await expect(
      subject.engine.resolveHostnameClaim(subject.context, 'NEW.ONE.TEST'),
    ).resolves.toEqual({
      entity: subject.entities.get('one'),
      hostname: 'new.one.test',
      primary: true,
    })
    await expect(
      subject.engine.resolveHostnameClaim(subject.context, 'absent.test'),
    ).resolves.toBeNull()
  })

  it('prevents contests and allows policy-controlled stale-owner reclamation', async () => {
    const denied = fixture()
    await denied.engine.claimAdditionalHostname(denied.context, 'one', 'shared.test')
    await expect(
      denied.engine.claimAdditionalHostname(denied.context, 'two', 'shared.test'),
    ).rejects.toEqual(new HostnameClaimedError('shared.test', 'one'))

    const allowed = fixture({
      catalog: {
        group: { mayReclaimHostname: ({ owner }) => owner === null || owner.id === 'one' },
        place: {},
      },
    })
    await allowed.engine.claimAdditionalHostname(allowed.context, 'one', 'shared.test')
    await allowed.engine.claimAdditionalHostname(allowed.context, 'two', 'shared.test')
    expect(allowed.state.claims.get('shared.test')?.entityId).toBe('two')
    allowed.entities.delete('two')
    await allowed.engine.claimAdditionalHostname(allowed.context, 'three', 'shared.test')
    expect(allowed.state.claims.get('shared.test')?.entityId).toBe('three')
  })

  it('removes and clears claims idempotently', async () => {
    const subject = fixture()
    await subject.engine.claimPrimaryHostname(subject.context, 'one', 'one.test')
    await subject.engine.claimAdditionalHostname(subject.context, 'one', 'a.one.test')
    await subject.engine.claimAdditionalHostname(subject.context, 'one', 'b.one.test')
    await subject.engine.claimAdditionalHostname(subject.context, 'one', 'c.one.test')
    await subject.engine.claimAdditionalHostname(subject.context, 'one', 'd.one.test')
    await subject.engine.claimPrimaryHostname(subject.context, 'one', 'b.one.test')
    await subject.engine.claimAdditionalHostname(subject.context, 'one', 'b.one.test')
    await subject.engine.removeAdditionalHostname(subject.context, 'one', 'a.one.test')
    await subject.engine.removeAdditionalHostname(subject.context, 'one', 'absent.test')
    await subject.engine.removePrimaryHostname(subject.context, 'two', 'one.test')
    await subject.engine.clearAdditionalHostnames(subject.context, 'one')
    await subject.engine.clearPrimaryHostname(subject.context, 'one')
    await expect(subject.engine.listHostnameClaims(subject.context, 'one')).resolves.toEqual([])
  })

  it('normalizes before locking and applies application policy', async () => {
    const subject = fixture({
      catalog: { group: { canClaimHostname: () => false }, place: {} },
    })
    await expect(
      subject.engine.claimPrimaryHostname(subject.context, 'one', 'café.test'),
    ).rejects.toEqual(new InvalidHostnameError('café.test'))
    await expect(
      subject.engine.claimPrimaryHostname(subject.context, 'one', 'one.test'),
    ).rejects.toEqual(new PolicyDeniedError('claim hostname', 'group'))
  })

  it('applies application policy to claim removal and clearing', async () => {
    const subject = fixture({
      catalog: { group: { canRemoveHostname: () => false }, place: {} },
    })
    await subject.engine.claimPrimaryHostname(subject.context, 'one', 'one.test')
    await subject.engine.claimAdditionalHostname(subject.context, 'one', 'alt.one.test')
    await expect(
      subject.engine.removePrimaryHostname(subject.context, 'one', 'one.test'),
    ).rejects.toEqual(new PolicyDeniedError('remove hostname claim', 'group'))
    await expect(subject.engine.clearAdditionalHostnames(subject.context, 'one')).rejects.toEqual(
      new PolicyDeniedError('remove hostname claim', 'group'),
    )
  })
})

describe('non-exclusive hostname associations', () => {
  it('associates the same hostname with several entities independently of claims', async () => {
    const subject = fixture()
    await subject.engine.claimPrimaryHostname(subject.context, 'one', 'shared.test')
    await subject.engine.associateAdditionalHostname(subject.context, 'one', 'shared.test')
    await subject.engine.associatePrimaryHostname(subject.context, 'one', 'shared.test')
    await subject.engine.associateAdditionalHostname(subject.context, 'one', 'shared.test')
    await subject.engine.associatePrimaryHostname(subject.context, 'two', 'shared.test')
    await subject.engine.associatePrimaryHostname(subject.context, 'two', 'other.test')
    await subject.engine.associateAdditionalHostname(subject.context, 'two', 'other.test')
    await expect(
      subject.engine.resolveHostnameAssociations(subject.context, 'SHARED.TEST'),
    ).resolves.toEqual([
      { entity: subject.entities.get('one'), hostname: 'shared.test', primary: true },
    ])
    await expect(subject.engine.listHostnameAssociations(subject.context, 'two')).resolves.toEqual([
      { entityId: 'two', hostname: 'other.test', primary: true },
    ])
  })

  it('removes all matching association variants and applies policy', async () => {
    const subject = fixture()
    await subject.engine.associateAdditionalHostname(subject.context, 'one', 'one.test')
    await subject.engine.removeHostnameAssociation(subject.context, 'one', 'ONE.TEST')
    await subject.engine.removeHostnameAssociation(subject.context, 'one', 'one.test')
    await expect(subject.engine.listHostnameAssociations(subject.context, 'one')).resolves.toEqual(
      [],
    )

    const denied = fixture({
      catalog: { group: { canClaimHostname: () => false }, place: {} },
    })
    await expect(
      denied.engine.associateAdditionalHostname(denied.context, 'one', 'one.test'),
    ).rejects.toEqual(new PolicyDeniedError('associate hostname', 'group'))

    const removeDenied = fixture({
      catalog: { group: { canRemoveHostname: () => false }, place: {} },
    })
    await removeDenied.engine.associateAdditionalHostname(removeDenied.context, 'one', 'one.test')
    await expect(
      removeDenied.engine.removeHostnameAssociation(removeDenied.context, 'one', 'one.test'),
    ).rejects.toEqual(new PolicyDeniedError('remove hostname association', 'group'))
  })
})
