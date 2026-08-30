import type { VoteChoiceCodec, VoteScore } from './types.mts'

export function createVoteChoiceCodec<TChoice extends string>(
  scores: Readonly<Record<TChoice, VoteScore>>,
): VoteChoiceCodec<TChoice> {
  const copiedScores = { ...scores }
  const choices = Object.keys(copiedScores) as TChoice[]
  if (choices.length === 0) throw new Error('Vote choice codec requires at least one choice')
  for (const choice of choices) assertVoteScore(copiedScores[choice])
  return { choices: Object.freeze(choices), scoreForChoice: (choice) => copiedScores[choice] }
}

export function isVoteChoice<TChoice extends string>(
  codec: VoteChoiceCodec<TChoice>,
  value: unknown,
): value is TChoice {
  return typeof value === 'string' && codec.choices.includes(value as TChoice)
}

export function assertVoteScore(score: VoteScore): void {
  if (score !== null && (!Number.isInteger(score) || score < -32_768 || score > 32_767)) {
    throw new Error('Vote score must be a PostgreSQL smallint or null')
  }
}
