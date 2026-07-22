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

describe('SolverSearch with honey', () => {
  it('finds a solution that costs more than the bee count (honey adds a tap)', () => {
    const board = new BoardState(
      makeLevel({
        honeyCells: [[0, 0]],
        bees: [
          { q: -2, r: 0, dir: E, kind: 'bee' }, // must stick then continue = 2 taps
          { q: 2, r: 0, dir: E, kind: 'bee' }, // escapes in 1, but blocks A's exit
        ],
      }),
    )
    // Optimal: escape the right bee, then stick + fly the left bee = 3 moves.
    expect(searchMinMoves(board, 12)).toBe(3)
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
