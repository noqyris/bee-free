import { describe, expect, it } from 'vitest'
import { BoardState } from '../src/systems/BoardState'
import { nextSolvingMove } from '../src/systems/SolverSearch'
import type { LevelData } from '../src/types'
import { Direction } from '../src/types'

const { E, NE, W } = Direction

/** A single horizontal row of cells q=lo..hi at r=0. */
function line(lo: number, hi: number): Array<[number, number]> {
  const cells: Array<[number, number]> = []
  for (let q = lo; q <= hi; q++) cells.push([q, 0])
  return cells
}

/** A 3-row band, r = -1..1, q = lo..hi. */
function band(lo: number, hi: number): Array<[number, number]> {
  const cells: Array<[number, number]> = []
  for (let r = -1; r <= 1; r++) for (let q = lo; q <= hi; q++) cells.push([q, r])
  return cells
}

function makeLevel(o: Partial<LevelData>): LevelData {
  return { id: 901, cells: line(-3, 3), bees: [], moveBudget: 20, threeStarSpare: 0, ...o }
}

/**
 * The Honey Cleaner (tapClean) and the revive (grantExtraMoves) are PAID
 * features — bought with honey, IAP money, or a watched ad — so their rules
 * get first-class coverage here.
 */
describe('Honey Cleaner (tapClean)', () => {
  it('flies THROUGH honey, wipes the start cell and the whole path, and escapes', () => {
    // EAST smears row 0; a second bee behind it would normally stick.
    const board = new BoardState(
      makeLevel({
        cells: band(-3, 3),
        bees: [
          { q: -3, r: 0, dir: E, kind: 'bee' },
          { q: -1, r: 1, dir: NE, kind: 'bee' }, // first step lands on row 0 honey
        ],
      }),
    )
    board.tap(-3, 0) // row 0 is now permanent honey
    expect(board.isSticky(0, 0)).toBe(true)

    const outcome = board.tapClean(-1, 1)
    expect(outcome?.kind).toBe('escaped')
    // The start cell and every crossed cell got wiped clean.
    expect(board.isSticky(-1, 1)).toBe(false)
    expect(board.isSticky(0, 0)).toBe(false)
    expect(board.remaining).toBe(0)
  })

  it('blocked by a solid occupant: the bee stays put, but crossed honey is still wiped', () => {
    const board = new BoardState(
      makeLevel({
        cells: line(-3, 3),
        bees: [
          { q: -3, r: 0, dir: E, kind: 'bee' },
          { q: 2, r: 0, dir: W, kind: 'bee' },
        ],
        honeyCells: [
          [-1, 0],
          [0, 0],
        ],
      }),
    )
    const outcome = board.tapClean(-3, 0)
    expect(outcome?.kind).toBe('blocked')
    // Bee did not move (blocked), but the honey it flew over is gone —
    // a sealed lane reopened for the others.
    expect(board.occupantAt(-3, 0)).toBeDefined()
    expect(board.isSticky(-1, 0)).toBe(false)
    expect(board.isSticky(0, 0)).toBe(false)
    // The blocker keeps ITS start honey (never crossed).
    expect(board.isSticky(2, 0)).toBe(true)
  })

  it('consumes exactly one move, like any tap', () => {
    const board = new BoardState(
      makeLevel({ bees: [{ q: 0, r: 0, dir: E, kind: 'bee' }] }),
    )
    board.tapClean(0, 0)
    expect(board.movesUsed).toBe(1)
  })

  it('an escaping queen with workers left still loses, even flown clean', () => {
    const board = new BoardState(
      makeLevel({
        cells: band(-3, 3),
        bees: [
          { q: 0, r: 0, dir: E, kind: 'queen' },
          { q: -2, r: 1, dir: W, kind: 'bee' },
        ],
      }),
    )
    const outcome = board.tapClean(0, 0)
    expect(outcome?.kind).toBe('escaped')
    expect(board.queenLeftEarly).toBe(true)
    expect(board.status).toBe('lost')
  })

  it('returns undefined for empty cells and once the game is over', () => {
    const board = new BoardState(
      makeLevel({ bees: [{ q: 0, r: 0, dir: E, kind: 'bee' }], moveBudget: 1 }),
    )
    expect(board.tapClean(2, 0)).toBeUndefined() // empty cell
    board.tap(0, 0)
    expect(board.status).toBe('won')
    expect(board.tapClean(0, 0)).toBeUndefined() // game over
  })
})

