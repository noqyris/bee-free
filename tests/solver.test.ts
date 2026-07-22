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
    const bees: SolverBee[] = [
      { q: -2, r: 0, dir: W },
      { q: 2, r: 0, dir: E },
    ]
    const m = analyzeBoard(bees, set, line.length)
    expect(m.solvable).toBe(true)
    expect(m.depDepth).toBe(0)
    expect(m.blockedAtStart).toBe(0)
    expect(m.freeAtStart).toBe(2)
    expect(m.minMoves).toBe(2)
  })

  it('measures a forced 3-bee chain as depth 2', () => {
    // All face E; each is blocked by the ones ahead → 0<1<2 forced ordering.
    const bees: SolverBee[] = [
      { q: -2, r: 0, dir: E },
      { q: -1, r: 0, dir: E },
      { q: 0, r: 0, dir: E },
    ]
    const m = analyzeBoard(bees, set, line.length)
    expect(m.solvable).toBe(true)
    expect(m.depDepth).toBe(2) // rightmost free, then next, then next
    expect(m.blockedAtStart).toBe(2)
    expect(m.freeAtStart).toBe(1)
  })

  it('nextSafeMove returns the unblocked bee', () => {
    const bees: SolverBee[] = [
      { q: -2, r: 0, dir: E },
      { q: 0, r: 0, dir: E },
    ]
    const move = nextSafeMove(bees, set)
    expect(move).toEqual({ q: 0, r: 0, dir: E }) // the front one is clear
  })
})

describe('LevelGenerator', () => {
  it('is deterministic for a fixed seed', () => {
    const req = {
      boardCells: shapeCells({ kind: 'hexagon', radius: 3 }),
      targetBees: 10,
      minDepth: 2,
      maxDepth: 4,
      rayBias: 2.2,
      seed: 12345,
      attempts: 200,
    }
    const a = generateLevel(req)
    const b = generateLevel(req)
    expect(a.bees).toEqual(b.bees)
  })

  it('always produces a solvable board with no overlapping bees', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const cells = shapeCells({ kind: 'hexagon', radius: 3 })
      const { bees, metrics } = generateLevel({
        boardCells: cells,
        targetBees: 12,
        minDepth: 2,
        maxDepth: 5,
        rayBias: 2.5,
        seed,
        attempts: 150,
      })
      expect(metrics.solvable).toBe(true)
      const keys = new Set(bees.map((b) => axialKey(b.q, b.r)))
      expect(keys.size).toBe(bees.length)
    }
  })
})
