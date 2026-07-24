import { describe, expect, it } from 'vitest'
import { BoardState } from '../src/systems/BoardState'
import { searchMinMoves } from '../src/systems/SolverSearch'
import { LEVELS, LEVEL_COUNT, chapterOf } from '../src/levels'
import { axialKey } from '../src/systems/HexGrid'
// Raw generator output: carries minMoves, which LevelData does not expose.
import generated from '../src/levels/levels.generated.json'

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

      it('lays a honey trail', () => {
        expect(level.dryMoves ?? 0).toBeGreaterThan(0)
      })

      it('has a coherent, non-degenerate budget', () => {
        // The budget is minMoves + slack. minMoves is NOT the goal count: on most
        // boards even the best line has to fly into its own honey once or twice,
        // and each stop costs an extra tap. So compare against minMoves.
        const minMoves = generated.levels[level.id - 1].minMoves
        const slack = level.moveBudget - minMoves
        expect(minMoves).toBeGreaterThanOrEqual(goalCount(level))
        expect(slack).toBeGreaterThanOrEqual(1)
        expect(slack).toBeLessThanOrEqual(4)
        expect(level.threeStarSpare).toBeGreaterThanOrEqual(0)
        expect(level.threeStarSpare).toBeLessThanOrEqual(slack)
      })

      it('has at least 2 goal occupants', () => {
        expect(goalCount(level)).toBeGreaterThanOrEqual(2)
      })

      it('holds at most one queen', () => {
        expect(level.bees.filter((b) => b.kind === 'queen').length).toBeLessThanOrEqual(1)
      })
    })
  }

  /**
   * The one that actually matters: with the trail in play a bump-free order is
   * no longer a proof of anything, because a legal-looking flight can glue a bee
   * into honey that a later bee needs. So every shipped level is re-solved from
   * scratch here, by the same search the generator used, and must come out at
   * the minMoves recorded in the JSON — no drift between what was validated and
   * what ships.
   */
  it('is beatable inside its move budget, at exactly the recorded minimum', () => {
    for (const level of LEVELS) {
      const board = new BoardState({ ...level, moveBudget: 999 })
      const min = searchMinMoves(board, level.moveBudget)
      expect(min, `level ${level.id}`).not.toBeNull()
      expect(min, `level ${level.id}`).toBe(generated.levels[level.id - 1].minMoves)
      expect(min as number, `level ${level.id}`).toBeLessThanOrEqual(level.moveBudget)
    }
  }, 300_000)

  it('later chapters actually force ordering (depth floor)', () => {
    // Chapters 4-6 should not contain trivially-orderless boards.
    const late = LEVELS.filter((l) => (l.chapter ?? 0) >= 4)
    const avgDepth = late.reduce((a, l) => a + (l.depDepth ?? 0), 0) / late.length
    expect(avgDepth).toBeGreaterThanOrEqual(3)
  })
})
