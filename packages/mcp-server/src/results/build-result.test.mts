import { describe, expect, it } from 'vitest'

import type { ToolOutputSchema } from '../types.mts'
import { buildToolResult } from './build-result.mts'
import { McpToolOutputMismatchError, McpToolResultTooLargeError } from './errors.mts'
import { MAX_MCP_TOOL_RESULT_BYTES } from './serialize.mts'

// The definition name is reused with a different shape, because references resolve inside each
// schema and not in a namespace shared with the input.
const outputSchema: ToolOutputSchema = {
  type: 'object',
  properties: { result: { $ref: '#/$defs/item' } },
  required: ['result'],
  additionalProperties: false,
  $defs: {
    item: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1 }, status: { enum: ['found'] } },
      required: ['id', 'status'],
      additionalProperties: false,
    },
  },
}
const good = { result: { id: 'owned-item', status: 'found' } }

describe('buildToolResult', () => {
  it('returns one text block for a tool without an output schema', () => {
    expect(buildToolResult('plain', { anything: [1, 2] }, undefined)).toEqual({
      content: [{ type: 'text', text: '{"anything":[1,2]}' }],
    })
  })

  it('also returns structuredContent, validated, for a tool with one', () => {
    expect(buildToolResult('read', good, outputSchema)).toEqual({
      content: [{ type: 'text', text: JSON.stringify(good) }],
      structuredContent: good,
    })
  })

  it.each([
    { result: { id: 'owned-item' } },
    { result: { id: 'owned-item', status: 'invalid' } },
    { result: { id: 42, status: 'found' } },
    { result: { id: 'owned-item', status: 'found', unknown: true } },
  ])('rejects structured content that breaks its own definitions: %j', (result) => {
    expect(() => buildToolResult('read', result, outputSchema)).toThrow(McpToolOutputMismatchError)
  })

  it('names the tool and rule in a mismatch, never the offending value', () => {
    const attempt = () =>
      buildToolResult('read', { result: { id: 'secret-value-123', status: 'x' } }, outputSchema)

    expect(attempt).toThrow(
      'read returned a result that does not match its output schema: /result/status must be equal to one of the allowed values',
    )
    expect(attempt).not.toThrow('secret-value-123')
  })

  it('checks the selected source schema first and reports it separately', () => {
    const selected: ToolOutputSchema = {
      type: 'object',
      properties: { other: { type: 'string' } },
      required: ['other'],
    }

    expect(() => buildToolResult('read', good, outputSchema, selected)).toThrow(
      'read returned a result that does not match its selected output schema: / must have required property',
    )
    expect(buildToolResult('read', good, outputSchema, outputSchema).structuredContent).toEqual(
      good,
    )
  })

  it('rejects a result over half the bound before it is parsed or validated', () => {
    const big = { result: { id: 'x'.repeat(MAX_MCP_TOOL_RESULT_BYTES / 2), status: 'found' } }

    expect(() => buildToolResult('read', big, outputSchema)).toThrow(McpToolResultTooLargeError)
    expect(() => buildToolResult('read', big, outputSchema)).not.toThrow(McpToolOutputMismatchError)
  })

  it('holds the assembled response, not the raw JSON, to the bound', () => {
    // Each quote is two bytes of JSON, and the text block escapes the JSON again.
    const quotes = { quoted: '"'.repeat(350_000) }
    const schema: ToolOutputSchema = { type: 'object' }

    expect(() => buildToolResult('plain', quotes, undefined)).toThrow('Tool response exceeds')
    expect(() => buildToolResult('read', { quoted: '"'.repeat(200_000) }, schema)).toThrow(
      'Tool response exceeds',
    )
    expect(buildToolResult('plain', { quoted: '"'.repeat(1000) }, undefined).content).toHaveLength(
      1,
    )
  })
})
