import { shapeCapacity, type ShapeSpec } from '../systems/boardShapes'

/**
 * The difficulty curve (spec §4). Produces a deterministic spec for each of the
 * 300 levels; the offline generator (scripts/genLevels.ts) turns each slot into
 * a solvability-guaranteed board. Shape and design here, not in the game.
 */
export interface LevelSlot {
  id: number
  chapter: number // 1..12, one per 25 levels
  shape: ShapeSpec
  targetBees: number
  minDepth: number
  maxDepth: number
  slack: number // move budget above the minimum
  threeStarSpare: number // moves that must remain for 3 stars
  rayBias: number
  hasQueen: boolean
  hornets: number
  /**
   * Minimum planning pressure the generated board must reach — the "you must
   * think to win" floor, measured as the share of competent-but-unplanned
   * playthroughs that lose. Rises monotonically with id. 0 during the tutorial.
   */
  planningFloor: number
  /**
   * The pressure the generator AIMS at (>= planningFloor). Spikes aim above the
   * floor, breathers aim right at it — this is what makes the ten-level
   * saw-tooth actually point the right way in the shipped data.
   */
  planningTarget: number
  /**
   * Round-4 floor: minimum loss of the PREVIEWING-HUMAN proxy bot
   * (plannerLossRate — sees every landing, evaluates one ply ahead). The
   * greedy floor above screens candidates cheaply; THIS is the bar that
   * matches the tester who cruised half of chapter 2. A level clearing it
   * demands seeing 2+ plies ahead. 0 through the teaching band.
   */
  plannerFloor: number
  /** Where the generator aims the planner loss (>= plannerFloor). */
  plannerTarget: number
  /**
   * Max forced honey-stops the best line may need (minMoves - goals). 0 during
   * the tutorial so the first levels are pure ordering with no stuck bees;
   * ramps up so the fly-in-and-stick mechanic arrives at a designed moment.
   */
  maxForcedStops: number
  /**
   * Pre-placed honey cells seeded on the board from the start. They cut lanes
   * before a single move is made — a cheap, readable extra ordering constraint
   * the board schema always supported but the generator never used.
   */
  honeyLakes: number
  /**
   * "Sticky Hive" special levels: fraction of FREE cells pre-seeded with honey
   * (0 = normal level). Measured sweet spot is ~0.4–0.6: at ~50% coverage the
   * greedy bot loses 49–94% (carved lanes reseal when flown through — order is
   * everything), while 100% coverage collapses into a one-hex-crawl grind that
   * bots clear mindlessly. Every 10th level (x5 cadence) from L45.
   */
  floodCoverage: number
  /**
   * Generator layout restarts for this slot. Late slots with a high floor need
   * far more samples to find a mid-pressure board (candidates are bimodal),
   * which is what kills the 0% → 74% whiplash between adjacent levels.
   */
  restarts: number
  seed: number
  attempts: number
}

export const LEVEL_COUNT = 300
export const CHAPTER_SIZE = 25
export const CHAPTER_COUNT = LEVEL_COUNT / CHAPTER_SIZE

/**
 * Board-shape pools per chapter, ordered small → large capacity.
 *
 * These are deliberately MODEST in size. The trail only forces an order where
 * flight paths overlap, and paths only overlap on a board that is actually
 * full: an early draft gave chapter 6 a 61-cell hexagon for a dozen bees and
 * every one of them had a private lane, so the hardest levels in the game
 * measured as free. Each chapter's smallest shape is sized to that chapter's
 * bee count at roughly half fill — the shapes change to keep the look moving,
 * not to make the board bigger.
 */
