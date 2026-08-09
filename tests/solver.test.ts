import { describe, expect, it } from 'vitest'
import { analyzeBoard, nextBumpFreeMove, type SolverBee } from '../src/systems/Solver'
import { generateLevel } from '../src/systems/LevelGenerator'
import {
  estimateMinMoves,
  plannerLossRate,
  searchMinMoves,
  smartGreedyLossRate,
} from '../src/systems/SolverSearch'
import { LEVELS } from '../src/levels'
import { BoardState } from '../src/systems/BoardState'
import { shapeCells } from '../src/systems/boardShapes'
import { axialKey } from '../src/systems/HexGrid'
import { Direction } from '../src/types'

const { E, W } = Direction

function boardSetOf(cells: ReadonlyArray<readonly [number, number]>): Set<string> {
  return new Set(cells.map(([q, r]) => axialKey(q, r)))
}

describe('estimateMinMoves (hop-aware IDA* heuristic)', () => {
  const row = (n: number): Array<[number, number]> =>
    Array.from({ length: n }, (_, q) => [q, 0] as [number, number])

  const board = (honey: Array<[number, number]>, budget = 99): BoardState =>
    new BoardState({
      id: 0,
      cells: row(5),
      honeyCells: honey,
      bees: [{ q: 0, r: 0, dir: Direction.E, kind: 'bee' }],
      moveBudget: budget,
      threeStarSpare: 0,
    })

  it('is one tap per goal on a clean ray', () => {
    const b = board([])
    expect(estimateMinMoves(b)).toBe(1)
    expect(searchMinMoves(b, 10)).toBe(1)
  })

  it('adds one landing per honeyed cell on the exit ray — and matches the real minimum', () => {
    const b = board([
      [2, 0],
      [4, 0],
    ])
    // 1 exit + 2 forced landings.
    expect(estimateMinMoves(b)).toBe(3)
    expect(searchMinMoves(b, 10)).toBe(3)
  })

  it('stays a lower bound on a flooded multi-bee board (admissibility)', () => {
    const cells = shapeCells({ kind: 'hexagon', radius: 2 })
    const bees = [
      { q: 0, r: 0, dir: Direction.E, kind: 'bee' as const },
      { q: -1, r: 1, dir: Direction.W, kind: 'bee' as const },
      { q: 1, r: -1, dir: Direction.NE, kind: 'bee' as const },
    ]
    const occ = new Set(bees.map((b) => axialKey(b.q, b.r)))
    const flooded = cells.filter(([q, r]) => !occ.has(axialKey(q, r))) as Array<[number, number]>
    const b = new BoardState({
      id: 0,
      cells: cells as Array<[number, number]>,
      honeyCells: flooded,
      bees,
      moveBudget: 99,
      threeStarSpare: 0,
    })
    const est = estimateMinMoves(b)
    const real = searchMinMoves(b, 40, 2_000_000)
    expect(real).not.toBeNull()
    expect(est).toBeLessThanOrEqual(real as number)
    // And it is a USEFUL bound: far above the bare goal count on flooded boards.
    expect(est).toBeGreaterThan(3)
  })
})

describe('plannerLossRate (previewing-human proxy)', () => {
  it('never loses a level a single bee can trivially clear', () => {
    const b = new BoardState({
      id: 0,
      cells: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      bees: [{ q: 0, r: 0, dir: Direction.E, kind: 'bee' }],
      moveBudget: 1,
      threeStarSpare: 0,
    })
    expect(plannerLossRate(b, 20, 7)).toBe(0)
  })

  it('is at least as strong as the greedy bot on a shipped level', () => {
    // The planner sees one ply ahead with full landing information; the greedy
    // bot sees nothing. Sampling noise allows a small margin, never a reversal.
    const level = LEVELS[39] // L40
    const greedy = smartGreedyLossRate(new BoardState(level), 40, 123)
    const planner = plannerLossRate(new BoardState(level), 40, 123)
    expect(planner).toBeLessThanOrEqual(greedy + 0.1)
  })
})

describe('Solver.analyzeBoard', () => {
  const line = shapeCells({ kind: 'rhombus', w: 5, h: 1 }) // q in -2..2, r=0
  const set = boardSetOf(line)

  it('counts a clear board as all-free, depth 0', () => {
    const occ: SolverBee[] = [
      { q: -2, r: 0, dir: W, kind: 'bee' },
      { q: 2, r: 0, dir: E, kind: 'bee' },
    ]
    const m = analyzeBoard(occ, set, line.length)
    expect(m.solvable).toBe(true)
    expect(m.depDepth).toBe(0)
    expect(m.blockedAtStart).toBe(0)
    expect(m.freeAtStart).toBe(2)
    expect(m.minMoves).toBe(2)
  })

  it('measures a forced 3-bee chain as depth 2', () => {
    const occ: SolverBee[] = [
      { q: -2, r: 0, dir: E, kind: 'bee' },
      { q: -1, r: 0, dir: E, kind: 'bee' },
      { q: 0, r: 0, dir: E, kind: 'bee' },
    ]
    const m = analyzeBoard(occ, set, line.length)
    expect(m.solvable).toBe(true)
    expect(m.depDepth).toBe(2)
    expect(m.blockedAtStart).toBe(2)
    expect(m.freeAtStart).toBe(1)
  })

  it('nextBumpFreeMove returns the unblocked bee', () => {
    const occ: SolverBee[] = [
      { q: -2, r: 0, dir: E, kind: 'bee' },
      { q: 0, r: 0, dir: E, kind: 'bee' },
    ]
    const move = nextBumpFreeMove(occ, set)
    expect(move).toEqual({ q: 0, r: 0, dir: E, kind: 'bee' })
  })
})

