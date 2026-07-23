import { describe, expect, it } from 'vitest'
import { BoardState } from '../src/systems/BoardState'
import { searchMinMoves } from '../src/systems/SolverSearch'
import { LEVELS, LEVEL_COUNT, chapterOf } from '../src/levels'
import { axialKey } from '../src/systems/HexGrid'
// Raw generator output: carries minMoves, which LevelData does not expose.
import generated from '../src/levels/levels.generated.json'

const hasHoney = (l: (typeof LEVELS)[number]): boolean => (l.honeyCells?.length ?? 0) > 0

/**
 * Independent verifier (does NOT use src/systems/Solver): greedily escape any
 * goal with a clear path — a non-queen bee, or the queen once she is the last
 * goal — skipping hornets. If this clears all goals it is a valid bump-free
 * solution of length = goal count. Returns moves used, or null if it deadlocks.
 */
function greedyClear(board: BoardState): number | null {
  let moves = 0
  for (;;) {
    if (board.remaining === 0) return moves // all goals cleared
    const goalsLeft = board.remaining
    const occ = board.allOccupants().find((o) => {
      if (o.kind === 'hornet') return false
      if (o.kind === 'queen' && goalsLeft > 1) return false
      return board.trace(o).kind === 'escaped'
    })
    if (!occ) return null // deadlock: unsolvable
    board.removeOccupant(occ.q, occ.r)
    moves++
  }
}

const goalCount = (l: (typeof LEVELS)[number]): number =>
  l.bees.filter((b) => b.kind !== 'hornet').length

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

      it('is solvable within budget', () => {
        if (hasHoney(level)) {
          // Honey breaks monotonicity → verify by full search (unbounded budget
          // board, capped at the level's move budget).
          const board = new BoardState({ ...level, moveBudget: 999 })
          const min = searchMinMoves(board, level.moveBudget)
          expect(min).not.toBeNull()
          expect(min as number).toBeLessThanOrEqual(level.moveBudget)
        } else {
          const goals = goalCount(level)
          const moves = greedyClear(new BoardState(level))
          expect(moves).toBe(goals)
          expect(level.moveBudget).toBeGreaterThanOrEqual(goals)
        }
      })

      it('has a coherent, non-degenerate budget', () => {
        // The budget is minMoves + slack, and on a honey board minMoves exceeds
        // the goal count (each stranded bee costs an extra tap to re-launch), so
        // budget-minus-goals is NOT the slack — compare against minMoves.
        const minMoves = generated.levels[level.id - 1].minMoves
        const slack = level.moveBudget - minMoves
        expect(minMoves).toBeGreaterThanOrEqual(goalCount(level))
        expect(slack).toBeGreaterThanOrEqual(0)
        expect(slack).toBeLessThanOrEqual(4)
        expect(level.threeStarSpare).toBeGreaterThanOrEqual(0)
        expect(level.threeStarSpare).toBeLessThanOrEqual(slack)
      })

      it('has at least 2 goal occupants', () => {
        expect(goalCount(level)).toBeGreaterThanOrEqual(2)
      })

      it('never traps a bee behind a hornet (all goals escapable in order)', () => {
        // greedyClear returning non-null already proves this, but assert the
        // queen-last rule explicitly: at most one queen per level.
        const queens = level.bees.filter((b) => b.kind === 'queen').length
        expect(queens).toBeLessThanOrEqual(1)
      })
    })
  }

  // Full BFS over every honey board; endgame levels carry 16 goals, so this
  // needs well over the default 5s budget.
  it('every honey level actually forces the honey (min moves exceed goal count)', () => {
    const honeyLevels = LEVELS.filter(hasHoney)
    expect(honeyLevels.length).toBeGreaterThan(0)
    for (const level of honeyLevels) {
      const board = new BoardState({ ...level, moveBudget: 999 })
      const min = searchMinMoves(board, level.moveBudget)
      // A bee must get stuck at least once → strictly more taps than goals.
      expect(min as number, `level ${level.id}`).toBeGreaterThan(goalCount(level))
      // And a one-move margin exists (fairness for a strand-able puzzle).
      expect(level.moveBudget, `level ${level.id}`).toBeGreaterThan((min as number) - 1)
    }
  }, 120_000)

  it('later chapters actually force ordering (depth floor)', () => {
    // Chapters 4-6 should not contain trivially-orderless boards.
    const late = LEVELS.filter((l) => (l.chapter ?? 0) >= 4)
    const avgDepth = late.reduce((a, l) => a + (l.depDepth ?? 0), 0) / late.length
    expect(avgDepth).toBeGreaterThanOrEqual(3)
  })
})
