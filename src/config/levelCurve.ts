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
  carelessFloor: number
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

  // --- Axis 2: TRAP DENSITY (how much mindless play is punished) ---
  // A monotone floor on careless-loss = the "you must think to win" guarantee.
  // Data (scripts/probe.ts): honey ALONE tops out ~45% careless-loss (and only
  // on dense boards); the QUEEN (must-leave-last) reliably drives it to ~95%.
  // So the queen is the difficulty spine; honey stacks on top for planning
  // depth. The teaching bands (honey, then queen) carry gentler floors.
  // Honey ALONE can't guarantee a floor, so its teaching band (L7–13) carries
  // none — it just introduces the mechanic. The floor turns on at L14 with the
  // queen, then climbs monotonically to the endgame.
  let carelessFloor: number
  if (id <= 13) carelessFloor = 0
  else if (id <= 19) carelessFloor = lerp(0.4, 0.48, (id - 14) / 5) // queen-teach
  else carelessFloor = clamp(lerp(0.55, 0.88, (id - 20) / (LEVEL_COUNT - 20)), 0.5, 0.9)

  // --- Mechanic schedule: teach each in isolation, then stack forever ---
  // honey  = a bee flying through it gets STUCK and becomes a blocker → order
  //          matters, a legal move can strand you (breaks greedy-monotonicity).
  // queen  = a goal that must leave LAST — the reliable think-or-lose spine.
  // hornet = a permanent wall.
  //   L4–13  honey solo (learn honey)
  //   L14–19 queen solo (learn the queen)
  //   L20+   honey + queen together, the deep puzzle, on every level
  let honey = 0
  let hasQueen = false
  let hornets = 0

  if (id >= 4) honey = 1
  if (id >= 51) honey = 2
  if (id >= 126) honey = 3
  if (id >= 14) hasQueen = true
  if (id >= 14 && id <= 19) honey = 0 // queen taught solo in her intro band

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

  // Showcase spikes every 10th level from L40: a BIG scan-and-nerve board —
  // many bees, queen-last, tight budget, no honey. A different flavour of hard
  // (breadth + budget pressure) that ramps raw bee-count load, interleaved with
  // the deep honey+queen ordering puzzles.
  if (isSpike && id >= 40) {
    honey = 0
    hasQueen = true
    bees = clamp(Math.round(lerp(18, 34, p)) + 2, 16, 34)
    depth += 1
  } else if (isSpike) {
    bees += 3
    depth += 1
  } else if (isBreather && id > 6) {
    // Ease the LOAD after a spike, but keep the mechanics (and thus the trap
    // floor) — a breather is a lighter board, never a mindless one.
    bees = Math.max(4, bees - 3)
    depth = Math.max(1, depth - 1)
    slack += 1
    hornets = Math.max(0, hornets - 1)
  }

  // Honey-only (no queen): careless-loss comes only from stranding deadlocks,
  // which need a DENSE board — so pack bees in and keep the budget tight.
  const honeyOnly = honey > 0 && !hasQueen
  if (honeyOnly && id > 6) {
    bees = clamp(Math.max(bees, 10), 3, 14)
    slack = Math.min(slack, 1)
  }

  // Honey boards drive a full BFS validator, so cap the bee count to keep it
  // fast — tighter when a queen is also present (the heaviest search). A honey
  // misstep can strand you, so honey+queen keeps at least a one-move margin.
  if (honey > 0) {
    depth = Math.max(depth, 2)
    bees = Math.min(bees, hasQueen ? 12 : 14)
    if (hasQueen) slack = Math.max(slack, 1)
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
  const fillTarget = honeyOnly ? 0.62 : honey > 0 ? 0.5 : 0.46
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
    carelessFloor,
    seed: (1000 + id * 7919) >>> 0,
    attempts: 500,
  }
}

export function buildLevelCurve(): LevelSlot[] {
  const slots: LevelSlot[] = []
  for (let id = 1; id <= LEVEL_COUNT; id++) slots.push(slotFor(id))
  return slots
}
