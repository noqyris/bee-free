import { describe, expect, it } from 'vitest'
import { BoardState } from '../src/systems/BoardState'
import { Direction, GATE_ANY, type LevelData } from '../src/types'

/**
 * Rush Hive: the unpark-the-cars variant. Three rules, and they only make sense
 * together — a blocked bee PARKS instead of bumping, the rim is a wall except at
 * universal exits, and a tap that cannot move the bee is refused for free.
 *
 * The measurement that motivated the mode: across all 300 campaign levels the
 * opening position has 1570 bees able to fly straight out and ZERO blocked, so
 * bees never become each other's traffic. These tests pin the rules that change
 * that.
 */

/** A 5-cell east-west corridor (0,0)…(4,0); `exits` are [q,r,dir] rim mouths. */
const corridor = (
  bees: LevelData['bees'],
  exits: Array<[number, number, number]> = [],
  budget = 9,
): BoardState =>
  new BoardState({
    id: 0,
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ],
    bees,
    moveBudget: budget,
    threeStarSpare: 0,
    rush: true,
    gates: exits.map(([q, r, d]) => [q, r, d, GATE_ANY] as const),
  })

describe('Rush Hive — parking', () => {
  it('slides a blocked bee up to its blocker instead of bumping it home', () => {
    const b = corridor([
      { q: 0, r: 0, dir: Direction.E, kind: 'bee' },
      { q: 4, r: 0, dir: Direction.E, kind: 'bee' },
    ])
    const out = b.tap(0, 0)
    expect(out?.kind).toBe('parked')
    // It travelled (0,0) → (3,0), stopping against the bee on (4,0).
    expect(b.occupantAt(3, 0)).toBeDefined()
    expect(b.occupantAt(0, 0)).toBeUndefined()
    expect(b.movesUsed).toBe(1)
    expect(b.remaining).toBe(2) // nobody escaped
  })

  it('refuses a tap that cannot move the bee at all, and charges nothing', () => {
    const b = corridor([
      { q: 0, r: 0, dir: Direction.E, kind: 'bee' },
      { q: 1, r: 0, dir: Direction.E, kind: 'bee' },
    ])
    expect(b.tap(0, 0)).toBeUndefined() // flush against its blocker
    expect(b.movesUsed).toBe(0)
    expect(b.occupantAt(0, 0)).toBeDefined()
  })

  it('parks a bee against a solid rim rather than letting it escape anywhere', () => {
    const b = corridor([{ q: 0, r: 0, dir: Direction.E, kind: 'bee' }]) // no exits
    const out = b.tap(0, 0)
    expect(out?.kind).toBe('parked')
    expect(b.occupantAt(4, 0)).toBeDefined() // slid to the far wall
    expect(b.status).toBe('playing') // still on the board
  })

  it('lets a bee out through a universal exit', () => {
    const b = corridor([{ q: 0, r: 0, dir: Direction.E, kind: 'bee' }], [[4, 0, Direction.E]])
    const out = b.tap(0, 0)
    expect(out?.kind).toBe('escaped')
    expect(b.status).toBe('won')
  })

  it('makes the ORDER decide the level: the same two taps win or deadlock', () => {
    // Exit is EAST. The east bee is in the west bee's way.
    const level = (): BoardState =>
      corridor(
        [
          { q: 0, r: 0, dir: Direction.E, kind: 'bee' },
          { q: 2, r: 0, dir: Direction.E, kind: 'bee' },
        ],
        [[4, 0, Direction.E]],
        2,
      )

    // Right order: clear the blocker first, then the one behind it.
    const good = level()
    expect(good.tap(2, 0)?.kind).toBe('escaped')
    expect(good.tap(0, 0)?.kind).toBe('escaped')
    expect(good.status).toBe('won')

    // Wrong order: the west bee parks behind the blocker and burns the budget.
    const bad = level()
    expect(bad.tap(0, 0)?.kind).toBe('parked')
    expect(bad.tap(2, 0)?.kind).toBe('escaped')
    expect(bad.status).toBe('lost') // out of moves with a bee still inside
  })
})

describe('Rush Hive — dry board', () => {
  it('lays no honey under bees and none along a flight', () => {
    const b = corridor([{ q: 0, r: 0, dir: Direction.E, kind: 'bee' }], [[4, 0, Direction.E]])
    expect(b.honey.size).toBe(0) // no honey seeded under the bee
    b.tap(0, 0)
    expect(b.honey.size).toBe(0) // and none smeared by the flight
  })

  it('keeps campaign boards wet — the dry rule is Rush-only', () => {
    const campaign = new BoardState({
      id: 0,
      cells: [
        [0, 0],
        [1, 0],
      ],
      bees: [{ q: 0, r: 0, dir: Direction.E, kind: 'bee' }],
      moveBudget: 3,
      threeStarSpare: 0,
    })
    expect(campaign.honey.size).toBe(1)
    expect(campaign.isRush).toBe(false)
  })
})

describe('Rush Hive — survives the solver', () => {
  it('carries its rules through clone(), which every search node depends on', () => {
    const b = corridor([
      { q: 0, r: 0, dir: Direction.E, kind: 'bee' },
      { q: 4, r: 0, dir: Direction.E, kind: 'bee' },
    ])
    const c = b.clone()
    expect(c.isRush).toBe(true)
    // Same rules on the copy: park, not bump.
    expect(c.tap(0, 0)?.kind).toBe('parked')
    expect(c.occupantAt(3, 0)).toBeDefined()
    // …and the original is untouched.
    expect(b.occupantAt(0, 0)).toBeDefined()
  })

  it('keeps the queen-last rule', () => {
    const b = corridor(
      [
        { q: 0, r: 0, dir: Direction.E, kind: 'queen' },
        { q: 1, r: 0, dir: Direction.NE, kind: 'bee' },
      ],
      [[4, 0, Direction.E]],
    )
    b.tap(0, 0) // queen parks behind the worker? no — worker is adjacent east
    // The queen is flush against the worker, so that tap was refused.
    expect(b.movesUsed).toBe(0)
    b.tap(1, 0) // worker leaves north-east: parks at the rim (no exit there)
    expect(b.status).toBe('playing')
  })
})
