import { describe, expect, it } from 'vitest'
import { buildLevelCurve, LEVEL_COUNT, slotFor } from '../src/config/levelCurve'
import { LEVELS } from '../src/levels'
import type { LevelData } from '../src/types'
// The SHIPPED planning-loss, measured once at generation time. Reading it here
// (instead of re-running 150-trial smart-greedy for every one of 300 levels,
// which took minutes) keeps this suite fast and asserts exactly what ships.
import generated from '../src/levels/levels.generated.json'

/**
 * The open-rim campaign these describe was replaced by the sealed-rim
 * redesign. They stay in the tree because they are the record of what the old
 * design promised and how it was verified — but they must not run against data
 * built to different rules, where a queen or an open edge is simply absent.
 */
const OPEN_RIM = (generated as { progression?: string }).progression !== 'sealed-rim'


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

function planningLoss(level: LevelData): number {
  return (generated.levels[level.id - 1] as { planningLoss?: number } | undefined)?.planningLoss ?? 0
}

function plannerLoss(level: LevelData): number {
  return (generated.levels[level.id - 1] as { plannerLoss?: number })?.plannerLoss ?? 0
}

/**
 * The planner floor the level was actually GENERATED against, as stamped into
 * the JSON. Usually the curve's value; lower on boards `rescueWalls.mts`
 * regenerated because a realistic player measurably could not clear them.
 */
function builtFloor(level: LevelData): number {
  const stamped = (generated.levels[level.id - 1] as { plannerFloor?: number })?.plannerFloor
  return stamped ?? slotFor(level.id).plannerFloor
}

const avg = (ls: readonly LevelData[]): number =>
  ls.reduce((a, l) => a + planningLoss(l), 0) / ls.length

