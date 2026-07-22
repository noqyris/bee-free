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

  // Bee count ramps 2 → ~30, front-loaded slightly.
  let bees = Math.round(lerp(2, 30, Math.pow(p, 0.85)))
  // Dependency depth ramps 0 → ~6.5.
  let depth = Math.round(6.5 * Math.pow(p, 1.1))
  // Slack shrinks from forgiving to tight.
  let slack = Math.round(lerp(7, 1, p))
  // Ray bias deepens chains later in the game.
  const rayBias = lerp(1.5, 3.0, p)

  // Saw-tooth: a spike every 10th level, a breather right after it.
  if (isSpike) {
    bees += 3
    depth += 1
    slack = Math.max(1, slack - 1)
  } else if (isBreather) {
    bees = Math.max(2, bees - 2)
    depth = Math.max(0, depth - 1)
    slack += 2
  }

  // Tutorial (L1–8): one concept at a time, and L1–5 are practically unfailable.
  if (id <= 8) {
    bees = Math.min(bees, 2 + id)
    depth = Math.min(depth, id <= 4 ? 0 : 1)
  }
  if (id <= 5) slack = Math.max(slack, 8)

  bees = clamp(bees, 2, 34)
  const minDepth = clamp(depth - 1, 0, 12)
  const maxDepth = clamp(depth + 1, minDepth, 14)

  // 3-star tightens: early wins are easy 3-stars, late ones demand near-perfection.
  const spareFrac = lerp(0.15, 1.0, p)
  const threeStarSpare = clamp(Math.round(slack * spareFrac), 0, slack)

  const neededCapacity = Math.ceil(bees / 0.42)
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
    seed: (1000 + id * 7919) >>> 0,
    attempts: 500,
  }
}

export function buildLevelCurve(): LevelSlot[] {
  const slots: LevelSlot[] = []
  for (let id = 1; id <= LEVEL_COUNT; id++) slots.push(slotFor(id))
  return slots
}
