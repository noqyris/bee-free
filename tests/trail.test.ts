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
  return { id: 900, cells: line(-3, 3), bees: [], moveBudget: 20, threeStarSpare: 0, dryMoves: 2, ...o }
}

/**
 * The recurring three-bee figure below, on a 3-row band:
 *
 *   EAST  at (-2, 0) flies straight down row 0, smearing the whole row.
 *   CROSS at (-1, 1) flies north-east and its very first step is (0, 0) —
 *         squarely in EAST's lane.
 *   FREE  at (2, 1) is one step from the edge, so it leaves no trail at all
 *         and exists purely to burn a move.
 *
 * That makes the order the whole puzzle: EAST → FREE → CROSS clears the board
 * in three taps because FREE's move is exactly the one that dries row 0, while
 * EAST → CROSS → FREE strands CROSS in the honey and needs four.
 */
const EAST = { q: -2, r: 0, dir: E, kind: 'bee' } as const
const CROSS = { q: -1, r: 1, dir: NE, kind: 'bee' } as const
const FREE = { q: 2, r: 1, dir: E, kind: 'bee' } as const

describe('honey trail', () => {
  it('smears honey over every cell a bee flies across', () => {
    const board = new BoardState(makeLevel({ bees: [{ q: -3, r: 0, dir: E, kind: 'bee' }] }))
    board.tap(-3, 0)
    for (let q = -2; q <= 3; q++) expect(board.isSticky(q, 0), `cell ${q}`).toBe(true)
    // The cell it took off from is not part of the flight.
    expect(board.isSticky(-3, 0)).toBe(false)
  })

  it('catches the next bee to cross a fresh trail', () => {
    const board = new BoardState(makeLevel({ cells: band(-2, 2), bees: [EAST, CROSS] }))
    expect(board.tap(EAST.q, EAST.r)?.kind).toBe('escaped')
    const out = board.tap(CROSS.q, CROSS.r)
    expect(out?.kind).toBe('stuck')
    if (out?.kind === 'stuck') expect(out.at).toEqual({ q: 0, r: 0 })
  })

  it('dries after exactly dryMoves further moves, and then lets bees through', () => {
    const board = new BoardState(
      makeLevel({ dryMoves: 1, cells: band(-2, 2), bees: [EAST, FREE, CROSS] }),
    )
    board.tap(EAST.q, EAST.r)
    expect(board.isSticky(0, 0)).toBe(true)
    board.tap(FREE.q, FREE.r) // one unrelated move — row 0 dries at the end of it
    expect(board.isSticky(0, 0)).toBe(false)
    expect(board.tap(CROSS.q, CROSS.r)?.kind).toBe('escaped')
    expect(board.status).toBe('won')
  })

  it('is the reason the order matters: the same board wins or loses on order alone', () => {
    const level = makeLevel({
      dryMoves: 1,
      cells: band(-2, 2),
      moveBudget: 3,
      bees: [EAST, FREE, CROSS],
    })

    const good = new BoardState(level)
    good.tap(EAST.q, EAST.r)
    good.tap(FREE.q, FREE.r) // spends the move that dries row 0
    good.tap(CROSS.q, CROSS.r)
    expect(good.status).toBe('won')

    const bad = new BoardState(level)
    bad.tap(EAST.q, EAST.r)
    bad.tap(CROSS.q, CROSS.r) // glued into row 0 while it is still wet
    bad.tap(FREE.q, FREE.r)
    expect(bad.status).toBe('lost')
  })

  it('a bee sitting in honey flies off it normally', () => {
    const board = new BoardState(makeLevel({ cells: band(-2, 2), bees: [EAST, CROSS] }))
    board.tap(EAST.q, EAST.r)
    board.tap(CROSS.q, CROSS.r) // stuck at (0,0)
    expect(board.occupantAt(0, 0)).toBeDefined()
    expect(board.tap(0, 0)?.kind).toBe('escaped') // not re-caught by the cell it stands on
    expect(board.status).toBe('won')
  })

  it('a bump still smears honey over the cells the bee crossed before bouncing', () => {
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

  it('leaves no trail at all when dryMoves is 0', () => {
    const board = new BoardState(
      makeLevel({ dryMoves: 0, bees: [{ q: -3, r: 0, dir: E, kind: 'bee' }] }),
    )
    board.tap(-3, 0)
    expect(board.stickyCells()).toEqual([])
  })
})

describe('SolverSearch with the trail', () => {
  it('counts the extra tap a forced honey-stop costs', () => {
    // Two crossing lanes and nothing to spend a drying move on: whichever bee
    // flies first, the other must stop in its trail. Two bees, three taps.
    const board = new BoardState(
      makeLevel({ dryMoves: 3, cells: band(-2, 2), bees: [EAST, CROSS] }),
    )
    expect(searchMinMoves(board, 8)).toBe(3)
  })

  it('finds the order that dodges the trail when one exists', () => {
    const board = new BoardState(
      makeLevel({ dryMoves: 1, cells: band(-2, 2), bees: [EAST, FREE, CROSS] }),
    )
    expect(searchMinMoves(board, 8)).toBe(3) // one tap per bee — no stops needed
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
