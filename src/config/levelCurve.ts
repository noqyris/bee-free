import { shapeCapacity, type ShapeSpec } from '../systems/boardShapes'

/**
 * The v1 difficulty curve (spec §4). Produces a deterministic spec for each of
 * the 150 levels; the offline generator (scripts/genLevels.ts) turns each slot
 * into a solvability-guaranteed board. Shape and design here, not in the game.
 */
export interface LevelSlot {
  id: number
  chapter: number // 1..6, one per 25 levels
  shape: ShapeSpec
  targetBees: number
  minDepth: number
  maxDepth: number
  slack: number // move budget above the bee count
  threeStarSpare: number // moves that must remain for 3 stars
  rayBias: number
  hasQueen: boolean
  hornets: number
  honey: number
  /**
   * Minimum careless-loss the generated board must reach — the "you must think
   * to win" floor. Rises monotonically with id so each level punishes mindless
   * play at least as much as the ones before it. 0 during the tutorial.
   */
  planningFloor: number
  seed: number
  attempts: number
}

export const LEVEL_COUNT = 150
export const CHAPTER_SIZE = 25
export const CHAPTER_COUNT = LEVEL_COUNT / CHAPTER_SIZE

/** Board-shape pools per chapter, ordered small → large capacity. */
const SHAPE_POOLS: ShapeSpec[][] = [
  // Ch1 — tutorial, tiny boards
  [
    { kind: 'hexagon', radius: 1 },
    { kind: 'triangleUp', size: 2 },
    { kind: 'rhombus', w: 4, h: 4 },
    { kind: 'hexagon', radius: 2 },
  ],
  // Ch2
  [
    { kind: 'triangleUp', size: 3 },
    { kind: 'hexagon', radius: 2 },
    { kind: 'rhombus', w: 5, h: 5 },
    { kind: 'hexagon', radius: 3 },
  ],
  // Ch3
  [
    { kind: 'triangleUp', size: 4 },
    { kind: 'triangleDown', size: 4 },
    { kind: 'hexTrimmed', radius: 3 },
    { kind: 'rhombus', w: 6, h: 6 },
    { kind: 'hexagon', radius: 3 },
  ],
  // Ch4
  [
    { kind: 'triangleUp', size: 5 },
    { kind: 'hexagon', radius: 3 },
    { kind: 'rhombus', w: 7, h: 7 },
    { kind: 'hexTrimmed', radius: 4 },
  ],
  // Ch5
  [
    { kind: 'triangleUp', size: 6 },
    { kind: 'rhombus', w: 7, h: 7 },
    { kind: 'hexTrimmed', radius: 4 },
    { kind: 'hexagon', radius: 4 },
  ],
  // Ch6
  [
    { kind: 'rhombus', w: 8, h: 8 },
    { kind: 'hexagon', radius: 4 },
    { kind: 'hexTrimmed', radius: 5 },
    { kind: 'hexagon', radius: 5 },
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
 * Picking freely among all big-enough shapes made late chapters sprawl: bee
 * count is capped at 12 on honey boards, so a radius-5 hexagon left the board
 * mostly empty, and a sparse board is easier to plan on, not harder. Choosing
 * tight keeps the density (and the difficulty) up. The rotor still varies the
 * look by alternating between the two smallest adequate shapes.
 */
function chooseShape(chapter: number, neededCapacity: number, rotor: number): ShapeSpec {
  const pool = SHAPE_POOLS[chapter - 1]
  const big = pool
    .filter((s) => shapeCapacity(s) >= neededCapacity)
    .sort((a, b) => shapeCapacity(a) - shapeCapacity(b))
  const options =
    big.length > 0
      ? big.slice(0, 2)
      : [pool.reduce((a, b) => (shapeCapacity(b) > shapeCapacity(a) ? b : a))]
  return options[rotor % options.length]
}

export function slotFor(id: number): LevelSlot {
  const chapter = Math.ceil(id / CHAPTER_SIZE)
  const p = (id - 1) / (LEVEL_COUNT - 1) // 0..1 across the whole game
  const isSpike = id % 10 === 0
  const isBreather = id % 10 === 1 && id > 1

  // --- Axis 1: COGNITIVE LOAD (how hard the planning is) ---
  // Bee count, dependency depth, budget tightness. Front-loaded (exponent < 1)
  // so real puzzles start early instead of after a long trivial stretch. This
  // is the axis that rises "harder and harder" for an engaged player.
  const load = Math.pow(p, 0.85)
  let bees = Math.round(lerp(3, 32, load))
  let depth = Math.round(lerp(1, 8, Math.pow(p, 0.92)))
  let slack = Math.round(lerp(3, 0, p)) // 3 → 0: near-perfect play demanded late
  // Ray bias: long rays cross more bees → fewer "free at start" bees, harder scan.
  const rayBias = lerp(2.3, 3.7, p)

  // --- Axis 2: PLANNING PRESSURE (does a competent player have to think?) ---
  // Measured as smart-greedy loss: how often play that never bumps, never frees
  // the queen early, and prefers a clean escape STILL fails for want of a plan.
  //
  // This replaced an earlier careless-loss (random-play) target, which was
  // measuring the wrong thing: on a honey-free board "tap any clear bee, queen
  // last" always wins, so those levels scored ~96% and played as free. Honey is
  // the only mechanic that breaks that monotonicity — a legal move can strand
  // you — so honey, not the queen, is what carries difficulty here.
  let planningFloor: number
  if (id <= 13) planningFloor = 0 // teaching band: mechanics introduced, no pressure
  else planningFloor = clamp(lerp(0.2, 0.62, (id - 14) / (LEVEL_COUNT - 14)), 0.15, 0.7)

  // --- Mechanic schedule ---
  // honey  = a bee flying through it gets STUCK and becomes a blocker → order
  //          matters and a legal move can strand you. THE difficulty mechanic.
  // queen  = must leave LAST. Free on its own, but it constrains honey ordering,
  //          so it is spice on top of honey rather than the main course.
  // hornet = a permanent wall.
  let honey = 0
  let hasQueen = false
  let hornets = 0

  // Honey density is the primary ramp — more cells, more ways to strand.
  if (id >= 4) honey = 1
  if (id >= 20) honey = 2
  if (id >= 55) honey = 3
  if (id >= 100) honey = 4
  if (id >= 14) hasQueen = true
  if (id >= 14 && id <= 19) honey = 1 // queen introduced, honey stays on

  // Hornet walls layer on from L30, more as the game goes.
  if (id >= 30) hornets = 1
  if (id >= 90) hornets = 2
  if (id >= 130) hornets = 3

  // Tutorial (L1–6): one concept at a time, gentle, no trap floor. Forced order
  // by L3; honey introduced softly at L4–6 on tiny boards.
  if (id <= 3) {
    bees = Math.min(bees, 2 + id) // L1:3, L2:4, L3:5
    depth = id <= 2 ? 0 : 1
    slack = Math.max(slack, 2)
    honey = 0
    hasQueen = false
  } else if (id <= 6) {
    depth = Math.min(depth, 2)
    slack = Math.max(slack, 2)
    hasQueen = false
  }

  // Spikes every 10th level: an extra honey cell and a tighter budget. (An
  // earlier design made spikes big honey-FREE boards; those turned out to be
  // free wins for anyone who knows the rules, however many bees they held.)
  if (isSpike && id >= 20) {
    honey += 1
    depth += 1
    slack = Math.max(0, slack - 1)
  } else if (isSpike) {
    bees += 2
    depth += 1
  } else if (isBreather && id > 6) {
    // Ease the LOAD after a spike, but keep the mechanics — a breather is a
    // lighter board, never a free one.
    bees = Math.max(4, bees - 3)
    depth = Math.max(1, depth - 1)
    slack += 1
    hornets = Math.max(0, hornets - 1)
  }

  // Honey needs a reasonably packed board to be able to strand anyone, and a
  // tight budget so a wasted detour actually costs the level.
  //
  // The bee cap exists because the BFS validator is exponential-ish in goal
  // count, but it must keep rising or the endgame runs out of ramp: with bees
  // pinned at 12, chapters 5 and 6 came out identical. Generation is ~26s
  // sharded across cores, so there is headroom to let it grow.
  if (honey > 0 && id > 6) {
    depth = Math.max(depth, 2)
    const cap = id >= 110 ? 16 : id >= 75 ? 14 : 12
    bees = clamp(Math.max(bees, 8), 3, hasQueen ? cap : cap + 2)
    slack = Math.min(slack, id >= 100 ? 0 : id >= 30 ? 1 : 2)
  }

  bees = clamp(bees, 3, 34)
  slack = clamp(slack, 0, 4)
  const minDepth = clamp(depth - 1, 0, 14)
  const maxDepth = clamp(depth + 1, minDepth + 1, 16)

  // 3-star always demands most of the (small) slack — near-perfect play.
  const spareFrac = lerp(0.5, 1.0, p)
  const threeStarSpare = clamp(Math.round(slack * spareFrac), 0, slack)

  // Honey-only boards need to be DENSE to bite; honey+queen needs a little room;
  // plain boards are loosest.
  // Honey boards are packed tighter: stranding needs neighbours to strand into.
  const fillTarget = honey > 0 ? (hasQueen ? 0.54 : 0.62) : 0.46
  const neededCapacity = Math.ceil((bees + hornets) / fillTarget)
  const shape = chooseShape(chapter, neededCapacity, id)

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
    honey,
    planningFloor,
    seed: (1000 + id * 7919) >>> 0,
    attempts: 500,
  }
}

export function buildLevelCurve(): LevelSlot[] {
  const slots: LevelSlot[] = []
  for (let id = 1; id <= LEVEL_COUNT; id++) slots.push(slotFor(id))
  return slots
}