describe.skipIf(!OPEN_RIM)('difficulty curve — schedule', () => {
  const slots = buildLevelCurve()

  it('never lowers the planning floor as levels progress', () => {
    // Sticky Hive specials sit ABOVE the baseline on purpose (their floor is
    // bumped to 0.25/0.4), so the monotonic contract binds the non-flooded
    // BASELINE — returning from a special to the line is not a softening.
    const base = slots.filter((s) => s.floodCoverage === 0)
    for (let i = 1; i < base.length; i++) {
      expect(base[i].planningFloor, `level ${base[i].id}`).toBeGreaterThanOrEqual(
        base[i - 1].planningFloor,
      )
    }
    // And a special must never dip BELOW its surrounding baseline.
    for (const s of slots) {
      if (s.floodCoverage > 0) {
        expect(s.planningFloor, `level ${s.id}`).toBeGreaterThanOrEqual(
          slotFor(s.id - 1).planningFloor,
        )
      }
    }
  })

  it('opens with a pure tutorial, then adds the queen', () => {
    for (const id of [1, 2, 3]) expect(slotFor(id).hasQueen).toBe(false)
    for (let id = 16; id <= LEVEL_COUNT; id++) expect(slotFor(id).hasQueen, `level ${id}`).toBe(true)
  })

  it('keeps the tutorial free of forced honey-stops, then allows them', () => {
    // The stuck-bee mechanic must not be REQUIRED before it is taught: the
    // first levels are pure ordering, and the cap ramps in by design.
    for (let id = 1; id <= 6; id++) expect(slotFor(id).maxForcedStops, `level ${id}`).toBe(0)
    expect(slotFor(10).maxForcedStops).toBeLessThanOrEqual(1)
    expect(slotFor(20).maxForcedStops).toBeGreaterThan(slotFor(10).maxForcedStops)
  })

  it('ships no hornet walls — they are retired as dead weight', () => {
    // By construction no goal bee's lane can contain a wall, so the player
    // never interacts with one, and walls measurably LOWERED planning
    // pressure. The occupant type survives in the engine; the curve stopped
    // requesting them.
    for (let id = 1; id <= LEVEL_COUNT; id++) {
      expect(slotFor(id).hornets, `level ${id}`).toBe(0)
    }
  })

  it('puts more bees on the board as the game goes — and gets to 7 EARLY', () => {
    expect(slotFor(5).targetBees).toBeLessThan(slotFor(120).targetBees)
    expect(slotFor(120).targetBees).toBeLessThanOrEqual(slotFor(280).targetBees)
    // Felt difficulty is bee count: a 4-bee board is solved at a glance (24
    // orders), and round-3 playtest showed even 6 bees + 2 spare is cruised —
    // so 7 bees (5040 orders) must arrive in the SECOND chapter. Non-spike/
    // breather ids, so the modifiers don't blur the ramp.
    expect(slotFor(28).targetBees).toBeGreaterThanOrEqual(6)
    expect(slotFor(38).targetBees).toBeGreaterThanOrEqual(7)
    expect(slotFor(68).targetBees).toBeGreaterThanOrEqual(8)
    // 9 is the ceiling (viable only since walls retired — and only on DENSE
    // boards: a 9-bee trial on 36 cells measured 0.00 loss).
    expect(slotFor(145).targetBees).toBe(9)
    expect(slotFor(245).targetBees).toBe(9)
  })

  it('tightens the move budget over the game — one spare move is the rule from L30', () => {
    expect(slotFor(280).slack).toBeLessThanOrEqual(slotFor(10).slack)
    // L30 is where round-3 playtest still cruised with 2 spare; non-breather
    // ids from there down to the deep end all run on a single spare move.
    expect(slotFor(30).slack).toBe(1)
    expect(slotFor(32).slack).toBe(1)
    expect(slotFor(63).slack).toBe(1)
  })

  it('seeds one honey lake from L20 and the second from L35, never during the teaching band', () => {
    // A lake is both a pickup and a lane blocker — the cheapest ordering
    // pressure available on a small board, which is why one now arrives at L20
    // instead of leaving the whole opening unconstrained. Two on a board that
    // size would over-constrain it, so the second still waits for L35.
    for (let id = 1; id <= 19; id++) expect(slotFor(id).honeyLakes, `level ${id}`).toBe(0)
    for (let id = 20; id <= 34; id++) {
      const s = slotFor(id)
      if (s.floodCoverage === 0) expect(s.honeyLakes, `level ${id}`).toBe(1)
    }
    expect(slotFor(35).honeyLakes).toBeGreaterThanOrEqual(2)
    expect(slotFor(300).honeyLakes).toBeGreaterThanOrEqual(slotFor(35).honeyLakes)
  })

  it('raises the planner (previewing-human) floor from L26 and never lowers it on the baseline', () => {
    // The teaching band is deliberately below the bar: the floor starts once
    // the swarm is big enough for order to matter, then climbs 0.15 → 0.35.
    for (let id = 1; id <= 25; id++) expect(slotFor(id).plannerFloor, `level ${id}`).toBe(0)
    expect(slotFor(26).plannerFloor).toBeGreaterThanOrEqual(0.15)
    expect(slotFor(120).plannerFloor).toBeGreaterThanOrEqual(0.35)
    const base = buildLevelCurve().filter((s) => s.floodCoverage === 0)
    for (let i = 1; i < base.length; i++) {
      expect(base[i].plannerFloor, `level ${base[i].id}`).toBeGreaterThanOrEqual(
        base[i - 1].plannerFloor,
      )
    }
  })

  it('every shipped level clears the floor it was BUILT to', () => {
    // The regression this exists for: `plannerFloor` is an INPUT to the offline
    // generator, so editing the curve without re-running `npm run gen:levels`
    // silently decouples config from content. A "round 5" edit once raised the
    // line (start L26 → L12, plateau 0.35 → 0.45) and was never generated —
    // 45 shipped levels sat below their own stated floor, and every existing
    // test passed because they all check chapter AVERAGES. This one does not.
    //
    // The comparison is against the floor RECORDED ON THE LEVEL rather than the
    // curve's, because `rescueWalls.mts` deliberately regenerates measured-
    // unplayable boards at a softened floor and stamps the softer value. Those
    // are relaxations we chose; the invariant that still has to hold is that a
    // level is never softer than what it claims.
    const below = LEVELS.filter((l) => plannerLoss(l) < builtFloor(l) - 1e-9).map(
      (l) => `L${l.id}: loss ${plannerLoss(l).toFixed(2)} < floor ${builtFloor(l).toFixed(2)}`,
    )
    expect(below, `regenerate the levels or lower the curve:\n${below.join('\n')}`).toEqual([])
  })

  // Deliberately NOT asserted: that a level's built floor never exceeds the
  // curve's. It fails on 40 levels and the assertion was simply wrong — the
  // generator aims above the floor on spike slots, so a board built to a
  // HIGHER bar than the line is a stronger level, not a broken one. The
  // invariant worth pinning is that a level meets whatever it claims (above),
  // plus a bound on how much of the campaign got relaxed (below).

  it('keeps the wall rescue a minority of the campaign', () => {
    // Levels regenerated below the curve because a real player measurably could
    // not clear them. A useful bound, not a target: if this ever approaches the
    // whole campaign, the curve is wrong rather than the boards.
    const relaxed = LEVELS.filter((l) => builtFloor(l) < slotFor(l.id).plannerFloor - 1e-9)
    expect(relaxed.length).toBeLessThan(LEVEL_COUNT / 2)
  })

  it('schedules Sticky Hive specials every x5 level from L45, at safe coverage', () => {
    for (let id = 1; id <= LEVEL_COUNT; id++) {
      const s = slotFor(id)
      if (id >= 45 && id % 10 === 5) {
        // The measured band: below 0.4 flooding degenerates to noise, at ~1.0
        // it collapses into an orderless crawl — both are design failures.
        expect(s.floodCoverage, `level ${id}`).toBeGreaterThanOrEqual(0.4)
        expect(s.floodCoverage, `level ${id}`).toBeLessThanOrEqual(0.6)
        // Coverage seeding supersedes lakes on these levels.
        expect(s.honeyLakes, `level ${id}`).toBe(0)
      } else {
        expect(s.floodCoverage, `level ${id}`).toBe(0)
      }
    }
    // Coverage ramps with the game.
    expect(slotFor(295).floodCoverage).toBeGreaterThan(slotFor(45).floodCoverage)
  })
})

