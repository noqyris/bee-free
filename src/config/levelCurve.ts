import { shapeCapacity, type ShapeSpec } from '../systems/boardShapes'

/**
 * The difficulty curve (spec §4). Produces a deterministic spec for each of the
 * 150 levels; the offline generator (scripts/genLevels.ts) turns each slot into
 * a solvability-guaranteed board. Shape and design here, not in the game.
 */
export interface LevelSlot {
  id: number
  chapter: number // 1..6, one per 25 levels
  shape: ShapeSpec
  targetBees: number
  minDepth: number
  maxDepth: number
  slack: number // move budget above the minimum
  threeStarSpare: number // moves that must remain for 3 stars
  rayBias: number
  hasQueen: boolean
  hornets: number
  /** Moves a flown-over cell stays sticky. THE difficulty knob (see below). */
  dryMoves: number
  /**
   * Minimum planning pressure the generated board must reach — the "you must
   * think to win" floor, measured as the share of competent-but-unplanned
   * playthroughs that lose. Rises monotonically with id. 0 during the tutorial.
   */
  planningFloor: number
  seed: number
  attempts: number
}

export const LEVEL_COUNT = 150
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
  // Ch1 — tutorial, tiny boards
  [
    { kind: 'triangleUp', size: 2 },
    { kind: 'hexagon', radius: 1 },
    { kind: 'triangleUp', size: 3 },
    { kind: 'rhombus', w: 4, h: 4 },
  ],
  // Ch2
  [
    { kind: 'triangleUp', size: 3 },
    { kind: 'triangleDown', size: 4 },
    { kind: 'rhombus', w: 4, h: 4 },
    { kind: 'hexagon', radius: 2 },
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

  // --- Axis 1: BOARD LOAD (how much there is to hold in your head) ---
  // Bee count, dependency depth, budget tightness. Front-loaded (exponent < 1)
  // so real puzzles start early instead of after a long trivial stretch.
  const load = Math.pow(p, 0.8)
  let bees = Math.round(lerp(3, 16, load))
  let depth = Math.round(lerp(1, 7, Math.pow(p, 0.9)))
  // Never zero: a budget with no room at all makes every level demand the exact
  // optimal line, which flattens the measured difficulty at 100% and stops
  // telling us anything about the levels either side of it.
  let slack = Math.max(1, Math.round(lerp(3, 1, p)))
  // Ray bias: long flights cross more of the board, so they overlap more other
  // flight paths — which is where the trail actually forces an order.
  const rayBias = lerp(2.6, 4.0, p)

  // --- Axis 2: THE HONEY TRAIL (how long your own mess stays in the way) ---
  // Every flight smears honey over the cells it crosses, sticky for `dryMoves`
  // more moves. One move of stickiness only forbids flying two crossing paths
  // back to back; five means a third of the board is a no-go zone at any time
  // and the whole sequence has to be planned. This is the difficulty.
  // Four moves of stickiness is already the ceiling in practice: at five, most
  // layouts stop being clearable in anything near one tap per bee, so the only
  // boards that survive validation are the freak sparse ones — i.e. the easy
  // ones. Past this point difficulty has to come from bee count and density.
  let dryMoves = 1
  if (id >= 8) dryMoves = 2
  if (id >= 20) dryMoves = 3
  if (id >= 70) dryMoves = 4

  // --- Axis 3: EXTRA ORDERING CONSTRAINTS ---
  // queen  = must leave LAST, so she pins one end of the sequence.
  // hornet = a permanent wall; shortens flights and splits the board.
  let hasQueen = false
  let hornets = 0
  if (id >= 16) hasQueen = true
  if (id >= 30) hornets = 1
  if (id >= 90) hornets = 2
  if (id >= 130) hornets = 3

  // Planning pressure floor: how often play that is competent but unplanned
  // must still fail. Flat 0 while the rules are being taught.
  // Planning pressure floor: how often play that is competent but unplanned must
  // still fail. Zero through the tutorial — a board with four bees and honey that
  // dries in two moves simply cannot be made to punish anyone, and demanding it
  // only produces noise in the generation report.
  let planningFloor: number
  if (id <= 19) planningFloor = 0
  else planningFloor = clamp(lerp(0.15, 0.55, (id - 20) / (LEVEL_COUNT - 20)), 0.12, 0.6)

  // Tutorial (L1–5): one concept at a time, tiny boards, room to be wrong.
  if (id <= 2) {
    bees = 2 + id // L1:3, L2:4
    depth = 0
    slack = 3
  } else if (id <= 5) {
    bees = Math.min(bees, 5)
    depth = Math.min(depth, 1)
    slack = 3
  }

  // Spikes every 10th level: stickier honey and a tighter budget.
  if (isSpike) {
    dryMoves += 1
    depth += 1
    slack = Math.max(1, slack - 1)
  } else if (isBreather && id > 5) {
    // Ease the LOAD after a spike, but keep the mechanics — a breather is a
    // lighter board, never a free one.
    bees = Math.max(4, bees - 3)
    depth = Math.max(1, depth - 1)
    slack += 1
    hornets = Math.max(0, hornets - 1)
  }

  // The bee cap is a search-cost limit, not a design one: validating a board
  // means proving a perfect order exists, and the state space grows with both
  // bee count and stickiness. Long trails buy difficulty far more cheaply than
  // extra bees do, so the cap tightens as dryMoves rises.
  const beeCap = dryMoves >= 5 ? 13 : dryMoves >= 4 ? 14 : 15
  bees = clamp(bees, 3, beeCap)
  slack = clamp(slack, 1, 4)
  dryMoves = clamp(dryMoves, 1, 6)
  const minDepth = clamp(depth - 1, 0, 14)
  const maxDepth = clamp(depth + 1, minDepth + 1, 16)

  // 3-star demands most of the (small) slack — near-perfect play.
  const spareFrac = lerp(0.5, 1.0, p)
  const threeStarSpare = clamp(Math.round(slack * spareFrac), 0, slack)

  // Density: paths have to overlap for the trail to bite, and they only overlap
  // on a board that is actually full. Loose early, packed late.
  const fillTarget = lerp(0.45, 0.62, p)
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
    dryMoves,
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
