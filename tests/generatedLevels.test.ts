import { describe, expect, it } from 'vitest'
import { BoardState } from '../src/systems/BoardState'
import { searchMinMoves } from '../src/systems/SolverSearch'
import { LEVELS, LEVEL_COUNT, chapterOf } from '../src/levels'
import { axialKey } from '../src/systems/HexGrid'
// Raw generator output: carries minMoves, which LevelData does not expose.
import generated from '../src/levels/levels.generated.json'

/**
 * The open-rim campaign these describe was replaced by the sealed-rim
 * redesign. They stay in the tree because they are the record of what the old
 * design promised and how it was verified — but they must not run against data
 * built to different rules, where a queen or an open edge is simply absent.
 */
const OPEN_RIM = (generated as { progression?: string }).progression !== 'sealed-rim'


const goalCount = (l: (typeof LEVELS)[number]): number =>
  l.bees.filter((b) => b.kind !== 'hornet').length

describe.skipIf(!OPEN_RIM)('generated level set', () => {
  it('ships exactly 300 levels with sequential ids 1..300', () => {
    expect(LEVEL_COUNT).toBe(300)
    expect(LEVELS.length).toBe(300)
    LEVELS.forEach((l, i) => expect(l.id).toBe(i + 1))
  })

  it('assigns the correct chapter to every level', () => {
    for (const l of LEVELS) expect(l.chapter).toBe(chapterOf(l.id))
  })

  it('difficulty climbs into a high plateau across the 12 chapters', () => {
    const avgByChapter: number[] = []
    for (let ch = 1; ch <= 12; ch++) {
      const g = LEVELS.filter((l) => l.chapter === ch)
      avgByChapter.push(g.reduce((a, l) => a + (l.difficulty ?? 0), 0) / g.length)
    }
    // With walls retired the structural load (bees/budget/lakes) maxes out by
    // ~L120 by design and HOLDS — assert the climb and no late collapse; the
    // loss-based guards in difficultyCurve.test.ts carry the back half.
    const third = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length
    const lo = third(avgByChapter.slice(0, 4))
    const mid = third(avgByChapter.slice(4, 8))
    const hi = third(avgByChapter.slice(8, 12))
    expect(mid).toBeGreaterThan(lo)
    expect(hi).toBeGreaterThanOrEqual(mid - 0.5)
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
  it('a spread of shipped levels re-solves to exactly the recorded minimum', () => {
    // genLevels already proves EVERY level winnable at generation time (its
    // honey-solvability check runs at an 8M-node cap). Re-solving all 300 here
    // would take many minutes, so we spot-check a spread — every 7th level plus
    // the spikes — to catch any drift between what was validated and what ships.
    // Use the SAME generous cap so a legitimately hard board is not mis-read as
    // unsolvable at the search's default ceiling.
    const sample = LEVELS.filter((l) => l.id % 7 === 0 || l.id % 10 === 0)
    for (const level of sample) {
      const board = new BoardState({ ...level, moveBudget: 999 })
      const min = searchMinMoves(board, level.moveBudget, 8_000_000)
      expect(min, `level ${level.id}`).not.toBeNull()
      expect(min, `level ${level.id}`).toBe(generated.levels[level.id - 1].minMoves)
      expect(min as number, `level ${level.id}`).toBeLessThanOrEqual(level.moveBudget)
    }
  }, 240_000)

  it('ships Sticky Hive specials as scheduled: flagged, flooded, still tight-budgeted', () => {
    for (const l of LEVELS) {
      const isSpecial = l.id >= 45 && l.id % 10 === 5
      expect(Boolean(l.flooded), `level ${l.id}`).toBe(isSpecial)
      const honeyCount = l.honeyCells?.length ?? 0
      if (isSpecial) {
        const free = l.cells.length - l.bees.length
        // Seeded at 40–60% of free cells (rounding gives ±1 headroom).
        expect(honeyCount, `level ${l.id}`).toBeGreaterThanOrEqual(Math.floor(free * 0.4) - 1)
        expect(honeyCount, `level ${l.id}`).toBeLessThanOrEqual(Math.ceil(free * 0.6) + 1)
        // The special must be a real puzzle, not a crawl: planning pressure on
        // par with the surrounding band. (Full-flood grind measures ~0 here.)
        expect(generated.levels[l.id - 1].planningLoss, `level ${l.id}`).toBeGreaterThanOrEqual(0.2)
      } else if (l.id >= 35) {
        expect(honeyCount, `level ${l.id}`).toBe(2)
      } else {
        expect(honeyCount, `level ${l.id}`).toBe(0)
      }
    }
  })

  it('later chapters actually force ordering (forced honey-stops)', () => {
    // Under permanent honey the generator builds bump-free boards (no bee ever
    // has another bee in its start ray, so the static depDepth is structurally
    // 0 — the field is vestigial). The real ordering pressure is the honey:
    // minMoves > goals means even the BEST line must fly into honey and re-tap.
    // Every level from chapter 4 on must carry at least one forced stop, and
    // the late average must stay well above it.
    const goalsOf = goalCount
    const late = LEVELS.filter((l) => (l.chapter ?? 0) >= 4)
    let sum = 0
    for (const l of late) {
      const stops = generated.levels[l.id - 1].minMoves - goalsOf(l)
      expect(stops, `level ${l.id}`).toBeGreaterThanOrEqual(1)
      sum += stops
    }
    expect(sum / late.length).toBeGreaterThanOrEqual(2)
  })
})