const SHAPE_POOLS: ShapeSpec[][] = [
  // Ch1 — tutorial, tiny boards. The 12-cell rhombus plugs the 10→16 capacity
  // gap: without it, L15–25 all collapse onto the identical 4×4 board.
  [
    { kind: 'triangleUp', size: 2 },
    { kind: 'hexagon', radius: 1 },
    { kind: 'triangleUp', size: 3 },
    { kind: 'rhombus', w: 4, h: 3 },
    { kind: 'rhombus', w: 4, h: 4 },
  ],
  // Ch2 — the 20-cell rhombus gives the 6-bee band (from L30) a second
  // adequate shape, so it can alternate instead of shipping hex2 25× in a row.
  [
    { kind: 'triangleUp', size: 3 },
    { kind: 'triangleDown', size: 4 },
    { kind: 'rhombus', w: 4, h: 4 },
    { kind: 'hexagon', radius: 2 },
    { kind: 'rhombus', w: 5, h: 4 },
  ],
  // Ch3
  [
    { kind: 'triangleUp', size: 4 },
    { kind: 'rhombus', w: 4, h: 4 },
    { kind: 'hexagon', radius: 2 },
    { kind: 'triangleUp', size: 5 },
  ],
  // Ch4
  [
    { kind: 'hexagon', radius: 2 },
    { kind: 'triangleDown', size: 5 },
    { kind: 'triangleUp', size: 5 },
    { kind: 'rhombus', w: 5, h: 5 },
  ],
  // Ch5
  [
    { kind: 'triangleUp', size: 5 },
    { kind: 'rhombus', w: 5, h: 5 },
    { kind: 'triangleUp', size: 6 },
    { kind: 'hexTrimmed', radius: 3 },
  ],
  // Ch6
  [
    { kind: 'rhombus', w: 5, h: 5 },
    { kind: 'triangleDown', size: 6 },
    { kind: 'hexTrimmed', radius: 3 },
    { kind: 'rhombus', w: 6, h: 6 },
  ],
  // Ch7 — the back half (L151+): boards grow to give the extra bees room to cross.
  [
    { kind: 'hexTrimmed', radius: 3 },
    { kind: 'triangleUp', size: 6 },
    { kind: 'rhombus', w: 6, h: 6 },
    { kind: 'hexagon', radius: 3 },
  ],
  // Ch8
  [
    { kind: 'hexTrimmed', radius: 3 },
    { kind: 'triangleUp', size: 6 },
    { kind: 'hexagon', radius: 3 },
    { kind: 'triangleDown', size: 7 },
  ],
  // Ch9–12: every pool used to bottom out at 36+ cells, so the intended late
  // fillTarget (~0.6) was unreachable — measured ch12 fill averaged 40% and the
  // sparse boards played as free (lanes never crossed). Each pool's TWO
  // smallest shapes are now 25–31 cells (a 9-bee trial on a 36-cell board
  // measured 0.00 loss — sparse is free), and the pairs differ per chapter so
  // the look keeps moving.
  // Ch9
  [
    { kind: 'triangleDown', size: 6 },
    { kind: 'hexTrimmed', radius: 3 },
    { kind: 'hexagon', radius: 3 },
    { kind: 'rhombus', w: 7, h: 6 },
  ],
  // Ch10
  [
    { kind: 'rhombus', w: 5, h: 5 },
    { kind: 'triangleUp', size: 6 },
    { kind: 'triangleDown', size: 7 },
    { kind: 'hexTrimmed', radius: 4 },
  ],
  // Ch11
  [
    { kind: 'rhombus', w: 6, h: 5 },
    { kind: 'hexTrimmed', radius: 3 },
    { kind: 'triangleUp', size: 7 },
    { kind: 'rhombus', w: 7, h: 7 },
  ],
  // Ch12 — the deep end: the two densest boards in the game.
  [
    { kind: 'triangleUp', size: 6 },
    { kind: 'hexTrimmed', radius: 3 },
    { kind: 'triangleDown', size: 7 },
    { kind: 'hexagon', radius: 3 },
  ],
]

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Pick a shape from the chapter pool big enough for the bee count — preferring
 * the SMALLEST adequate one.
 *
 * Picking freely among all big-enough shapes made late chapters sprawl, and a
 * sparse board is easier to plan on, not harder: flight paths stop overlapping,
 * so the honey trail never forces an order. Choosing tight keeps the density
 * (and the difficulty) up. The rotor still varies the look by alternating
 * between the two smallest adequate shapes.
 */
