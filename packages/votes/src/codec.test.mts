import { describe, expect, it } from 'vitest'

import { assertVoteScore, createVoteChoiceCodec, isVoteChoice } from './codec.mts'

describe('vote choice codec', () => {
  it('copies and resolves validated choice scores', () => {
    const scores: Record<'up' | 'clear', number | null> = { up: 1, clear: null }
    const codec = createVoteChoiceCodec(scores)
    scores.up = 2
    expect(codec.choices).toEqual(['up', 'clear'])
    expect(codec.scoreForChoice('up')).toBe(1)
    expect(isVoteChoice(codec, 'clear')).toBe(true)
    expect(isVoteChoice(codec, 1)).toBe(false)
  })

  it.each([{}, { up: 1.5 }, { up: -32_769 }, { up: 32_768 }])(
    'rejects an invalid score map: %s',
    (scores) => {
      expect(() => createVoteChoiceCodec(scores as never)).toThrow()
    },
  )

  it('accepts the full PostgreSQL smallint range and null', () => {
    expect(() => assertVoteScore(-32_768)).not.toThrow()
    expect(() => assertVoteScore(32_767)).not.toThrow()
    expect(() => assertVoteScore(null)).not.toThrow()
  })
})
