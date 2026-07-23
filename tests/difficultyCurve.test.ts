import { describe, expect, it } from 'vitest'
import { buildLevelCurve, LEVEL_COUNT, slotFor } from '../src/config/levelCurve'
import { LEVELS } from '../src/levels'
import { BoardState } from '../src/systems/BoardState'
import { smartGreedyLossRate } from '../src/systems/SolverSearch'
import type { LevelData } from '../src/types'

/**
 * Guards the "levels get harder and harder" contract.
 *
 * The signal is SMART-GREEDY LOSS: how often play that never bumps, never frees
 * the queen early, and prefers a clean escape over gluing a bee into honey STILL
 * loses. 0% means a player who merely understands the rules can win without a
 * plan.
 *
 * An earlier version of this file measured careless (random) play instead. That
 * was the wrong target: on a honey-free board "tap any clear bee, queen last"
 * always wins, so those levels scored ~96% careless-loss and played as free.
 * Honey is what breaks that monotonicity, so honey — not the queen — is what the
 * curve leans on.
 */

const TRIALS = 40

function planningLoss(level: LevelData): number {
  return smartGreedyLossRate(new BoardState(level), TRIALS, level.id * 7919)
}

describe('difficulty curve — schedule', () => {
  const slots = buildLevelCurve()

  it('never lowers the planning floor as levels progress', () => {
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].planningFloor).toBeGreaterThanOrEqual(slots[i - 1].planningFloor)
    }
  })

  it('opens with a pure tutorial, then introduces honey, then the queen', () => {
    for (const id of [1, 2, 3]) {
      expect(slotFor(id).honey).toBe(0)
      expect(slotFor(id).hasQueen).toBe(false)
    }
    // L4–13: honey taught on its own.
    for (let id = 4; id <= 13; id++) {
      expect(slotFor(id).honey).toBeGreaterThan(0)
      expect(slotFor(id).hasQueen).toBe(false)
    }
    // The queen joins at L14 and stays.
    for (let id = 14; id <= LEVEL_COUNT; id++) expect(slotFor(id).hasQueen).toBe(true)
  })

  it('keeps honey — the mechanic that actually demands planning — on every level past the tutorial', () => {
    for (let id = 4; id <= LEVEL_COUNT; id++) {
      expect(slotFor(id).honey, `level ${id}`).toBeGreaterThan(0)
    }
  })

  it('ramps honey density and hornet walls as the game goes', () => {
    expect(slotFor(15).honey).toBeLessThan(slotFor(65).honey)
    expect(slotFor(65).honey).toBeLessThan(slotFor(135).honey)
    expect(slotFor(20).hornets).toBeLessThan(slotFor(95).hornets)
    expect(slotFor(95).hornets).toBeLessThan(slotFor(135).hornets)
  })

  it('tightens the move budget over the game', () => {
    expect(slotFor(140).slack).toBeLessThanOrEqual(slotFor(10).slack)
  })
})

describe('difficulty curve — shipped levels demand a plan', () => {
  it('leaves no free levels past the teaching band', () => {
    const free = LEVELS.filter((l) => l.id >= 20 && planningLoss(l) === 0)
    expect(free.map((l) => l.id)).toEqual([])
  })

  it('mid and late levels punish unplanned play heavily', () => {
    for (const l of LEVELS.filter((x) => x.id >= 26)) {
      expect(planningLoss(l), `level ${l.id}`).toBeGreaterThanOrEqual(0.3)
    }
  })

  it('meets the curve floor on every level', () => {
    for (const l of LEVELS) {
      const floor = slotFor(l.id).planningFloor
      // Sampling noise: allow a small margin below the floor.
      expect(planningLoss(l), `level ${l.id}`).toBeGreaterThanOrEqual(floor - 0.2)
    }
  })

  it('rises from the teaching band into the body of the game', () => {
    const avg = (ls: LevelData[]) => ls.reduce((a, l) => a + planningLoss(l), 0) / ls.length
    const teaching = avg(LEVELS.filter((l) => l.id <= 13))
    const body = avg(LEVELS.filter((l) => l.id >= 26))
    expect(body).toBeGreaterThan(teaching + 0.2)
  })

  it('never regresses chapter over chapter', () => {
    const perChapter: number[] = []
    for (let ch = 1; ch <= 6; ch++) {
      const g = LEVELS.filter((l) => (l.chapter ?? Math.ceil(l.id / 25)) === ch)
      perChapter.push(g.reduce((a, l) => a + planningLoss(l), 0) / g.length)
    }
    for (let i = 1; i < perChapter.length; i++) {
      // Later chapters saturate (the bot fails ~77% once a plan is required);
      // this guards against a real regression, not against the plateau.
      expect(perChapter[i], `chapter ${i + 1}`).toBeGreaterThanOrEqual(perChapter[i - 1] - 0.05)
    }
  })
})
