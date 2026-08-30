import { describe, expect, it } from 'vitest'

import { createReviewRatingsEngine } from './index.mts'
import type { ReviewRating } from './index.mts'

type Rating = ReviewRating<'topic'>

describe('createReviewRatingsEngine', () => {
  it('supports rating-only integrations without lifecycle bindings', async () => {
    const commits: string[] = []
    let ratings: Rating[] = []
    const engine = createReviewRatingsEngine({
      authorize: () => undefined,
      onPostCommit: ({ action }) => {
        commits.push(action)
      },
      policy: {
        canDelete: ({ ratings: current }) => current.length > 1,
        comparison: () => true,
        count: { maximum: 3, minimum: 1 },
        isTargetEligible: () => true,
        rating: { maximum: 5, minimum: 1 },
        targetTypes: ['topic'],
      },
      repository: {
        addRating: async (_reviewId, input) => {
          ratings = [...ratings, input]
          return input
        },
        deleteRating: async (_reviewId, target) => {
          const existing = ratings.find(
            (rating) => rating.target.type === target.type && rating.target.id === target.id,
          )
          if (existing === undefined) return null
          ratings = ratings.filter((rating) => rating !== existing)
          return existing
        },
        listRatings: async () => ratings,
        lockReview: async () => true,
        transaction: async (work) => await work(undefined),
        updateRating: async (_reviewId, input) => {
          const index = ratings.findIndex(
            (rating) =>
              rating.target.type === input.target.type && rating.target.id === input.target.id,
          )
          if (index === -1) return null
          const updated = { ...ratings[index]!, ...input.changes }
          ratings = ratings.with(index, updated)
          return updated
        },
      },
    })
    const rating: Rating = {
      order: 0,
      rating: 4,
      target: { id: 'topic-1', type: 'topic' },
    }

    await expect(engine.addRating('alice', 'review-1', rating)).resolves.toEqual(rating)
    await expect(engine.listRatings('alice', 'review-1')).resolves.toEqual([rating])
    expect(commits).toEqual(['add-rating'])
  })
})
