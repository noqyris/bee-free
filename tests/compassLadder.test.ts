import { describe, expect, it } from 'vitest'
import { BoardState } from '../src/systems/BoardState'
import { searchCompassMinMoves } from '../src/systems/SolverSearch'
import { COMPASS_LEVELS, COMPASS_COUNT, COMPASS_READY } from '../src/levels/compass'
import { GATE_ANY } from '../src/types'
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

  // These four pin the redesign IN THE DATA, which is the gap that let a commit
  // claim "doors from level 1, queen removed" while the shipped JSON still had
  // 39 queens and zero universal doors. The generator saying so is not the same
  // as the game shipping it.

  it('ships no queen anywhere — she is retired from the mode, not just hidden', () => {
    const withQueen = COMPASS_LEVELS.filter((l) => l.bees.some((b) => b.kind === 'queen'))
    expect(withQueen.map((l) => l.id)).toEqual([])
  })

  it('teaches doors before colours: C1-14 are universal, C15+ are matched', () => {
    for (const l of COMPASS_LEVELS) {
      const colours = new Set((l.gates ?? []).map((g) => g[3]))
      if (l.id <= 14) {
        expect([...colours], `level ${l.id} should be uncoloured`).toEqual([GATE_ANY])
      } else {
        expect(colours.has(GATE_ANY), `level ${l.id} should be coloured`).toBe(false)
      }
    }
  })

  it('gives the teaching band more doors than the deep end', () => {
    const doors = (id: number): number => (COMPASS_LEVELS[id - 1].gates ?? []).length
    const early = [1, 2, 3, 4, 5].map(doors)
    expect(Math.min(...early), 'early levels want at least three doors').toBeGreaterThanOrEqual(3)
  })

  it('keeps forced hops in the band that measured playable', () => {
    // Difficulty here is near-monotone in forced hops (minMoves - beeCount):
    // 2.6-3.6 measured 0.43-0.59 planner loss and plays; 4.5-5.4 measured
    // 0.86-0.96, where a one-ply player essentially never wins.
    const raw = (generated as { levels: Array<{ minMoves: number }> }).levels
    const hops = COMPASS_LEVELS.map((l, i) => raw[i].minMoves - l.bees.length)
    const mean = hops.reduce((a, b) => a + b, 0) / hops.length
    expect(mean, `mean forced hops ${mean.toFixed(2)}`).toBeLessThan(4.5)
    expect(mean).toBeGreaterThan(1)
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
