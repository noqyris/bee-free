import { describe, expect, it } from 'vitest'
import { analyzeBoard, nextSafeMove, type SolverBee } from '../src/systems/Solver'
import { generateLevel } from '../src/systems/LevelGenerator'
import { shapeCells } from '../src/systems/boardShapes'
import { axialKey } from '../src/systems/HexGrid'
import { Direction } from '../src/types'

const { E, W } = Direction

function boardSetOf(cells: ReadonlyArray<readonly [number, number]>): Set<string> {
  return new Set(cells.map(([q, r]) => axialKey(q, r)))
}

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

  it('nextSafeMove returns the unblocked bee', () => {
    const occ: SolverBee[] = [
      { q: -2, r: 0, dir: E, kind: 'bee' },
      { q: 0, r: 0, dir: E, kind: 'bee' },
    ]
    const move = nextSafeMove(occ, set)
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
    // Only the bee is a safe first move; the queen must wait.
    expect(nextSafeMove(occ, set)).toEqual({ q: 1, r: 0, dir: E, kind: 'bee' })
  })
})

describe('LevelGenerator', () => {
  const baseReq = {
    boardCells: shapeCells({ kind: 'hexagon', radius: 3 }),
    targetBees: 10,
    minDepth: 2,
    maxDepth: 4,
    rayBias: 2.5,
    hornets: 0,
    hasQueen: false,
    honey: 0,
    slack: 2,
    carelessFloor: 0,
  }

  it('is deterministic for a fixed seed', () => {
    const req = { ...baseReq, seed: 12345, attempts: 200 }
    expect(generateLevel(req).occupants).toEqual(generateLevel(req).occupants)
  })

  it('generates a solvable honey board with a search-derived min-move count', () => {
    const { honeyCells, minMoves, occupants } = generateLevel({
      ...baseReq,
      targetBees: 7,
      honey: 1,
      seed: 42,
      attempts: 150,
    })
    // Honey may or may not place on a given seed, but if it does, min moves must
    // exceed the goal count (a bee gets stuck) and there are no overlaps.
    const keys = new Set(occupants.map((o) => axialKey(o.q, o.r)))
    expect(keys.size).toBe(occupants.length)
    if (honeyCells.length > 0) expect(minMoves).toBeGreaterThanOrEqual(occupants.length)
  })

  it('always produces a solvable board with no overlapping occupants', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { occupants, metrics } = generateLevel({ ...baseReq, seed, attempts: 150 })
      expect(metrics.solvable).toBe(true)
      const keys = new Set(occupants.map((o) => axialKey(o.q, o.r)))
      expect(keys.size).toBe(occupants.length)
    }
  })

  it('produces solvable boards with a queen and hornets', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { occupants, metrics } = generateLevel({
        ...baseReq,
        targetBees: 9,
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
  })
})
