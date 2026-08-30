import { describe, expect, it, vi } from 'vitest'

import { createMediaUpload } from './create-upload.mts'

describe('createMediaUpload', () => {
  it('signs and persists a validated pending upload', async () => {
    const order: string[] = []
    const savePending = vi.fn(async (upload) => {
      order.push('save')
      return { ...upload, state: 'pending' }
    })
    const result = await createMediaUpload(
      { contentType: 'image/png', contentLength: 4 },
      {
        policy: { acceptsContentType: () => true, maxBytes: 10 },
        createId: () => 'id',
        createObjectKey: (id) => `objects/${id}`,
        expiresInSeconds: 30,
        now: () => new Date('2026-01-01T00:00:00Z'),
        presignUpload: vi.fn(async () => {
          order.push('sign')
          return 'signed'
        }),
        savePending,
      },
    )
    expect(order).toEqual(['sign', 'save'])
    expect(result).toMatchObject({
      id: 'id',
      key: 'objects/id',
      uploadUrl: 'signed',
      expiresAt: new Date('2026-01-01T00:00:30Z'),
    })
  })

  it('uses the system clock when no clock is injected', async () => {
    const before = Date.now()
    const result = await createMediaUpload(
      { contentType: 'x/y', contentLength: 1 },
      {
        policy: { acceptsContentType: () => true, maxBytes: 1 },
        createId: () => 'id',
        createObjectKey: () => 'key',
        expiresInSeconds: 900,
        presignUpload: async (input) => String(input.expiresInSeconds),
        savePending: async (record) => record,
      },
    )
    expect(result.uploadUrl).toBe('900')
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 900_000)
  })

  it('does not persist when signing fails', async () => {
    const savePending = vi.fn()
    await expect(
      createMediaUpload(
        { contentType: 'x/y', contentLength: 1 },
        {
          policy: { acceptsContentType: () => true, maxBytes: 1 },
          createId: () => 'id',
          createObjectKey: () => 'key',
          expiresInSeconds: 900,
          presignUpload: async () => Promise.reject(new Error('sign')),
          savePending,
        },
      ),
    ).rejects.toThrow('sign')
    expect(savePending).not.toHaveBeenCalled()
  })

  it('anchors expiry before signing and persistence', async () => {
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date('2026-01-01T00:00:00Z'))
      .mockReturnValueOnce(new Date('2026-01-01T01:00:00Z'))
    const result = await createMediaUpload(
      { contentType: 'x/y', contentLength: 1 },
      {
        policy: { acceptsContentType: () => true, maxBytes: 1 },
        createId: () => 'id',
        createObjectKey: () => 'key',
        expiresInSeconds: 60,
        now,
        presignUpload: async () => 'signed',
        savePending: async (record) => record,
      },
    )
    expect(result.expiresAt).toEqual(new Date('2026-01-01T00:01:00Z'))
    expect(now).toHaveBeenCalledOnce()
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid expiry %s',
    async (expiry) => {
      await expect(
        createMediaUpload(
          { contentType: 'x/y', contentLength: 1 },
          {
            policy: { acceptsContentType: () => true, maxBytes: 1 },
            createId: () => 'id',
            createObjectKey: () => 'key',
            expiresInSeconds: expiry,
            presignUpload: async () => 'signed',
            savePending: async (record) => record,
          },
        ),
      ).rejects.toMatchObject({ code: 'EXPIRY_INVALID' })
    },
  )
})