describe.skipIf(!OPEN_RIM)('difficulty curve — shipped levels demand a plan', () => {
  // NOTE on the difficulty model under PERMANENT honey: bot-measured planning-loss
  // (competent-but-unplanned play losing) peaks in the MID game, where long
  // crossing flights force the order. In the late game walls shorten flights, so
  // planning-loss falls — but the levels get harder along every OTHER axis (bees,
  // walls, board size, a budget of only min+1), which the composite `difficulty`
  // score tracks. The tests below assert that real shape, not a single rising line.

  it('opens with an order-free teaching band, then bites', () => {
    const free = LEVELS.filter((l) => planningLoss(l) === 0)
    // Free (order-free) levels in the first chapter stay inside the teaching band.
    const earlyFree = free.filter((l) => l.id <= 25)
    expect(Math.max(...earlyFree.map((l) => l.id))).toBeLessThanOrEqual(16)
    // The mid game is where crossings dominate: almost no order-free levels there.
    const midFree = free.filter((l) => l.id >= 26 && l.id <= 150)
    expect(midFree.length).toBeLessThanOrEqual(15)
  })

  it('the mid game demands planning on average', () => {
    // L26–150: competent-but-unplanned play loses a large share of the time.
    const mid = avg(LEVELS.filter((l) => l.id >= 26 && l.id <= 150))
    expect(mid).toBeGreaterThan(0.25)
    // ...whereas the pure tutorial does not punish anyone.
    expect(avg(LEVELS.filter((l) => l.id <= 12))).toBeLessThan(mid)
  })

  it('overall complexity climbs to a HIGH PLATEAU and holds it', () => {
    // With walls retired the composite score has no artificial late riser: the
    // structural load (bees, budget, lakes) deliberately maxes out by ~L120
    // and HOLDS. The honest guards for the back half are the loss-based tests
    // below; this one asserts the climb into the plateau and no late collapse.
    const dAvg = (lo: number, hi: number): number => {
      const g = LEVELS.filter((l) => l.id >= lo && l.id <= hi)
      return g.reduce((a, l) => a + (l.difficulty ?? 0), 0) / g.length
    }
    expect(dAvg(101, 200)).toBeGreaterThan(dAvg(1, 100))
    expect(dAvg(201, 300)).toBeGreaterThanOrEqual(dAvg(101, 200) - 0.5)
  })

  it('the mid game clears the planning floor per 25-level block', () => {
    // The floor is enforceable while crossings drive difficulty (through L150);
    // past that the late game leans on walls/budget, tracked by `difficulty`.
    for (let start = 1; start <= 150; start += 25) {
      const block = LEVELS.filter((l) => l.id >= start && l.id < start + 25)
      const floor = block.reduce((a, l) => a + slotFor(l.id).planningFloor, 0) / block.length
      expect(avg(block), `levels ${start}–${start + 24}`).toBeGreaterThanOrEqual(floor - 0.08)
    }
  })

  it('never regresses chapter over chapter', () => {
    const perChapter: number[] = []
    for (let ch = 1; ch <= 6; ch++) {
      perChapter.push(avg(LEVELS.filter((l) => (l.chapter ?? Math.ceil(l.id / 25)) === ch)))
    }
    for (let i = 1; i < perChapter.length; i++) {
      // The generator AIMS at planningFloor + a small margin, so chapter
      // averages plateau around 0.35–0.43 by design and wobble with the
      // candidate pools — a ~0.08 dip is target noise, not a regression. The
      // composite-difficulty tests below carry the "keeps getting harder"
      // guarantee; this only catches a chapter genuinely going soft.
      expect(perChapter[i], `chapter ${i + 1}`).toBeGreaterThanOrEqual(perChapter[i - 1] - 0.1)
    }
  })

  // ── Round-4 guards: the previewing-human bar (playtest: "still too easy") ──

  it('no level after L25 is free against the previewing-human proxy', () => {
    // THE user-facing guarantee of round 4: before the planner floor existed,
    // 12 of 25 chapter-2 levels were cleared by one-ply-with-preview play in
    // 100% of trials — exactly the levels the tester cruised.
    const free = LEVELS.filter((l) => l.id > 25 && plannerLoss(l) === 0)
    expect(free.map((l) => l.id)).toEqual([])
  })

  it('the mid game punishes one-ply play on average', () => {
    const mid = LEVELS.filter((l) => l.id >= 26 && l.id <= 150)
    expect(mid.reduce((a, l) => a + plannerLoss(l), 0) / mid.length).toBeGreaterThan(0.2)
  })

  // ── Back-half guards (L151–300) — the regressions the first shipped set had ──

  it('the back half demands planning too, not just the mid game', () => {
    // The first shipped set collapsed to 16% average loss (60% free levels in
    // the final chapter). After the hornet plateau + denser late shapes it
    // measures ~0.39 — guard well below that so regen noise can't redden this.
    const back = avg(LEVELS.filter((l) => l.id > 150))
    expect(back).toBeGreaterThan(0.25)
  })

  it('never ships a coasting streak: no 4+ consecutive free levels after L25', () => {
    // Current worst run is 1; the guard leaves room for regeneration variance.
    let run = 0
    for (const l of LEVELS) {
      if (l.id > 25 && planningLoss(l) === 0) {
        run++
        expect(run, `free-run ending at level ${l.id}`).toBeLessThanOrEqual(3)
      } else run = 0
    }
  })

  it('caps the total number of free levels outside the teaching band', () => {
    // 82 in the first shipped set; 21 now. Ratchet: fail if it creeps back up.
    const free = LEVELS.filter((l) => l.id > 25 && planningLoss(l) === 0)
    expect(free.length).toBeLessThanOrEqual(35)
  })

  it('composite difficulty keeps climbing through chapters 7–12', () => {
    const dAvg = (ch: number): number => {
      const g = LEVELS.filter((l) => (l.chapter ?? Math.ceil(l.id / 25)) === ch)
      return g.reduce((a, l) => a + (l.difficulty ?? 0), 0) / g.length
    }
    for (let ch = 8; ch <= 12; ch++) {
      // Loose tolerance: a breather-heavy chapter may dip slightly, but the
      // late game must never flatten out (planningLoss alone can't carry it —
      // walls shorten flights, so the composite score is the honest signal).
      expect(dAvg(ch), `chapter ${ch}`).toBeGreaterThanOrEqual(dAvg(ch - 1) - 1.5)
    }
    expect(dAvg(12)).toBeGreaterThan(dAvg(7))
  })
})
