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

/** Pick a shape from the chapter pool big enough for the bee count. */
function chooseShape(chapter: number, neededCapacity: number, rotor: number): ShapeSpec {
  const pool = SHAPE_POOLS[chapter - 1]
  const big = pool.filter((s) => shapeCapacity(s) >= neededCapacity)
  const options =
    big.length > 0
      ? big
      : [pool.reduce((a, b) => (shapeCapacity(b) > shapeCapacity(a) ? b : a))]
  return options[rotor % options.length]
}

export function slotFor(id: number): LevelSlot {
  const chapter = Math.ceil(id / CHAPTER_SIZE)
  const p = (id - 1) / (LEVEL_COUNT - 1) // 0..1 across the whole game
  const isSpike = id % 10 === 0
  const isBreather = id % 10 === 1 && id > 1

  // Bee count ramps 3 → ~30, front-loaded (exponent < 1) so real puzzles start
  // early instead of after a long trivial stretch.
  let bees = Math.round(lerp(3, 30, Math.pow(p, 0.7)))
  // Dependency depth ramps 1 → ~8: even early non-tutorial levels force ordering.
  let depth = Math.round(lerp(1, 8, Math.pow(p, 0.9)))
  // Slack (moves above the minimum): tight throughout, near-perfect play late.
  let slack = Math.round(lerp(3, 0.4, p))
  // Ray bias: long rays cross more bees → fewer "free at start" bees, harder scan.
  const rayBias = lerp(2.3, 3.6, p)

  // Saw-tooth: a spike every 10th level, a breather right after it.
  if (isSpike) {
    bees += 3
    depth += 1
  } else if (isBreather) {
    bees = Math.max(3, bees - 2)
    depth = Math.max(1, depth - 1)
    slack += 1
  }

  // Tutorial (L1–6): gentle and one concept at a time, but NOT trivial — a small
  // forced order appears by L3 so the core "read the arrow / order matters" idea
  // is taught, not just clicked through.
  if (id <= 3) {
    bees = Math.min(bees, 2 + id) // L1:3, L2:4-ish clamp
    depth = id <= 2 ? 0 : 1
    slack = Math.max(slack, 2)
  } else if (id <= 6) {
    depth = Math.min(depth, 2)
    slack = Math.max(slack, 2)
  }

  // Obstacles (decided before the depth band / budget so those stay consistent):
  //  - Queen (must leave last) from L12 on ~a third of levels.
  //  - Hornets (permanent walls) ramping in from L22.
  let hasQueen = id >= 12 && (id % 3 === 0 || isSpike)
  let hornets = 0
  if (id >= 22) hornets = 1
  if (id >= 60) hornets = 2
  if (id >= 110) hornets = 3
  if (isBreather) hornets = Math.max(0, hornets - 1) // ease off on relief levels

  // Honey "puzzle" levels (every 5th from L40): a bee flying through honey gets
  // stuck, breaking greedy-monotonicity and forcing real ordering. Kept small
  // and free of queen/hornets so the search validator stays fast and the
  // strategic mechanic reads clearly.
  let honey = 0
  if (id >= 40 && id % 5 === 0) {
    honey = id >= 100 ? 2 : 1
    bees = Math.min(bees, 9)
    hornets = 0
    hasQueen = false
    depth = Math.max(depth, 2)
  }

  bees = clamp(bees, 3, 34)
  slack = clamp(slack, 0, 4)
  const minDepth = clamp(depth - 1, 0, 14)
  const maxDepth = clamp(depth + 1, minDepth + 1, 16)

  // 3-star always demands most of the (small) slack — near-perfect play.
  const spareFrac = lerp(0.5, 1.0, p)
  const threeStarSpare = clamp(Math.round(slack * spareFrac), 0, slack)

  const fillTarget = honey > 0 ? 0.52 : 0.46
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
    seed: (1000 + id * 7919) >>> 0,
    attempts: 500,
  }
}

export function buildLevelCurve(): LevelSlot[] {
  const slots: LevelSlot[] = []
  for (let id = 1; id <= LEVEL_COUNT; id++) slots.push(slotFor(id))
  return slots
}
