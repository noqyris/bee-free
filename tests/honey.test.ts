import { describe, expect, it } from 'vitest'
import { BoardState } from '../src/systems/BoardState'
import { searchMinMoves } from '../src/systems/SolverSearch'
import type { LevelData } from '../src/types'
import { Direction } from '../src/types'

const { E, W } = Direction

/** A single horizontal row of cells q=lo..hi at r=0. */
function line(lo: number, hi: number): Array<[number, number]> {
  const cells: Array<[number, number]> = []
  for (let q = lo; q <= hi; q++) cells.push([q, 0])
  return cells
}

function makeLevel(o: Partial<LevelData>): LevelData {
  return { id: 900, cells: line(-2, 2), bees: [], moveBudget: 20, threeStarSpare: 1, ...o }
}

describe('honey cells', () => {
  it('catches a bee flying through: it gets stuck, still a goal, one move spent', () => {
    const board = new BoardState(
      makeLevel({ honeyCells: [[0, 0]], bees: [{ q: -2, r: 0, dir: E, kind: 'bee' }] }),
    )
    const outcome = board.tap(-2, 0)
    expect(outcome?.kind).toBe('stuck')
    if (outcome?.kind === 'stuck') expect(outcome.at).toEqual({ q: 0, r: 0 })
    expect(board.movesUsed).toBe(1)
    expect(board.remaining).toBe(1) // still on the board
    expect(board.occupantAt(0, 0)?.kind).toBe('bee') // relocated onto the honey
    expect(board.occupantAt(-2, 0)).toBeUndefined()
    expect(board.status).toBe('playing')
  })

  it('a second tap flies the stuck bee off the honey to escape (2 taps total)', () => {
    const board = new BoardState(
      makeLevel({ honeyCells: [[0, 0]], bees: [{ q: -2, r: 0, dir: E, kind: 'bee' }] }),
    )
    board.tap(-2, 0) // stuck at (0,0)
    const out = board.tap(0, 0) // flies off honey, onward East to the edge
    expect(out?.kind).toBe('escaped')
    expect(board.status).toBe('won')
    expect(board.movesUsed).toBe(2)
  })

  it('a bee starting on a honey cell is not re-caught by it', () => {
    const board = new BoardState(
      makeLevel({ honeyCells: [[0, 0]], bees: [{ q: 0, r: 0, dir: E, kind: 'bee' }] }),
    )
    expect(board.tap(0, 0)?.kind).toBe('escaped')
    expect(board.status).toBe('won')
  })

  it('an occupied honey cell blocks (bump), it does not stick', () => {
    const board = new BoardState(
      makeLevel({
        honeyCells: [[0, 0]],
        bees: [
          { q: -2, r: 0, dir: E, kind: 'bee' },
          { q: 0, r: 0, dir: E, kind: 'bee' }, // sits on the honey → a blocker
        ],
      }),
    )
    expect(board.tap(-2, 0)?.kind).toBe('blocked')
  })
})

describe('honey COLLECTION (landing soaks up the cell)', () => {
  it('landing in honey removes that cell and banks +1 collected', () => {
    const board = new BoardState(
      makeLevel({ honeyCells: [[0, 0]], bees: [{ q: -2, r: 0, dir: E, kind: 'bee' }] }),
    )
    expect(board.isSticky(0, 0)).toBe(true)
    board.tap(-2, 0) // stuck at (0,0)
    expect(board.isSticky(0, 0)).toBe(false) // soaked up
    expect(board.collectedHoney).toBe(1)
  })

  it('the collected cell STAYS clean after the bee flies onward', () => {
    const board = new BoardState(
      makeLevel({ honeyCells: [[0, 0]], bees: [{ q: -2, r: 0, dir: E, kind: 'bee' }] }),
    )
    board.tap(-2, 0) // stuck + collect at (0,0)
    board.tap(0, 0) // flies off east
    expect(board.status).toBe('won')
    expect(board.isSticky(0, 0)).toBe(false) // reopened for anyone else
  })

  it('a deliberate landing reopens a sealed lane for a later bee', () => {
    // EAST smears row -2..2; CROSS would stick in it. CROSS lands (collects the
    // crossing cell), flies onward — and the cell it ate stays clean.
    const board = new BoardState(
      makeLevel({
        cells: (() => {
          const cells: Array<[number, number]> = []
          for (let r = -1; r <= 1; r++) for (let q = -2; q <= 2; q++) cells.push([q, r])
          return cells
        })(),
        bees: [
          { q: -2, r: 0, dir: E, kind: 'bee' },
          { q: -1, r: 1, dir: Direction.NE, kind: 'bee' },
        ],
      }),
    )
    board.tap(-2, 0) // escapes east, smears row 0
    board.tap(-1, 1) // sticks at (0,0), collects it
    expect(board.collectedHoney).toBe(1)
    expect(board.isSticky(0, 0)).toBe(false)
  })

  it('clone preserves the collected count (undo cannot mint or lose honey)', () => {
    const board = new BoardState(
      makeLevel({ honeyCells: [[0, 0]], bees: [{ q: -2, r: 0, dir: E, kind: 'bee' }] }),
    )
    board.tap(-2, 0)
    const snap = board.clone()
    expect(snap.collectedHoney).toBe(1)
  })
})

describe('SolverSearch with honey', () => {
  it('finds a solution that costs more than the bee count (honey adds taps)', () => {
    const board = new BoardState(
      makeLevel({
        honeyCells: [[0, 0]],
        bees: [
          { q: -2, r: 0, dir: E, kind: 'bee' }, // A
          { q: 2, r: 0, dir: E, kind: 'bee' }, // B
        ],
      }),
    )
    // Under PERMANENT honey-under-bees, B's start cell (2,0) is honey too. So even
    // after B escapes, A flying East sticks first at the middle honey (0,0) and
    // AGAIN at B's vacated (2,0) — two forced stops. Escape B, then A: stick(0,0) →
    // re-fly stick(2,0) → re-fly out = 4 moves.
    expect(searchMinMoves(board, 12)).toBe(4)
  })

  it('detects an unsolvable board where two bees deadlock through the honey', () => {
    // Line of 3, honey in the middle. A must exit East through the middle, B must
    // exit West through the middle; each ends up blocking the other. No order works.
    const board = new BoardState(
      makeLevel({
        cells: line(-1, 1),
        honeyCells: [[0, 0]],
        bees: [
          { q: -1, r: 0, dir: E, kind: 'bee' },
          { q: 1, r: 0, dir: W, kind: 'bee' },
        ],
      }),
    )
    expect(searchMinMoves(board, 12)).toBeNull()
  })

  it('agrees with a hand-played solution', () => {
    const level = makeLevel({
      honeyCells: [[0, 0]],
      bees: [{ q: -2, r: 0, dir: E, kind: 'bee' }],
    })
    expect(searchMinMoves(new BoardState(level), 12)).toBe(2)
    const board = new BoardState(level)
    board.tap(-2, 0)
    board.tap(0, 0)
    expect(board.status).toBe('won')
    expect(board.movesUsed).toBe(2)
  })
})
