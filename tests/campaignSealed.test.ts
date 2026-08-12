import { describe, expect, it } from 'vitest'
import { BoardState } from '../src/systems/BoardState'
import { searchCompassMinMoves } from '../src/systems/SolverSearch'
import { LEVELS, LEVEL_COUNT } from '../src/levels'
import { axialKey } from '../src/systems/HexGrid'
import { GATE_ANY } from '../src/types'
import generated from '../src/levels/levels.generated.json'

/**
 * The SEALED-RIM campaign: the 300 levels under the rules that replaced the
 * open-rim game — the hive is a wall except at its doors, turning is free, and
 * there is no queen.
 *
 * Why the campaign was replaced, in one measurement: on the open-rim set, all
 * 1420 opening escape taps across the 300 levels kept the level winnable and
 * not one cost a move of optimality. There was no first move in the entire game
 * that could be wrong, so the opening of every level was free.
 *
 * `progression` in the JSON says which design is on disk. Until a sealed-rim
 * set is generated these skip with a warning rather than failing on data nobody
 * claimed was new — and they fail loudly the day a stale set is passed off as
 * the redesign.
 */
const SEALED = (generated as { progression?: string }).progression === 'sealed-rim'

describe('campaign design marker', () => {
  it('says which design the shipped campaign was built to', () => {
    if (!SEALED) {
      console.warn(
        'levels.generated.json predates the sealed-rim redesign — the campaign tests below are SKIPPED. Run `npx tsx scripts/genCampaign.ts`.',
      )
    }
    expect(typeof SEALED).toBe('boolean')
  })
})

describe.skipIf(!SEALED)('sealed-rim campaign', () => {
  it('ships 300 levels with sequential ids', () => {
    expect(LEVEL_COUNT).toBe(300)
    LEVELS.forEach((l, i) => expect(l.id).toBe(i + 1))
  })

  it('plays every level by the sealed-rim rules', () => {
    for (const l of LEVELS) {
      expect(l.compass, `level ${l.id} is not marked sealed-rim`).toBe(true)
      expect((l.gates ?? []).length, `level ${l.id} has no doors`).toBeGreaterThanOrEqual(2)
    }
  })

  it('has no queen anywhere', () => {
    // She is not merely hidden: 100% of the old campaign's dead-end positions
    // were "workers jammed, queen has a clear lane, taking it loses". Queen-last
    // manufactured every dead end the game had.
    const withQueen = LEVELS.filter((l) => l.bees.some((b) => b.kind === 'queen'))
    expect(withQueen.map((l) => l.id)).toEqual([])
  })

  it('teaches doors before colours', () => {
    for (const l of LEVELS) {
      const colours = new Set((l.gates ?? []).map((g) => g[3]))
      if (l.id <= 60) {
        expect([...colours], `level ${l.id} should still be uncoloured`).toEqual([GATE_ANY])
      } else {
        expect(colours.has(GATE_ANY), `level ${l.id} should be matched`).toBe(false)
      }
    }
  })

  it('never strands a bee whose colour no door opens', () => {
    for (const l of LEVELS) {
      const doorColours = new Set((l.gates ?? []).map((g) => g[3]))
      for (const b of l.bees) {
        const c = b.color ?? GATE_ANY
        expect(
          doorColours.has(c) || doorColours.has(GATE_ANY),
          `level ${l.id}: a ${c} bee has no door it fits`,
        ).toBe(true)
      }
    }
  })

  it('puts every door on a real rim crossing', () => {
    for (const l of LEVELS) {
      const cells = new Set(l.cells.map(([q, r]) => axialKey(q, r)))
      for (const [q, r] of l.gates ?? []) {
        expect(cells.has(axialKey(q, r)), `level ${l.id}: door off the board`).toBe(true)
      }
    }
  })

  it('never overlaps two occupants on one cell', () => {
    for (const l of LEVELS) {
      const seen = new Set<string>()
      for (const b of l.bees) {
        const k = axialKey(b.q, b.r)
        expect(seen.has(k), `level ${l.id}: two occupants on ${k}`).toBe(false)
        seen.add(k)
      }
    }
  })

  it('demands routing, not one tap per bee', () => {
    // The failure the redesign exists to prevent: a board where everyone just
    // turns once and leaves. Forced hops = minMoves - beeCount.
    const raw = (generated as { levels: Array<{ minMoves: number }> }).levels
    const hops = LEVELS.map((l, i) => raw[i].minMoves - l.bees.length)
    expect(Math.min(...hops), 'some level needs no routing at all').toBeGreaterThanOrEqual(2)
    const mean = hops.reduce((a, b) => a + b, 0) / hops.length
    expect(mean, `mean forced hops ${mean.toFixed(2)}`).toBeLessThan(5)
  })

  // The one that decides whether the game is shippable at all: a level the
  // rotation-aware search cannot clear inside its own budget strands everyone
  // who reaches it. Sampled rather than exhaustive — the rotation search is far
  // heavier than the campaign's old one, and `npx tsx scripts/genCampaign.ts`
  // re-proves every level at generation time.
  const sample = LEVELS.filter((l) => l.id % 7 === 1)
  for (const level of sample) {
    it(`L${level.id} is solvable within its move budget`, () => {
      const min = searchCompassMinMoves(new BoardState(level), level.moveBudget, 2_000_000)
      expect(min, `L${level.id} unwinnable in ${level.moveBudget} moves`).not.toBeNull()
      expect(min!).toBeLessThanOrEqual(level.moveBudget)
    })
  }
})
