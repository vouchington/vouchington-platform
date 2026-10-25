import { describe, expect, expectTypeOf, it } from 'vitest'

import type { McpTool, McpToolMeta } from '../types.mts'
import { createMergedTool, type MergedToolSource } from './create-merged-tool.mts'
import { createManageEntityTool, type ManageEntityToolConfig } from './manage-entity.mts'

type RequiredMeta = McpToolMeta & { annotations: { readOnlyHint: boolean } }
type ToolWithMeta = McpTool<unknown, unknown, unknown, unknown, readonly [], RequiredMeta>
type SourceWithMeta = MergedToolSource<unknown, unknown, never, unknown, RequiredMeta>
type ConfigWithMeta = ManageEntityToolConfig<
  Record<string, unknown>,
  Record<string, unknown>,
  unknown,
  unknown,
  RequiredMeta
>

describe('tool metadata types', () => {
  it('requires application annotations in tools and helper inputs', () => {
    type MissingAnnotations = { title: string; api: null }
    expectTypeOf<MissingAnnotations>().not.toExtend<NonNullable<ToolWithMeta['meta']>>()
    expectTypeOf<MissingAnnotations>().not.toExtend<NonNullable<SourceWithMeta['meta']>>()
    expectTypeOf<MissingAnnotations>().not.toExtend<NonNullable<ConfigWithMeta['meta']>>()
  })

  it('retains required annotations in merged and manage-entity tool outputs', () => {
    const meta: RequiredMeta = {
      title: 'Example',
      api: null,
      annotations: { readOnlyHint: true },
      outputSchema: { type: 'object' },
    }
    const source: SourceWithMeta = {
      schema: { parameters: { type: 'object' } },
      meta,
      function: () => () => ({}),
    }
    const merged = createMergedTool<unknown, unknown, RequiredMeta>(
      'merged_example',
      'Example',
      [{ option: 'read', source }],
      { compatibilityKey: () => 'same' },
    )
    const managed = createManageEntityTool<
      Record<string, unknown>,
      Record<string, unknown>,
      unknown,
      unknown,
      unknown,
      RequiredMeta
    >({
      toolName: 'manage_example',
      description: 'Example',
      addProperties: {},
      updateProperties: {},
      requireUser: (user) => user,
      addFn: () => Promise.resolve({}),
      updateFn: () => Promise.resolve({}),
      removeFn: () => Promise.resolve({}),
      entitySchema: { type: 'object' },
      meta,
    })

    expectTypeOf(merged.meta!.annotations.readOnlyHint).toEqualTypeOf<boolean>()
    expectTypeOf(managed.meta!.annotations.readOnlyHint).toEqualTypeOf<boolean>()
    expect(merged.meta?.annotations).toEqual({ readOnlyHint: true })
    expect(managed.meta?.annotations).toEqual({ readOnlyHint: true })
    expect(managed.meta?.selectApi?.({ action: 'add' })).toEqual([])
  })
})
