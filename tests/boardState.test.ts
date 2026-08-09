import { describe, expect, it } from 'vitest'
import { BoardState } from '../src/systems/BoardState'
import { hexagonCells } from '../src/systems/HexGrid'
import type { LevelData } from '../src/types'
import { Direction } from '../src/types'

const { E, W, NE } = Direction

function makeLevel(overrides: Partial<LevelData>): LevelData {
  return {
    id: 999,
    cells: hexagonCells(1),
    bees: [],
    moveBudget: 5,
    threeStarSpare: 1,
    ...overrides,
  }
}

describe('BoardState', () => {
  it('escapes a bee with a clear path and consumes a move', () => {
    const board = new BoardState(
      makeLevel({ bees: [{ q: 0, r: 0, dir: E, kind: 'bee' }] }),
    )
    const outcome = board.tap(0, 0)
    expect(outcome?.kind).toBe('escaped')
    if (outcome?.kind === 'escaped') {
      expect(outcome.path).toEqual([{ q: 1, r: 0 }])
    }
    expect(board.movesUsed).toBe(1)
    expect(board.remaining).toBe(0)
    expect(board.status).toBe('won')
  })

  it('escapes immediately from an edge cell facing outward (empty path)', () => {
    const board = new BoardState(
      makeLevel({ bees: [{ q: 1, r: -1, dir: NE, kind: 'bee' }] }),
    )
    const outcome = board.tap(1, -1)
    expect(outcome?.kind).toBe('escaped')
    if (outcome?.kind === 'escaped') expect(outcome.path).toEqual([])
  })

  it('bumps into a blocker, keeps the bee, still consumes a move', () => {
    const board = new BoardState(
      makeLevel({
        bees: [
          { q: -1, r: 0, dir: E, kind: 'bee' },
          { q: 1, r: 0, dir: E, kind: 'bee' },
        ],
      }),
    )
    const outcome = board.tap(-1, 0)
    expect(outcome?.kind).toBe('blocked')
    if (outcome?.kind === 'blocked') {
      expect(outcome.path).toEqual([{ q: 0, r: 0 }])
      expect(outcome.blocker).toEqual({ q: 1, r: 0 })
    }
    expect(board.movesUsed).toBe(1)
    expect(board.remaining).toBe(2)
    expect(board.occupantAt(-1, 0)).toBeDefined()
  })

  it("the front bee's vacated cell is permanent honey, so the next bee sticks then re-flies", () => {
    const board = new BoardState(
      makeLevel({
        bees: [
          { q: -1, r: 0, dir: E, kind: 'bee' },
          { q: 1, r: 0, dir: E, kind: 'bee' },
        ],
      }),
    )
    expect(board.tap(1, 0)?.kind).toBe('escaped') // front bee out; its start (1,0) is now honey
    expect(board.tap(-1, 0)?.kind).toBe('stuck') // the next bee glues into that honey at (1,0)
    expect(board.tap(1, 0)?.kind).toBe('escaped') // re-fly it off the honey, out the edge
    expect(board.status).toBe('won')
  })

  it('winning on the exact last move counts as a win, not a loss', () => {
    const board = new BoardState(
      makeLevel({ moveBudget: 1, bees: [{ q: 0, r: 0, dir: E, kind: 'bee' }] }),
    )
    expect(board.tap(0, 0)?.kind).toBe('escaped')
    expect(board.status).toBe('won')
  })

  it('loses when the budget runs out with bees remaining', () => {
    const board = new BoardState(
      makeLevel({
        moveBudget: 1,
        bees: [
          { q: -1, r: 0, dir: E, kind: 'bee' },
          { q: 1, r: 0, dir: E, kind: 'bee' },
        ],
      }),
    )
    expect(board.tap(-1, 0)?.kind).toBe('blocked')
    expect(board.status).toBe('lost')
    expect(board.tap(1, 0)).toBeUndefined()
    expect(board.movesUsed).toBe(1)
  })

  it('ignores taps on empty cells and off-board cells without consuming moves', () => {
    const board = new BoardState(
      makeLevel({ bees: [{ q: 0, r: 0, dir: E, kind: 'bee' }] }),
    )
    expect(board.tap(1, 0)).toBeUndefined()
    expect(board.tap(9, 9)).toBeUndefined()
    expect(board.movesUsed).toBe(0)
  })

  it('rejects levels with bees off the board or stacked on one cell', () => {
    expect(
      () => new BoardState(makeLevel({ bees: [{ q: 5, r: 5, dir: E, kind: 'bee' }] })),
    ).toThrow()
    expect(
      () =>
        new BoardState(
          makeLevel({
            bees: [
              { q: 0, r: 0, dir: E, kind: 'bee' },
              { q: 0, r: 0, dir: W, kind: 'bee' },
            ],
          }),
        ),
    ).toThrow()
  })

  it('clone is independent of the original', () => {
    const board = new BoardState(
      makeLevel({
        bees: [
          { q: 0, r: 0, dir: E, kind: 'bee' },
          { q: -1, r: 0, dir: E, kind: 'bee' },
        ],
      }),
    )
    const copy = board.clone()
    copy.tap(0, 0)
    expect(copy.remaining).toBe(1)
    expect(copy.movesUsed).toBe(1)
    expect(board.remaining).toBe(2)
    expect(board.movesUsed).toBe(0)
    expect(board.stateKey()).not.toBe(copy.stateKey())
  })
})