describe('Solver — obstacles', () => {
  const line = shapeCells({ kind: 'rhombus', w: 5, h: 1 })
  const set = boardSetOf(line)

  it('treats a hornet as a permanent blocker and not a goal', () => {
    // bee at -2 faces E into a hornet at 0 → can never escape → unsolvable.
    const occ: SolverBee[] = [
      { q: -2, r: 0, dir: E, kind: 'bee' },
      { q: 0, r: 0, dir: 0, kind: 'hornet' },
    ]
    const m = analyzeBoard(occ, set, line.length)
    expect(m.hornets).toBe(1)
    expect(m.beeCount).toBe(1) // hornet is not a goal
    expect(m.solvable).toBe(false)
  })

  it('a bee that clears the board past no hornet is solvable; goal excludes hornet', () => {
    const occ: SolverBee[] = [
      { q: -2, r: 0, dir: W, kind: 'bee' }, // exits left, away from hornet
      { q: 0, r: 0, dir: 0, kind: 'hornet' },
    ]
    const m = analyzeBoard(occ, set, line.length)
    expect(m.solvable).toBe(true)
    expect(m.beeCount).toBe(1)
  })

  it('enforces queen-last: solvable only if the queen can go last', () => {
    // queen at 0 faces E (would exit right); bee at -1 faces E blocked by queen.
    // The bee can never escape before the queen leaves, but the queen must be
    // last → unsolvable.
    const occ: SolverBee[] = [
      { q: 0, r: 0, dir: E, kind: 'queen' },
      { q: -1, r: 0, dir: E, kind: 'bee' },
    ]
    const m = analyzeBoard(occ, set, line.length)
    expect(m.hasQueen).toBe(true)
    expect(m.solvable).toBe(false)
  })

  it('queen blocking nobody is solvable, queen escapes last', () => {
    const occ: SolverBee[] = [
      { q: 0, r: 0, dir: W, kind: 'queen' }, // exits left
      { q: 1, r: 0, dir: E, kind: 'bee' }, // exits right, independent
    ]
    const m = analyzeBoard(occ, set, line.length)
    expect(m.solvable).toBe(true)
    // Only the bee is a bump-free first move; the queen must wait.
    expect(nextBumpFreeMove(occ, set)).toEqual({ q: 1, r: 0, dir: E, kind: 'bee' })
  })
})

describe('LevelGenerator', () => {
  // Under permanent honey the solvability search grows fast with bee count, so
  // these tests use the practical ceiling (8) and a modest seed spread, and carry
  // generous timeouts — one 8-bee generation is now real work, not microseconds.
  const baseReq = {
    boardCells: shapeCells({ kind: 'hexagon', radius: 3 }),
    targetBees: 8,
    minDepth: 2,
    maxDepth: 4,
    rayBias: 2.5,
    hornets: 0,
    hasQueen: false,
    slack: 2,
    planningFloor: 0,
    planningTarget: 0.08,
    maxForcedStops: 5,
    honeyLakes: 0,
    restarts: 44,
  }

  it('is deterministic for a fixed seed', () => {
    const req = { ...baseReq, seed: 12345, attempts: 200 }
    expect(generateLevel(req).occupants).toEqual(generateLevel(req).occupants)
  }, 60_000)

  it('derives min moves from a real search of the trail, never from the bee count', () => {
    const { minMoves, occupants } = generateLevel({
      ...baseReq,
      targetBees: 7,
      seed: 42,
      attempts: 150,
    })
    const keys = new Set(occupants.map((o) => axialKey(o.q, o.r)))
    expect(keys.size).toBe(occupants.length)
    // One tap per bee is the floor; forced honey-stops only ever add to it.
    expect(minMoves).toBeGreaterThanOrEqual(occupants.length)
  }, 60_000)

  it('always produces a solvable board with no overlapping occupants', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { occupants, metrics } = generateLevel({ ...baseReq, seed, attempts: 150 })
      expect(metrics.solvable).toBe(true)
      const keys = new Set(occupants.map((o) => axialKey(o.q, o.r)))
      expect(keys.size).toBe(occupants.length)
    }
  }, 120_000)

  it('produces solvable boards with a queen and hornets', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { occupants, metrics } = generateLevel({
        ...baseReq,
        hornets: 2,
        hasQueen: true,
        seed,
        attempts: 250,
      })
      expect(metrics.solvable).toBe(true)
      expect(metrics.hasQueen).toBe(true)
      expect(occupants.filter((o) => o.kind === 'queen').length).toBe(1)
      expect(occupants.filter((o) => o.kind === 'hornet').length).toBe(2)
    }
  }, 120_000)
})
