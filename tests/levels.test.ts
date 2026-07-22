import { describe, expect, it } from 'vitest'
import { BoardState } from '../src/systems/BoardState'
import { HAND_LEVELS } from '../src/levels/handLevels'

/**
 * Bump-free BFS over remaining-bee subsets: returns the minimum number of
 * taps to clear the board, or null if unsolvable. This is the seed of the
 * M2 solver/validator.
 */
function minSolution(board: BoardState): number | null {
  const seen = new Set<string>([board.stateKey()])
  let frontier: BoardState[] = [board]
  let depth = 0
  while (frontier.length > 0) {
    const next: BoardState[] = []
    for (const state of frontier) {
      if (state.remaining === 0) return depth
      for (const occ of state.allOccupants()) {
        if (!occ.isTappable()) continue
        if (state.trace(occ).kind !== 'escaped') continue
        const child = state.clone()
        child.removeOccupant(occ.q, occ.r)
        const key = child.stateKey()
        if (seen.has(key)) continue
        seen.add(key)
        next.push(child)
      }
    }
    frontier = next
    depth++
  }
  return null
}

describe('hand-made M1 levels', () => {
  it('ships exactly 5 test levels with unique ids', () => {
    expect(HAND_LEVELS).toHaveLength(5)
    expect(new Set(HAND_LEVELS.map((l) => l.id)).size).toBe(5)
  })

  for (const level of HAND_LEVELS) {
    describe(`level ${level.id} (${level.name ?? 'unnamed'})`, () => {
      it('constructs a valid board', () => {
        expect(() => new BoardState(level)).not.toThrow()
      })

      it('is solvable, with minimum solution = bee count (no forced bumps)', () => {
        const min = minSolution(new BoardState(level))
        expect(min).toBe(level.bees.length)
      })

      it('has a sane budget: 3 stars achievable, but not a giveaway', () => {
        const min = level.bees.length
        // A perfect run must reach 3 stars…
        expect(level.moveBudget - min).toBeGreaterThanOrEqual(level.threeStarSpare)
        // …and the budget still allows at least one mistake (2-star space).
        expect(level.moveBudget).toBeGreaterThan(min)
        expect(level.threeStarSpare).toBeGreaterThan(0)
      })
    })
  }

  it('level 2 punishes the wrong order with a bump (core tension)', () => {
    const board = new BoardState(HAND_LEVELS[1])
    expect(board.tap(-1, 0)?.kind).toBe('blocked')
    expect(board.tap(1, 0)?.kind).toBe('escaped')
    expect(board.tap(-1, 0)?.kind).toBe('escaped')
    expect(board.status).toBe('won')
    expect(board.movesUsed).toBe(3)
  })
})