describe('previewClean', () => {
  it('predicts exactly what tapClean will do, without mutating anything', () => {
    const board = new BoardState(
      makeLevel({
        cells: band(-3, 3),
        bees: [
          { q: -3, r: 0, dir: E, kind: 'bee' },
          { q: -1, r: 1, dir: NE, kind: 'bee' },
        ],
      }),
    )
    board.tap(-3, 0)
    const occ = board.occupantAt(-1, 1)!
    const honeyBefore = board.honey.size
    const movesBefore = board.movesUsed
    const preview = board.previewClean(occ)
    expect(board.honey.size).toBe(honeyBefore) // no mutation
    expect(board.movesUsed).toBe(movesBefore)
    const real = board.tapClean(-1, 1)
    expect(real?.kind).toBe(preview.kind) // escaped both times
  })
})

describe('revive (grantExtraMoves)', () => {
  it('lifts an out-of-moves loss back to playing', () => {
    const board = new BoardState(
      makeLevel({
        bees: [
          { q: -3, r: 0, dir: E, kind: 'bee' },
          { q: 2, r: 0, dir: W, kind: 'bee' },
        ],
        moveBudget: 1,
      }),
    )
    board.tap(-3, 0) // bump into the other bee — move burnt
    expect(board.status).toBe('lost')
    board.grantExtraMoves(3)
    expect(board.status).toBe('playing')
    expect(board.movesLeft).toBe(3)
  })

  it('can never lift a queen violation — that loss is permanent by design', () => {
    const board = new BoardState(
      makeLevel({
        cells: band(-3, 3),
        bees: [
          { q: 0, r: 0, dir: E, kind: 'queen' },
          { q: -2, r: 1, dir: W, kind: 'bee' },
        ],
      }),
    )
    board.tap(0, 0)
    expect(board.status).toBe('lost')
    board.grantExtraMoves(99)
    expect(board.status).toBe('lost')
  })

  it('ignores zero and negative grants', () => {
    const board = new BoardState(
      makeLevel({ bees: [{ q: 0, r: 0, dir: E, kind: 'bee' }], moveBudget: 5 }),
    )
    board.grantExtraMoves(0)
    board.grantExtraMoves(-4)
    expect(board.moveBudget).toBe(5)
  })

  it('undo keeps granted moves when the snapshot is topped up (scene contract)', () => {
    // Mirrors GameScene.doUndo: snapshot, grant, undo tops the snapshot up.
    const board = new BoardState(
      makeLevel({ bees: [{ q: 0, r: 0, dir: E, kind: 'bee' }], moveBudget: 2 }),
    )
    const snapshot = board.clone()
    board.grantExtraMoves(3)
    const gap = board.moveBudget - snapshot.moveBudget
    expect(gap).toBe(3)
    snapshot.grantExtraMoves(gap)
    expect(snapshot.moveBudget).toBe(board.moveBudget)
  })
})

describe('nextSolvingMove (hint) budget semantics', () => {
  it('finds a hint when the moves left exactly cover the goals', () => {
    const board = new BoardState(
      makeLevel({
        bees: [
          { q: -2, r: 0, dir: W, kind: 'bee' },
          { q: 2, r: 0, dir: E, kind: 'bee' },
        ],
        moveBudget: 2,
      }),
    )
    expect(nextSolvingMove(board, 2)).not.toBeNull()
  })

  it('refuses a hint that would overrun the budget: 2 goals, 1 move left', () => {
    const board = new BoardState(
      makeLevel({
        bees: [
          { q: -2, r: 0, dir: W, kind: 'bee' },
          { q: 2, r: 0, dir: E, kind: 'bee' },
        ],
        moveBudget: 1,
      }),
    )
    // The old off-by-one would have said "winnable" here and overrun by one.
    expect(nextSolvingMove(board, 1)).toBeNull()
  })
})
