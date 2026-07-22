import { describe, expect, it } from 'vitest'
import { BoardState } from '../src/systems/BoardState'
import { LEVELS, LEVEL_COUNT, chapterOf } from '../src/levels'
import { axialKey } from '../src/systems/HexGrid'

/**
 * Independent verifier (does NOT use src/systems/Solver): greedily escape any
 * bee with a clear path until none remain. For plain-bee boards, removing a bee
 * only unblocks others, so if this clears the board it is a valid bump-free
 * solution of length = beeCount. Returns moves used, or null if it deadlocks.
 */
function greedyClear(board: BoardState): number | null {
  let moves = 0
  for (;;) {
    if (board.remaining === 0) return moves
    const occ = board.allOccupants().find((o) => board.trace(o).kind === 'escaped')
    if (!occ) return null // deadlock: unsolvable
    board.removeOccupant(occ.q, occ.r)
    moves++
  }
}

describe('generated level set', () => {
  it('ships exactly 150 levels with sequential ids 1..150', () => {
    expect(LEVEL_COUNT).toBe(150)
    LEVELS.forEach((l, i) => expect(l.id).toBe(i + 1))
  })

  it('assigns the correct chapter to every level', () => {
    for (const l of LEVELS) expect(l.chapter).toBe(chapterOf(l.id))
  })

  it('difficulty increases on average from chapter to chapter', () => {
    const avgByChapter: number[] = []
    for (let ch = 1; ch <= 6; ch++) {
      const g = LEVELS.filter((l) => l.chapter === ch)
      avgByChapter.push(g.reduce((a, l) => a + (l.difficulty ?? 0), 0) / g.length)
    }
    for (let i = 1; i < avgByChapter.length; i++) {
      expect(avgByChapter[i]).toBeGreaterThan(avgByChapter[i - 1])
    }
  })

  for (const level of LEVELS) {
    describe(`level ${level.id} (chapter ${level.chapter})`, () => {
      it('constructs a valid board (bees on cells, no overlaps)', () => {
        expect(() => new BoardState(level)).not.toThrow()
        const cellSet = new Set(level.cells.map(([q, r]) => axialKey(q, r)))
        const beeCells = new Set<string>()
        for (const b of level.bees) {
          const k = axialKey(b.q, b.r)
          expect(cellSet.has(k)).toBe(true)
          expect(beeCells.has(k)).toBe(false)
          beeCells.add(k)
        }
      })

      it('is solvable bump-free within budget (min moves = bee count)', () => {
        const moves = greedyClear(new BoardState(level))
        expect(moves).toBe(level.bees.length)
        expect(level.moveBudget).toBeGreaterThanOrEqual(level.bees.length)
      })

      it('has a coherent, non-degenerate budget', () => {
        const slack = level.moveBudget - level.bees.length
        expect(slack).toBeGreaterThanOrEqual(0)
        expect(slack).toBeLessThanOrEqual(12)
        expect(level.threeStarSpare).toBeGreaterThanOrEqual(0)
        expect(level.threeStarSpare).toBeLessThanOrEqual(slack)
      })

      it('has at least 2 bees', () => {
        expect(level.bees.length).toBeGreaterThanOrEqual(2)
      })
    })
  }

  it('later chapters actually force ordering (depth floor)', () => {
    // Chapters 4-6 should not contain trivially-orderless boards.
    const late = LEVELS.filter((l) => (l.chapter ?? 0) >= 4)
    const avgDepth = late.reduce((a, l) => a + (l.depDepth ?? 0), 0) / late.length
    expect(avgDepth).toBeGreaterThanOrEqual(3)
  })
})
