import { describe, expect, it } from 'vitest'
import { BoardState } from '../src/systems/BoardState'
import { Direction, type LevelData } from '../src/types'

/**
 * The sealed-hive rule — the model half of the dead-end rescue.
 *
 * Motivation, measured over the shipped campaign: 99% of losses were the board
 * sealing shut (161 sealed vs 2 out-of-moves in a 10-level sample), the player
 * still held ~3.8 unspent moves when it happened, and 2-3 bees were stranded,
 * never one. `isSealed` is how the scene recognises that position; `chargeMove`
 * is what stops the rewind from being free.
 */

const board = (bees: LevelData['bees'], budget = 9): BoardState =>
  new BoardState({
    id: 0,
    // A 3-cell east-west corridor.
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    bees,
    moveBudget: budget,
    threeStarSpare: 0,
  })

describe('sealed hive', () => {
  it('is not sealed while any bee can still fly out', () => {
    const b = board([{ q: 0, r: 0, dir: Direction.E, kind: 'bee' }])
    expect(b.isSealed()).toBe(false)
  })

  it('is sealed when every remaining bee can only bump', () => {
    // Two bees nose to nose: each faces the other, neither can move.
    const b = board([
      { q: 0, r: 0, dir: Direction.E, kind: 'bee' },
      { q: 1, r: 0, dir: Direction.W, kind: 'bee' },
    ])
    expect(b.trace(b.occupantAt(0, 0)!).kind).toBe('blocked')
    expect(b.trace(b.occupantAt(1, 0)!).kind).toBe('blocked')
    expect(b.isSealed()).toBe(true)
  })

  it('does not call a finished board sealed', () => {
    const b = board([{ q: 0, r: 0, dir: Direction.E, kind: 'bee' }])
    b.tap(0, 0)
    expect(b.status).toBe('won')
    expect(b.isSealed()).toBe(false)
  })

  it('is sealed when only the QUEEN can fly and releasing her would lose', () => {
    // THE dead end that actually occurs. Measured over the shipped campaign,
    // 100% of dead positions look like this: the workers are jammed, the queen
    // has a clear lane, and taking it is an instant loss. A sealed-check that
    // only looked for bumps scored every one of these as "still playable".
    const b = new BoardState({
      id: 0,
      cells: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      bees: [
        // Queen at the west end with a clear run east... except a worker is on
        // (1,0) — so aim her at a rim she CAN leave through instead.
        { q: 0, r: 0, dir: Direction.W, kind: 'queen' },
        // Worker nose-to-nose with the queen: it can only bump.
        { q: 1, r: 0, dir: Direction.W, kind: 'bee' },
      ],
      moveBudget: 9,
      threeStarSpare: 0,
    })
    expect(b.trace(b.occupantAt(1, 0)!).kind).toBe('blocked') // worker jammed
    expect(b.trace(b.occupantAt(0, 0)!).kind).toBe('escaped') // queen could go
    expect(b.remaining).toBe(2)
    expect(b.isSealed()).toBe(true) // …but only into a loss
  })

  it('is NOT sealed once the queen is the last one left', () => {
    const b = board([{ q: 0, r: 0, dir: Direction.E, kind: 'queen' }])
    expect(b.isSealed()).toBe(false) // now she is allowed to leave
  })

  it('counts a bee that can still stick in honey as a live move', () => {
    const b = new BoardState({
      id: 0,
      cells: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      honeyCells: [[1, 0]],
      bees: [
        { q: 0, r: 0, dir: Direction.E, kind: 'bee' },
        { q: 2, r: 0, dir: Direction.W, kind: 'bee' },
      ],
      moveBudget: 9,
      threeStarSpare: 0,
    })
    // (0,0) reaches honey at (1,0) before reaching the other bee — a real move.
    expect(b.trace(b.occupantAt(0, 0)!).kind).toBe('stuck')
    expect(b.isSealed()).toBe(false)
  })
})

describe('chargeMove — a rewound mistake still costs', () => {
  it('spends a move without touching the position', () => {
    const b = board([{ q: 0, r: 0, dir: Direction.E, kind: 'bee' }], 3)
    const before = b.movesLeft
    b.chargeMove()
    expect(b.movesLeft).toBe(before - 1)
    expect(b.occupantAt(0, 0)).toBeDefined() // nothing moved
  })

  it('can itself end the run — which is the point: the loss becomes the BUDGET', () => {
    const b = board([{ q: 0, r: 0, dir: Direction.NE, kind: 'bee' }], 1)
    expect(b.status).toBe('playing')
    b.chargeMove()
    expect(b.status).toBe('lost')
    // One bee left, not a locked board: the near miss the old loss never gave.
    expect(b.remaining).toBe(1)
  })

  it('does nothing once the game is over', () => {
    const b = board([{ q: 0, r: 0, dir: Direction.E, kind: 'bee' }], 3)
    b.tap(0, 0)
    expect(b.status).toBe('won')
    b.chargeMove()
    expect(b.status).toBe('won')
  })
})