describe('BoardState — obstacles', () => {
  it('loses immediately when the queen escapes with a bee still on the board', () => {
    const board = new BoardState(
      makeLevel({
        bees: [
          { q: 0, r: 0, dir: E, kind: 'queen' }, // clear path East → escapes
          { q: 0, r: 1, dir: W, kind: 'bee' }, // unrelated bee still present
        ],
      }),
    )
    const outcome = board.tap(0, 0)
    expect(outcome?.kind).toBe('escaped')
    expect(board.movesUsed).toBe(1)
    expect(board.status).toBe('lost')
    expect(board.queenLeftEarly).toBe(true)
  })

  it('wins when the queen is the last to leave', () => {
    const board = new BoardState(
      makeLevel({
        bees: [
          { q: 0, r: 0, dir: E, kind: 'queen' },
          { q: 1, r: -1, dir: NE, kind: 'bee' }, // edge cell, escapes NE
        ],
      }),
    )
    expect(board.tap(1, -1)?.kind).toBe('escaped') // clear the bee first
    expect(board.status).toBe('playing')
    expect(board.tap(0, 0)?.kind).toBe('escaped') // then the queen
    expect(board.status).toBe('won')
    expect(board.queenLeftEarly).toBe(false)
  })

  it('treats a hornet as an untappable permanent blocker excluded from the win', () => {
    const board = new BoardState(
      makeLevel({
        bees: [
          { q: -1, r: 0, dir: W, kind: 'bee' }, // escapes West
          { q: 1, r: 0, dir: E, kind: 'hornet' }, // stays forever
        ],
      }),
    )
    expect(board.remaining).toBe(1) // hornet is not a goal
    expect(board.tap(1, 0)).toBeUndefined() // hornet not tappable, no move spent
    expect(board.movesUsed).toBe(0)
    expect(board.tap(-1, 0)?.kind).toBe('escaped')
    expect(board.status).toBe('won') // won although the hornet remains
  })

  it('a bee bumps off a hornet blocking its path (still costs a move)', () => {
    const board = new BoardState(
      makeLevel({
        bees: [
          { q: -1, r: 0, dir: E, kind: 'bee' }, // flies East into the hornet
          { q: 1, r: 0, dir: E, kind: 'hornet' },
        ],
      }),
    )
    const outcome = board.tap(-1, 0)
    expect(outcome?.kind).toBe('blocked')
    expect(board.movesUsed).toBe(1)
    expect(board.remaining).toBe(1)
  })
})
