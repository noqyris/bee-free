import { describe, expect, it } from 'vitest'
import { BoardState } from '../src/systems/BoardState'
import { Direction } from '../src/types'

/**
 * Compass-mode engine rules: colored gates on the rim + free in-place rotation.
 * The rest of the model (honey, stuck-collect, queen-last, budget) is shared
 * with the campaign and covered by the existing suites.
 */

// A 3-cell east-west corridor: (0,0) (1,0) (2,0). One red bee (color 0) at the
// west end, facing east. The only gate sits at the east rim.
const corridor = (gates: Array<[number, number, number, number]>, color = 0): BoardState =>
  new BoardState({
    id: 0,
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    bees: [{ q: 0, r: 0, dir: Direction.E, kind: 'bee', color }],
    moveBudget: 9,
    threeStarSpare: 0,
    compass: true,
    gates,
  })

describe('Compass mode — gates', () => {
  it('lets a bee escape through its own color gate', () => {
    const b = corridor([[2, 0, Direction.E, 0]])
    const out = b.tap(0, 0)
    expect(out?.kind).toBe('escaped')
    expect(b.status).toBe('won')
  })

  it('bounces a bee off a wrong-colored gate, spending the move', () => {
    const b = corridor([[2, 0, Direction.E, 1]]) // blue gate, red bee
    const out = b.tap(0, 0)
    expect(out?.kind).toBe('blocked')
    expect(b.movesUsed).toBe(1)
    expect(b.allOccupants().length).toBe(1)
  })

  it('treats an un-gated rim as a wall in compass mode', () => {
    const b = corridor([]) // no gates at all
    expect(b.tap(0, 0)?.kind).toBe('blocked')
  })

  it('does not gate campaign levels (no compass flag)', () => {
    const b = new BoardState({
      id: 0,
      cells: [
        [0, 0],
        [1, 0],
      ],
      bees: [{ q: 0, r: 0, dir: Direction.E, kind: 'bee' }],
      moveBudget: 3,
      threeStarSpare: 0,
      gates: [[1, 0, Direction.E, 3]], // present but inert without compass
    })
    expect(b.tap(0, 0)?.kind).toBe('escaped')
  })
})

describe('Compass mode — rotation', () => {
  it('rotates a bee 60° CCW per call, free of move cost, and survives clone', () => {
    const b = corridor([[2, 0, Direction.E, 0]])
    expect(b.rotate(0, 0)).toBe(Direction.NE)
    expect(b.rotate(0, 0)).toBe(Direction.NW)
    expect(b.movesUsed).toBe(0)
    const c = b.clone()
    expect(c.allOccupants()[0].dir).toBe(Direction.NW)
    // Four more steps come back around to East; the flight then wins as normal.
    for (let i = 0; i < 4; i++) b.rotate(0, 0)
    expect(b.tap(0, 0)?.kind).toBe('escaped')
  })

  it('refuses to rotate outside compass mode', () => {
    const b = new BoardState({
      id: 0,
      cells: [[0, 0]],
      bees: [{ q: 0, r: 0, dir: Direction.E, kind: 'bee' }],
      moveBudget: 3,
      threeStarSpare: 0,
    })
    expect(b.rotate(0, 0)).toBeUndefined()
    expect(b.allOccupants()[0].dir).toBe(Direction.E)
  })

  it('keeps rotation out of the state key only via dir (memo stays correct)', () => {
    const b = corridor([[2, 0, Direction.E, 0]])
    const before = b.stateKey()
    b.rotate(0, 0)
    expect(b.stateKey()).not.toBe(before)
  })
})

describe('Compass mode — solver', () => {
  it('finds the rotation-aware minimum and the planner bot clears a trivial board', async () => {
    const { searchCompassMinMoves, compassPlannerLossRate } = await import(
      '../src/systems/SolverSearch'
    )
    // Bee aimed WRONG (west) with its gate east: classic search would call it
    // blocked; the compass search rotates and wins in one launch.
    const b = new BoardState({
      id: 0,
      cells: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      bees: [{ q: 0, r: 0, dir: Direction.W, kind: 'bee', color: 2 }],
      moveBudget: 3,
      threeStarSpare: 0,
      compass: true,
      gates: [[2, 0, Direction.E, 2]],
    })
    expect(searchCompassMinMoves(b, 5)).toBe(1)
    expect(compassPlannerLossRate(b, 20, 9)).toBe(0)
  })
})
