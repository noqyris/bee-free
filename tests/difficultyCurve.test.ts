import { describe, expect, it } from 'vitest'
import { buildLevelCurve, LEVEL_COUNT, slotFor } from '../src/config/levelCurve'
import { LEVELS } from '../src/levels'
import { BoardState } from '../src/systems/BoardState'
import { makeRng, mixSeed } from '../src/utils/rng'
import type { LevelData } from '../src/types'

/**
 * Guards the "levels get harder and harder" contract.
 *
 * The ground-truth signal is the CARELESS-LOSS RATE: the fraction of mindless
 * playthroughs (tap any random occupant whose flight is not a bump, ignore the
 * queen-last rule) that LOSE. 0% means the level can be beaten without thinking.
 */

const TRIALS = 40

function carelessLoss(level: LevelData): number {
  let losses = 0
  for (let t = 0; t < TRIALS; t++) {
    const rand = makeRng(mixSeed(level.id * 2654435761, (t + 1) * 40503))
    const b = new BoardState(level)
    let won = false
    for (let s = 0; s < 500; s++) {
      if (b.remaining === 0) {
        won = true
        break
      }
      if (b.status !== 'playing') break
      const opts = b.allOccupants().filter((o) => o.isTappable() && b.trace(o).kind !== 'blocked')
      if (opts.length === 0) break // stranded: only bumps remain
      const o = opts[Math.floor(rand() * opts.length)]
      b.tap(o.q, o.r)
    }
    if (!won) losses++
  }
  return losses / TRIALS
}

describe('difficulty curve — schedule', () => {
  const slots = buildLevelCurve()

  it('never lowers the careless-loss floor as levels progress', () => {
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].carelessFloor).toBeGreaterThanOrEqual(slots[i - 1].carelessFloor)
    }
  })

  it('teaches one mechanic at a time: honey solo, then queen solo, then both', () => {
    // L1–3 pure tutorial: no honey, no queen.
    for (const id of [1, 2, 3]) {
      expect(slotFor(id).honey).toBe(0)
      expect(slotFor(id).hasQueen).toBe(false)
    }
    // L4–13 honey is taught alone (queen not yet introduced).
    for (let id = 4; id <= 13; id++) {
      expect(slotFor(id).honey).toBeGreaterThan(0)
      expect(slotFor(id).hasQueen).toBe(false)
    }
    // L14–19 the queen is taught alone.
    for (let id = 14; id <= 19; id++) {
      expect(slotFor(id).hasQueen).toBe(true)
      expect(slotFor(id).honey).toBe(0)
    }
  })

  it('keeps the queen (the think-or-lose spine) on every level from L14 on', () => {
    for (let id = 14; id <= LEVEL_COUNT; id++) expect(slotFor(id).hasQueen).toBe(true)
  })

  it('stacks honey onto the queen from L20 on, except the big showcase spikes', () => {
    for (let id = 20; id <= LEVEL_COUNT; id++) {
      const s = slotFor(id)
      const isShowcaseSpike = id % 10 === 0 && id >= 40
      if (isShowcaseSpike) expect(s.honey).toBe(0)
      else expect(s.honey).toBeGreaterThan(0)
    }
  })

  it('ramps honey depth and hornet walls as the game goes', () => {
    // Sample non-spike levels — showcase spikes deliberately carry no honey.
    expect(slotFor(30).honey).toBeLessThan(slotFor(65).honey)
    expect(slotFor(65).honey).toBeLessThan(slotFor(135).honey)
    expect(slotFor(20).hornets).toBeLessThan(slotFor(95).hornets)
    expect(slotFor(95).hornets).toBeLessThan(slotFor(135).hornets)
  })
})

describe('difficulty curve — shipped levels punish mindless play', () => {
  it('every level from L14 on can NOT be won by mindless tapping', () => {
    const mindless = LEVELS.filter((l) => l.id >= 14 && carelessLoss(l) === 0)
    expect(mindless.map((l) => l.id)).toEqual([])
  })

  it('mid and late levels punish careless play heavily', () => {
    for (const l of LEVELS.filter((x) => x.id >= 26)) {
      expect(carelessLoss(l), `level ${l.id}`).toBeGreaterThanOrEqual(0.4)
    }
  })

  it('meets the curve floor on every level', () => {
    for (const l of LEVELS) {
      const floor = slotFor(l.id).carelessFloor
      // Sampling noise: allow a small margin below the floor.
      expect(carelessLoss(l), `level ${l.id}`).toBeGreaterThanOrEqual(floor - 0.15)
    }
  })

  it('gets harder chapter over chapter (careless-loss never drops between chapters)', () => {
    const perChapter: number[] = []
    for (let ch = 1; ch <= 6; ch++) {
      const g = LEVELS.filter((l) => (l.chapter ?? Math.ceil(l.id / 25)) === ch)
      perChapter.push(g.reduce((a, l) => a + carelessLoss(l), 0) / g.length)
    }
    for (let i = 1; i < perChapter.length; i++) {
      // Later chapters saturate near ~95%; never allow a real regression.
      expect(perChapter[i], `chapter ${i + 1}`).toBeGreaterThanOrEqual(perChapter[i - 1] - 0.03)
    }
  })
})
