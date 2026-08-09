import { describe, expect, it } from 'vitest'
import { BoardState } from '../src/systems/BoardState'
import { searchMinMoves } from '../src/systems/SolverSearch'
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
  return { id: 900, cells: line(-3, 3), bees: [], moveBudget: 20, threeStarSpare: 0, ...o }
}

/**
 * The recurring three-bee figure below, on a 3-row band:
 *
 *   EAST  at (-2, 0) flies straight down row 0, smearing the whole row.
 *   CROSS at (-1, 1) flies north-east and its very first step is (0, 0) —
 *         squarely in EAST's lane.
 *   FREE  at (2, 1) is one step from the edge, so it exits cleanly and exists
 *         purely to burn a move.
 *
 * Under PERMANENT honey the crossing at (0,0) is symmetric: whichever of EAST /
 * CROSS flies first lays honey there, and the other sticks in it — so exactly one
 * forced stop is unavoidable, no matter the order.
 */
const EAST = { q: -2, r: 0, dir: E, kind: 'bee' } as const
const CROSS = { q: -1, r: 1, dir: NE, kind: 'bee' } as const
const FREE = { q: 2, r: 1, dir: E, kind: 'bee' } as const

describe('permanent honey trail', () => {
  it('sits under every bee from the very start', () => {
    const board = new BoardState(makeLevel({ bees: [{ q: -2, r: 0, dir: E, kind: 'bee' }] }))
    expect(board.isSticky(-2, 0)).toBe(true) // honey under the bee before any move
  })

  it('smears honey over every cell a bee flies across, and it stays', () => {
    const board = new BoardState(makeLevel({ bees: [{ q: -3, r: 0, dir: E, kind: 'bee' }] }))
    board.tap(-3, 0)
    for (let q = -3; q <= 3; q++) expect(board.isSticky(q, 0), `cell ${q}`).toBe(true)
  })

  it('never dries: the honey is still there after unrelated later moves', () => {
    const board = new BoardState(makeLevel({ cells: band(-2, 2), bees: [EAST, FREE] }))
    board.tap(EAST.q, EAST.r)
    expect(board.isSticky(0, 0)).toBe(true)
    board.tap(FREE.q, FREE.r) // an unrelated move — honey does NOT dry
    expect(board.isSticky(0, 0)).toBe(true)
  })

  it('catches the next bee to cross a laid trail', () => {
    const board = new BoardState(makeLevel({ cells: band(-2, 2), bees: [EAST, CROSS] }))
    expect(board.tap(EAST.q, EAST.r)?.kind).toBe('escaped')
    const out = board.tap(CROSS.q, CROSS.r)
    expect(out?.kind).toBe('stuck')
    if (out?.kind === 'stuck') expect(out.at).toEqual({ q: 0, r: 0 })
  })

  it('a bee flies off the honey it is standing on normally', () => {
    const board = new BoardState(makeLevel({ cells: band(-2, 2), bees: [EAST, CROSS] }))
    board.tap(EAST.q, EAST.r)
    board.tap(CROSS.q, CROSS.r) // stuck at (0,0), now standing in honey
    expect(board.occupantAt(0, 0)).toBeDefined()
    expect(board.tap(0, 0)?.kind).toBe('escaped') // not re-caught by the cell it stands on
    expect(board.status).toBe('won')
  })

  it('a bump still smears honey over the cells crossed before bouncing', () => {
    const board = new BoardState(
      makeLevel({
        bees: [
          { q: -3, r: 0, dir: E, kind: 'bee' },
          { q: 0, r: 0, dir: E, kind: 'bee' },
        ],
      }),
    )
    expect(board.tap(-3, 0)?.kind).toBe('blocked')
    expect(board.isSticky(-2, 0)).toBe(true)
    expect(board.isSticky(-1, 0)).toBe(true)
    expect(board.occupantAt(-3, 0)).toBeDefined() // bounced back home
  })

  it('order is the whole puzzle: the queen must leave last or the level is lost', () => {
    // A clean order-dependent case: fly the worker first, then the queen, and the
    // board is won; release the queen while a worker remains and it is an instant,
    // unrecoverable loss.
    const level = makeLevel({
      cells: band(-2, 2),
      bees: [
        { q: -2, r: 1, dir: E, kind: 'queen' },
        { q: -2, r: -1, dir: E, kind: 'bee' },
      ],
    })
    const good = new BoardState(level)
    good.tap(-2, -1) // worker out first
    good.tap(-2, 1) // queen last
    expect(good.status).toBe('won')

    const bad = new BoardState(level)
    bad.tap(-2, 1) // queen leaves while the worker is still home
    expect(bad.status).toBe('lost')
  })
})

describe('SolverSearch with the permanent trail', () => {
  it('counts the extra tap a forced honey-stop costs', () => {
    // Two crossing lanes: whichever bee flies first, the other must stop in its
    // honey and re-fly. Two bees, three taps.
    const board = new BoardState(makeLevel({ cells: band(-2, 2), bees: [EAST, CROSS] }))
    expect(searchMinMoves(board, 8)).toBe(3)
  })

  it('cannot dodge the stop under permanent honey (an idle bee does not help)', () => {
    // With drying, spending FREE's move used to let row 0 clear so all three bees
    // escaped clean. Permanent honey removes that escape hatch: the EAST/CROSS
    // crossing still forces exactly one stop, so it is four taps, not three.
    const board = new BoardState(makeLevel({ cells: band(-2, 2), bees: [EAST, FREE, CROSS] }))
    expect(searchMinMoves(board, 8)).toBe(4)
  })

  it('still reports null for a board no order can clear', () => {
    const board = new BoardState(
      makeLevel({
        cells: line(-1, 1),
        bees: [
          { q: -1, r: 0, dir: E, kind: 'bee' },
          { q: 1, r: 0, dir: W, kind: 'bee' },
        ],
      }),
    )
    // Each faces the other, so neither can ever leave.
    expect(searchMinMoves(board, 8)).toBeNull()
  })
})
