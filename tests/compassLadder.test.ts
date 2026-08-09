import { describe, expect, it } from 'vitest'
import { BoardState } from '../src/systems/BoardState'
import { searchCompassMinMoves } from '../src/systems/SolverSearch'
import { COMPASS_LEVELS, COMPASS_COUNT, COMPASS_READY } from '../src/levels/compass'
import { axialKey } from '../src/systems/HexGrid'
import generated from '../src/levels/compass.generated.json'

/**
 * The SHIPPED Compass Hive ladder — the mode's equivalent of
 * `generatedLevels.test.ts`.
 *
 * This exists because of a real miss: the mode was fully built and unlocked
 * after campaign L40, but `compass.generated.json` shipped a single
 * `"placeholder": true` board — `genCompassLevels.ts` had never been run. Every
 * test passed, because every compass test drove hand-written boards and none of
 * them ever looked at the ladder the player actually gets. These do.
 */

const goalCount = (l: (typeof COMPASS_LEVELS)[number]): number =>
  l.bees.filter((b) => b.kind !== 'hornet').length

describe('shipped Compass ladder — placeholder gate', () => {
  // The invariant that holds in BOTH states, and the one that actually protects
  // players: the mode is offered if and only if a real ladder is shipped.
  // HomeScene builds its Compass entry behind `COMPASS_READY`, so a build made
  // against the placeholder simply has no Compass row.
  it('reports readiness that matches the data on disk', () => {
    const isPlaceholder = (generated as { placeholder?: boolean }).placeholder ?? false
    expect(COMPASS_READY).toBe(!isPlaceholder)
    if (!COMPASS_READY) {
      console.warn(
        `compass.generated.json is the placeholder (${COMPASS_COUNT} level) — the mode is HIDDEN in this build. Run \`npm run gen:compass\` to ship it.`,
      )
    }
  })
})

describe.skipIf(!COMPASS_READY)('shipped Compass ladder', () => {
  it('ships the full 50-level ladder with sequential ids', () => {
    expect(COMPASS_COUNT).toBe(50)
    expect(COMPASS_LEVELS.length).toBe(50)
    COMPASS_LEVELS.forEach((l, i) => expect(l.id).toBe(i + 1))
  })

  it('marks every level as compass mode and gives each one gates', () => {
    for (const l of COMPASS_LEVELS) {
      expect(l.compass, `level ${l.id}`).toBe(true)
      expect((l.gates ?? []).length, `level ${l.id} has no gates`).toBeGreaterThan(0)
    }
  })

  it('gives every bee a color that some gate actually opens', () => {
    for (const l of COMPASS_LEVELS) {
      const gateColors = new Set((l.gates ?? []).map((g) => g[3]))
      for (const b of l.bees) {
        expect(b.color, `level ${l.id} bee at ${b.q},${b.r} has no color`).toBeDefined()
        expect(
          gateColors.has(b.color as number),
          `level ${l.id}: bee color ${b.color} has no matching gate`,
        ).toBe(true)
      }
    }
  })

  it('places every gate on a real rim crossing of its own board', () => {
    for (const l of COMPASS_LEVELS) {
      const cells = new Set(l.cells.map(([q, r]) => axialKey(q, r)))
      for (const [q, r] of l.gates ?? []) {
        expect(cells.has(axialKey(q, r)), `level ${l.id}: gate on a cell off the board`).toBe(true)
      }
    }
  })

  it('never overlaps two occupants on one cell', () => {
    for (const l of COMPASS_LEVELS) {
      const seen = new Set<string>()
      for (const b of l.bees) {
        const k = axialKey(b.q, b.r)
        expect(seen.has(k), `level ${l.id}: two occupants on ${k}`).toBe(false)
        seen.add(k)
      }
    }
  })

  it('keeps the move budget above the goal count so rotation has room', () => {
    for (const l of COMPASS_LEVELS) {
      expect(l.moveBudget, `level ${l.id}`).toBeGreaterThanOrEqual(goalCount(l))
      expect(l.threeStarSpare, `level ${l.id}`).toBeGreaterThanOrEqual(0)
    }
  })

  // The one that matters: a level the rotation-aware search cannot clear inside
  // its own budget is unwinnable, and would strand every player who reaches it.
  for (const level of COMPASS_LEVELS) {
    it(`C${level.id} is solvable within its move budget`, () => {
      const min = searchCompassMinMoves(new BoardState(level), level.moveBudget, 2_000_000)
      expect(min, `C${level.id} has no solution within ${level.moveBudget} moves`).not.toBeNull()
      expect(min!).toBeLessThanOrEqual(level.moveBudget)
      expect(min!).toBeGreaterThanOrEqual(goalCount(level))
    })
  }
})
