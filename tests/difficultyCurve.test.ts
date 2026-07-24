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
 * An earlier version measured careless (random) play instead, which was the
 * wrong target: with no honey in play "tap any clear bee, queen last" always
 * wins, so those levels scored ~96% careless-loss and played as free.
 *
 * Assertions here are deliberately AGGREGATE — chapter averages, windows, the
 * count of free levels. Per-level thresholds on a sampled statistic look precise
 * and are really just noise: at 40 trials a genuinely 26%-loss level lands on
 * 10% often enough to redden the suite for no reason.
 */

const TRIALS = 150

const lossCache = new Map<number, number>()
function planningLoss(level: LevelData): number {
  const hit = lossCache.get(level.id)
  if (hit !== undefined) return hit
  const value = smartGreedyLossRate(new BoardState(level), TRIALS, level.id * 7919)
  lossCache.set(level.id, value)
  return value
}

const avg = (ls: readonly LevelData[]): number =>
  ls.reduce((a, l) => a + planningLoss(l), 0) / ls.length

describe('difficulty curve — schedule', () => {
  const slots = buildLevelCurve()

  it('never lowers the planning floor as levels progress', () => {
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].planningFloor).toBeGreaterThanOrEqual(slots[i - 1].planningFloor)
    }
  })

  it('opens with a pure tutorial, then adds the queen', () => {
    for (const id of [1, 2, 3]) expect(slotFor(id).hasQueen).toBe(false)
    for (let id = 16; id <= LEVEL_COUNT; id++) expect(slotFor(id).hasQueen, `level ${id}`).toBe(true)
  })

  it('lays a honey trail on every single level — it is the game', () => {
    for (let id = 1; id <= LEVEL_COUNT; id++) {
      expect(slotFor(id).dryMoves, `level ${id}`).toBeGreaterThan(0)
    }
  })

  it('makes the trail last longer as the game goes on', () => {
    expect(slotFor(5).dryMoves).toBeLessThan(slotFor(50).dryMoves)
    expect(slotFor(50).dryMoves).toBeLessThan(slotFor(120).dryMoves)
    // Never regresses, spikes aside (a spike is one level stickier by design).
    for (let id = 2; id <= LEVEL_COUNT; id++) {
      const prev = slotFor(id - 1)
      const here = slotFor(id)
      if (id % 10 === 0 || (id - 1) % 10 === 0) continue
      expect(here.dryMoves, `level ${id}`).toBeGreaterThanOrEqual(prev.dryMoves)
    }
  })

  it('adds more hornet walls as the game goes', () => {
    expect(slotFor(20).hornets).toBeLessThan(slotFor(95).hornets)
    expect(slotFor(95).hornets).toBeLessThan(slotFor(135).hornets)
  })

  it('puts more bees on the board as the game goes', () => {
    expect(slotFor(5).targetBees).toBeLessThan(slotFor(60).targetBees)
    expect(slotFor(60).targetBees).toBeLessThan(slotFor(140).targetBees)
  })

  it('tightens the move budget over the game', () => {
    expect(slotFor(140).slack).toBeLessThanOrEqual(slotFor(10).slack)
  })
})

describe('difficulty curve — shipped levels demand a plan', () => {
  it('leaves no free levels past the teaching band', () => {
    const free = LEVELS.filter((l) => l.id >= 26 && planningLoss(l) === 0)
    expect(free.map((l) => l.id)).toEqual([])
  })

  it('keeps the free levels to the opening stretch', () => {
    const free = LEVELS.filter((l) => planningLoss(l) === 0)
    expect(free.length).toBeLessThanOrEqual(22)
    expect(Math.max(...free.map((l) => l.id))).toBeLessThan(26)
  })

  it('rises from the teaching band into the body of the game', () => {
    expect(avg(LEVELS.filter((l) => l.id >= 26))).toBeGreaterThan(
      avg(LEVELS.filter((l) => l.id <= 15)) + 0.2,
    )
  })

  it('is much harder at the end than in the middle', () => {
    expect(avg(LEVELS.filter((l) => l.id > 125))).toBeGreaterThan(
      avg(LEVELS.filter((l) => l.id > 50 && l.id <= 75)) + 0.15,
    )
  })

  it('clears the curve floor on average in every 25-level block', () => {
    for (let start = 1; start <= LEVEL_COUNT; start += 25) {
      const block = LEVELS.filter((l) => l.id >= start && l.id < start + 25)
      const floor = block.reduce((a, l) => a + slotFor(l.id).planningFloor, 0) / block.length
      expect(avg(block), `levels ${start}–${start + 24}`).toBeGreaterThanOrEqual(floor - 0.05)
    }
  })

  it('never regresses chapter over chapter', () => {
    const perChapter: number[] = []
    for (let ch = 1; ch <= 6; ch++) {
      perChapter.push(avg(LEVELS.filter((l) => (l.chapter ?? Math.ceil(l.id / 25)) === ch)))
    }
    for (let i = 1; i < perChapter.length; i++) {
      // Chapters 2 and 3 sit close together by design (the trail lengthens at
      // L20, then bee count carries the load); this guards a real regression.
      expect(perChapter[i], `chapter ${i + 1}`).toBeGreaterThanOrEqual(perChapter[i - 1] - 0.05)
    }
  })
})