function chooseShape(chapter: number, neededCapacity: number, rotor: number): ShapeSpec {
  const pool = SHAPE_POOLS[chapter - 1]
  const big = pool
    .filter((s) => shapeCapacity(s) >= neededCapacity)
    .sort((a, b) => shapeCapacity(a) - shapeCapacity(b))
  // Density guard: never rotate onto a shape that overshoots the needed
  // capacity by ~2×. A too-roomy board is easier, not harder — lanes stop
  // crossing (the 9-bee/36-cell trial measured 0.00 loss) — so if a pool's
  // second-smallest adequate shape sprawls, ship the tight one every time.
  const options =
    big.length > 0
      ? big.slice(0, 2).filter((s, i) => i === 0 || shapeCapacity(s) <= neededCapacity * 1.9)
      : [pool.reduce((a, b) => (shapeCapacity(b) > shapeCapacity(a) ? b : a))]
  return options[rotor % options.length]
}

export function slotFor(id: number): LevelSlot {
  const chapter = Math.ceil(id / CHAPTER_SIZE)
  const p = (id - 1) / (LEVEL_COUNT - 1) // 0..1 across the whole game
  const isSpike = id % 10 === 0
  const isBreather = id % 10 === 1 && id > 1

  // --- Axis 1: BOARD LOAD (how much there is to hold in your head) ---
  // BEE COUNT is what a human FEELS as difficulty: a 4-bee board has 24 orders
  // and is solved at a glance regardless of what the loss-rate bot measures
  // (playtest ground truth: 51 levels cleared "without thinking" on the old
  // 4-bees-until-L75 ramp). 6–7 bees is where the order space (720–5040) stops
  // being eyeball-able — so the ramp gets there in the SECOND chapter, not the
  // fifth. The ceiling stays 8–9 (search-cost limit, see the cap below).
  // 8 is the hard end of the ramp: a 9-bee board with late walls + lakes only
  // generates as forced-stop chaos that measures FREE (greedy stumbles through
  // it as well as a plan does) and takes ~1 min of search per level to verify.
  // The ramp is steep on purpose. Playtest ground truth (round 2): a 5-bee
  // board measuring 0.51 bot-loss was STILL cleared "without thinking" — the
  // loss bot undershoots a human with the aim preview by a mile at low bee
  // counts, so felt difficulty must come from the swarm size itself.
  // Round 3 pushed it further: a 6-bee L36 with 2 spare moves was STILL
  // cruised. 7 bees (5040 orders) + a 1-move budget is where the tester
  // finally had to stop and think, so that combination now arrives AT L36,
  // and the swarm keeps growing to 9 on the larger late boards (walls are
  // retired, so the old 9-bee chaos-board failure mode no longer applies).
  // Round 5 pulled the opening forward too: the shipped set measured EVERY
  // level L1–25 at 0.00 previewing-human loss — twenty-five levels a player who
  // looks one move ahead literally cannot lose. Three bees on a loose board have
  // no order to get wrong, so the swarm now reaches 5 by L13 and 6 by L20
  // instead of dawdling to L26.
  let bees =
    id >= 140 ? 9 :
    id >= 66 ? 8 :
    id >= 36 ? 7 :
    id >= 20 ? 6 :
    // Capped at 5 below L20 on purpose: the queen lands at L16, and handing the
    // player a sixth bee in the same level as the game's harshest rule is two
    // new loads at once. She gets L16–19 to herself, the swarm grows at L20.
    Math.min(5, Math.round(lerp(3, 5, (id - 1) / 12)))
  let depth = Math.round(lerp(1, 7, Math.pow(p, 0.9)))
  // Never zero: a budget with no room at all makes every level demand the exact
  // optimal line, which flattens the measured difficulty at 100% and stops
  // telling us anything about the levels either side of it.
  // But past the opening stretch ONE spare move is the rule: with 2–3 spare a
  // wrong order was absorbable and the puzzle never actually bit. Round-3
  // playtest: even 2 spare let L30–39 be cruised, so the 1-move rule now
  // starts at L30. Undo, +3 Moves and the silent fail-streak bonus are the
  // frustration cushions now.
  // Round 5: 3 spare moves absorbs any ordering mistake, which is precisely why
  // L1–25 measured 0% — the generous budget ran a dozen levels past the point
  // the mechanics were taught. Three spare is now the TUTORIAL's privilege only
  // (L1–11); the rest of the opening runs at 2 and the 1-move rule still starts
  // at L30.
  let slack = id <= 11 ? 3 : id <= 25 ? 2 : 1
  // Ray bias: long flights cross more of the board, so they overlap more other
  // flight paths — which is where the trail actually forces an order. Too strong a
  // pull backfires: it fills the shared lanes so fast that few bees fit, and the
  // ones that do get short forced rays, so the board comes out clean (0% planning).
  // 4.0 is the empirical sweet spot for the mid game's long crossings.
  const rayBias = lerp(2.6, 4.0, p)

  // --- Axis 2: EXTRA ORDERING CONSTRAINTS ---
  // queen = must leave LAST, so she pins one end of the sequence. On every
  // level from L16 on: a queenless-cadence experiment measured 0% planning
  // pressure on ALL 30 queenless boards — at these board sizes she IS the
  // pressure, so variety through her absence just ships free levels.
  const hasQueen = id >= 16
  // wall (hornet) = RETIRED. By construction no goal bee's lane may ever
  // contain a wall (it would make the level unsolvable), so the player never
  // interacts with one — playtest verdict: "walls are just empty cells". They
  // also measurably LOWERED planning pressure (short flights don't cross).
  // Density now comes from smaller boards; ordering from crossings + lakes +
  // the queen. The occupant type stays in the engine for compatibility.
  const hornets = 0

  // Planning pressure floor: how often play that is competent but unplanned
  // must still fail. Flat 0 while the rules are being taught.
  // Planning pressure floor: how often play that is competent but unplanned must
  // still fail. Zero through the tutorial — a board with four bees and honey that
  // dries in two moves simply cannot be made to punish anyone, and demanding it
  // only produces noise in the generation report.
  // The floor is 0 until the queen arrives: pre-queen boards at this size
  // measurably cannot punish a competent player (every generated set shipped
  // L13–15 at 0%), so a 0.1 floor there was pure audit noise. It then climbs
  // FAST — 0.35 by ~L80 and plateaus there: the game should be a real puzzle
  // shortly after the mechanics are taught, not at the halfway mark. (Walls
  // shorten late flights, so candidates top out ~0.3–0.4 loss; a higher floor
  // only produced false "below floor" audit noise.)
  // Round 5 moved the start from L16 to L8. The old zero-band was justified by
  // "boards this size cannot punish anyone" — true of the boards the old curve
  // asked for (3–4 bees, 3 spare), not of the denser, tighter opening above.
  let planningFloor: number
  if (id <= 7) planningFloor = 0
  else planningFloor = clamp(lerp(0.12, 0.4, (id - 8) / 88), 0.12, 0.4)

  // Tutorial (L1–5): one concept at a time, tiny boards, room to be wrong.
  if (id <= 2) {
    bees = 2 + id // L1:3, L2:4
    depth = 0
    slack = 3
  } else if (id <= 5) {
    bees = Math.min(bees, 5)
    depth = Math.min(depth, 1)
    slack = 3
  } else if (id >= 12 && id <= 15) {
    // Pre-queen ramp: 3–4-bee boards here cannot generate any ordering pressure,
    // so the player used to hit the L16 queen wall with 15 entirely free levels
    // behind them. Five bees + a snugger budget lets L12–15 build mild pressure
    // BEFORE the queen (with 3 spare moves, unplanned play simply never lost).
    bees = Math.max(bees, 5)
    slack = Math.min(slack, 2)
  } else if (id >= 16 && id <= 25) {
    // Queen-intro band keeps 5 bees: she IS the new load, and the board should
    // not shrink the moment she appears.
    bees = Math.max(bees, 5)
  }

  // Spikes every 10th level: a tighter budget and a deeper dependency chain.
  if (isSpike) {
    depth += 1
    slack = Math.max(1, slack - 1)
  } else if (isBreather && id > 5) {
    // Ease the LOAD after a spike, but keep the mechanics — a breather is a
    // lighter board, never a free one. One bee lighter, not three: dropping a
    // 6-bee board back to 4 made breathers glance-solvable all over again.
    bees = Math.max(4, bees - 1)
    depth = Math.max(1, depth - 1)
    slack += 1
  }

  // Queen introduction band: guarantee breathing room in the budget while the
  // player learns the game's harshest rule, so the generator can pick a
  // mid-pressure board instead of the 0%-or-43% cliff the old curve shipped.
  // Applied AFTER the spike adjustment on purpose: the L20 spike sits inside
  // the band, and the intro guarantee outranks one spike's tightness.
  // Lowered from 3 spare to 2: the old guarantee was the single biggest reason
  // the queen band shipped at 0% planner loss. The band still spans L16–22
  // rather than shrinking, because the L20 spike sits inside it and would
  // otherwise land on 1 spare — six bees, a queen and a lake on one spare move
  // is the cliff this band exists to prevent.
  if (id >= 16 && id <= 22) slack = Math.max(slack, 2)

  // The bee cap is a search-cost limit, not a design one: validating a board
  // means proving a perfect order exists, and the state space grows fast with
  // bee count under permanent honey. The old ceiling was 8 because 9-bee
  // boards WITH walls + lakes only generated as forced-stop chaos; with walls
  // retired the 9-bee band generates clean mid-pressure boards (trialed
  // before adoption), so the deep end now runs at 9.
  const beeCap = 9
  bees = clamp(bees, 3, beeCap)
  slack = clamp(slack, 1, 4)
  const minDepth = clamp(depth - 1, 0, 14)
  const maxDepth = clamp(depth + 1, minDepth + 1, 16)

  // 3-star demands most of the (small) slack — near-perfect play.
  const spareFrac = lerp(0.5, 1.0, p)
  const threeStarSpare = clamp(Math.round(slack * spareFrac), 0, slack)

  // "Sticky Hive" cadence: every x5 level from L45 is a half-flooded special —
  // the board starts 40→60% covered in honey and the player carves it clean.
  // Mid-decade on purpose: spikes are x0, breathers x1, so the special never
  // collides with either. Coverage ramps but NEVER approaches 1.0 (the
  // measured grind cliff).
  const isFlooded = id >= 45 && id % 10 === 5
  const floodCoverage = isFlooded ? clamp(lerp(0.4, 0.6, (id - 45) / 155), 0.4, 0.6) : 0

  // Pre-placed honey lakes: none while the trail itself is being taught, TWO
  // afterwards — never three. A 3-lake experiment (L95–159) produced 11 free
  // levels in one chapter: the third lake cuts so many lanes that even
  // unplanned play is FORCED into a good order, which helps the player. Two
  // lakes constrain without solving the level for them. Flooded levels seed
  // their honey via floodCoverage instead.
  // Round 5 brings ONE lake forward to L20. A lake is both a pickup and a lane
  // blocker, so it is the cheapest ordering pressure available on a small board
  // — exactly what the opening lacked. The second still waits for L35, since two
  // lakes on a tutorial-sized board over-constrain it.
  const honeyLakes = isFlooded ? 0 : id < 20 ? 0 : id < 35 ? 1 : 2

  // Density: paths have to overlap for the trail to bite, and they only overlap
  // on a board that is actually full. Loose early, packed late. Lakes count at
  // half weight — they occupy cells but bees still fly over/into them.
  const fillTarget = lerp(0.45, 0.62, p)
  const neededCapacity = Math.ceil((bees + hornets + honeyLakes / 2) / fillTarget)
  const shape = chooseShape(chapter, neededCapacity, id)

  // Where the generator should LAND, not just the floor it must clear. Spikes
  // aim above the floor, breathers right at it — the saw-tooth, right way up.
  let planningTarget = planningFloor + 0.08
  if (isSpike) planningTarget = planningFloor + 0.15
  else if (isBreather && id > 5) planningTarget = planningFloor + 0.02
  // Queen introduction: aim as gently as the floor allows — the rule itself is
  // the lesson, and the 0.4-loss boards the old curve shipped here were a wall.
  if (id >= 16 && id <= 18) planningTarget = planningFloor + 0.05
  // Sticky Hive levels naturally measure hotter (49–94% at half coverage) —
  // aim them there. The first two introduce the twist gently.
  if (isFlooded) {
    planningFloor = Math.max(planningFloor, id <= 55 ? 0.25 : 0.4)
    planningTarget = planningFloor + 0.1
  }
  planningTarget = clamp(planningTarget, 0, 0.6)

  // Planner (previewing-human) floor — the round-4 bar. Measured before it
  // existed: chapter 2 averaged 21% with HALF its levels at 0% (the tester
  // cruised them); chapters 8-12 already measured 56-72%, so the floor binds
  // exactly where the game was soft. Climbs 0.15 → 0.35 by ~L120. Spikes aim
  // higher, breathers at the line — same saw-tooth as the greedy metric.
  // Round 5 rewrite. Two things were wrong with the old line. It started at L26,
  // leaving 25 levels that a one-ply player provably never loses (measured: all
  // 25 at exactly 0.00). And its 0.35 plateau was decorative — the back half
  // measured 0.72–0.75 against it, so the floor bound nothing where it claimed
  // to bind hardest. It now starts once honey has been taught (L12) and
  // plateaus at 0.45, which the deep end already clears comfortably.
  // Held flat across L12–18 rather than ramping and then dipping for the queen:
  // her rule is the lesson at L16, and stacking a lookahead demand on top of it
  // is what made L16 a wall before. A flat shelf gives her that room while
  // keeping the floor monotonic, which the curve is required to be.
  let plannerFloor = 0
  if (id >= 12) plannerFloor = 0.08
  if (id >= 19) plannerFloor = clamp(lerp(0.13, 0.45, (id - 19) / 91), 0.13, 0.45)
  if (isFlooded) plannerFloor = Math.max(plannerFloor, id <= 55 ? 0.2 : 0.3)
  let plannerTarget = plannerFloor + (isSpike ? 0.18 : isBreather ? 0.02 : 0.1)
  plannerTarget = clamp(plannerTarget, 0, 0.7)

  // Forced honey-stops allowed in the optimal line. The tutorial must be pure
  // ordering — the old data REQUIRED fly-into-honey-and-retap from level 1.
  // Slightly looser late: denser swarms + honey lakes legitimately need it.
  // The 8/9-bee bands get 6: at that density some seeds simply have no 5-stop
  // board within the restart budget (L177 hard-failed a full run at cap 5).
  // NOT 7: a 7-stop board is stumble-through chaos (an L200 trial at cap 7
  // measured 0.04 loss) — the adaptive cap+1 retry covers pathological seeds.
  const maxForcedStops = id <= 6 ? 0 : id <= 10 ? 1 : id <= 15 ? 2 : id >= 100 ? 6 : 5

  // Late slots hunt a rarer target (bimodal candidates), so give them samples.
  // The ramp/queen-intro band (L13–30) also gets extra: its floors are mild but
  // small queen boards are 0%-or-40% bimodal, and the intro should land between.
  // The 8-bee band without walls tangles more (fewer blockers → longer rays →
  // more crossings), so it gets the deepest search of all.
  let restarts =
    id >= 140 ? 232 : planningFloor >= 0.2 ? 144 : planningFloor >= 0.1 && id >= 100 ? 96 : id >= 6 && id <= 30 ? 96 : 44
  // The queen's very first levels hunt the rarest boards of all: mid-pressure
  // (~0.2) queen introductions, so the L15→L16 jump is a step, not a cliff.
  if (id >= 16 && id <= 18) restarts = 192
  // Flooded candidates are pricier to search; the quick-accept exit does the
  // heavy lifting, the restart pool just needs to be deep enough to find one
  // above-floor board.
  if (isFlooded) restarts = 96

  return {
    id,
    chapter,
    shape,
    targetBees: bees,
    minDepth,
    maxDepth,
    slack,
    threeStarSpare,
    rayBias,
    hasQueen,
    hornets,
    planningFloor,
    planningTarget,
    plannerFloor,
    plannerTarget,
    maxForcedStops,
    honeyLakes,
    floodCoverage,
    restarts,
    seed: (1000 + id * 7919) >>> 0,
    attempts: 500,
  }
}

export function buildLevelCurve(): LevelSlot[] {
  const slots: LevelSlot[] = []
  for (let id = 1; id <= LEVEL_COUNT; id++) slots.push(slotFor(id))
  return slots
}
