import { axialKey, DIRECTION_VECTORS } from './HexGrid'
import { analyzeBoard, type BoardMetrics, type SolverBee } from './Solver'
import { BoardState } from './BoardState'
import { plannerLossRate, searchMinMoves, smartGreedyLossRate } from './SolverSearch'
import { makeRng, mixSeed, weightedPick, type Rng } from '../utils/rng'
import type { Cell } from './boardShapes'

/**
 * Solvability-guaranteed reverse generation (spec §4), with obstacles.
 *
 * Bees: the last-to-escape bee is placed first on an (otherwise hornet-only)
 * board, and each next bee is placed so its straight path is clear of every
 * already-placed bee AND every hornet. Escaping in reverse-placement order is
 * then always a valid, bump-free solution.
 *
 * Hornets: permanent blockers, seeded before any bee. Because every bee's path
 * is kept clear of hornets at placement, no bee is ever hornet-trapped.
 *
 * Queen: the first-placed bee (escapes last) becomes the queen. Since no later
 * bee's path can contain her, she blocks nobody, so the queen-last solution
 * always exists.
 *
 * That construction ignores the honey trail, so it only guarantees an order
 * with no BUMPS. Whether an order exists that also never flies into a wet trail
 * is a genuinely harder question, and it is what the level is actually about —
 * so every candidate board is put through the full search here, and only boards
 * where a perfect order still exists are shipped. Among those we keep the one
 * where competent-but-unplanned play fails most often.
 */

export interface GenOccupant extends SolverBee {}

export interface GenBoard {
  occupants: GenOccupant[]
  honeyCells: Array<[number, number]>
  /** Minimum taps to clear all goals, accounting for honey-trail detours. */
  minMoves: number
  metrics: BoardMetrics
  /**
   * Measured fraction of competent-but-unplanned playthroughs that LOSE at the
   * real budget — the ground-truth "how much thinking does this level demand?"
   * signal, used to enforce the rising difficulty floor.
   */
  planningLoss: number
  /**
   * Measured loss of the PREVIEWING-HUMAN proxy (one-ply lookahead with full
   * landing information) — the round-4 floor metric. 0 when not measured
   * (candidate failed the cheap greedy screen, or the slot has no planner
   * floor).
   */
  plannerLoss: number
}

/**
 * The on-board cells a flight from (q,r) along dir crosses before it exits the
 * board, or null if it is blocked by a start cell (`occ`, a bee or hornet). The
 * path MAY cross other bees' flight lanes — that's the whole puzzle: two lanes
 * that share a cell can't both stay clean, so whoever flies second over it sticks
 * in the honey the first one left, and the order that avoids the most of those
 * stops is the solution. It may never cross a START cell, because a bee sits on
 * permanent honey, so a lane through one is a dead stop no order can fix.
 */
function rayCells(
  q: number,
  r: number,
  dir: number,
  boardSet: ReadonlySet<string>,
  occ: ReadonlySet<string>,
): Cell[] | null {
  const v = DIRECTION_VECTORS[dir]
  const cells: Cell[] = []
  let cq = q
  let cr = r
  for (;;) {
    cq += v.q
    cr += v.r
    const k = axialKey(cq, cr)
    if (!boardSet.has(k)) return cells // flew off the edge
    if (occ.has(k)) return null // never through a start cell (permanent honey there)
    cells.push([cq, cr])
  }
}

interface Candidate {
  q: number
  r: number
  dir: number
  len: number
  cells: Cell[]
}

/**
 * Reverse placement with a BUMP-FREE order by construction. Each bee is placed
 * so its flight path is clear of every already-placed bee's ORIGIN (no bump,
 * and no dead stop on the permanent honey under a start cell), and no bee ever
 * STARTS on a cell some earlier flight crosses. Escaping in reverse-placement
 * order is therefore always bump-free — but paths MAY cross each other, so that
 * order can still include forced honey-stops (fly in, stick, re-fly out); the
 * true minimum is measured afterwards by the real search. That crossing is the
 * whole puzzle: two lanes that share a cell can't both stay clean, so the order
 * decides who flies through whose honey.
 *
 * `noCrossings` (tutorial slots) additionally forbids paths crossing each
 * other, which makes EVERY order clean: those boards are pure escape-ordering
 * with no stuck bees, solvable in exactly one tap per bee.
 */
function placeBees(
  boardCells: ReadonlyArray<Cell>,
  boardSet: ReadonlySet<string>,
  hornetKeys: ReadonlySet<string>,
  targetBees: number,
  rayBias: number,
  rng: Rng,
  noCrossings = false,
): GenOccupant[] {
  const occ = new Set<string>(hornetKeys) // origins + hornets — paths must avoid these
  const pathSet = new Set<string>() // every cell already crossed by a placed flight
  const bees: GenOccupant[] = []

  while (bees.length < targetBees) {
    const candidates: Candidate[] = []
    for (const [q, r] of boardCells) {
      const ok = axialKey(q, r)
      if (occ.has(ok) || pathSet.has(ok)) continue // can't start on an occupant or a lane
      for (let dir = 0; dir < 6; dir++) {
        const cells = rayCells(q, r, dir, boardSet, occ)
        if (cells === null) continue
        if (noCrossings && cells.some(([cq, cr]) => pathSet.has(axialKey(cq, cr)))) continue
        candidates.push({ q, r, dir, len: cells.length, cells })
      }
    }
    if (candidates.length === 0) break
    // Long rays cross more of the board, so their honey walls off more of it and
    // more other bees' start cells sit on some lane — which is where order bites.
    const chosen = weightedPick(rng, candidates, (c) => Math.pow(c.len + 1, rayBias))
    occ.add(axialKey(chosen.q, chosen.r))
    for (const [cq, cr] of chosen.cells) pathSet.add(axialKey(cq, cr))
    bees.push({ q: chosen.q, r: chosen.r, dir: chosen.dir, kind: 'bee' })
  }
  return bees
}

function pickHornetCells(
  boardCells: ReadonlyArray<Cell>,
  count: number,
  rng: Rng,
): Set<string> {
  const chosen = new Set<string>()
  if (count <= 0) return chosen
  let guard = 0
  while (chosen.size < count && guard < 300) {
    const [q, r] = boardCells[Math.floor(rng() * boardCells.length)]
    chosen.add(axialKey(q, r))
    guard++
  }
  return chosen
}

export interface GenRequest {
  boardCells: ReadonlyArray<Cell>
  targetBees: number
  minDepth: number
  maxDepth: number
  rayBias: number
  seed: number
  attempts: number
  hornets: number
  hasQueen: boolean
  /** Move budget above the minimum. */
  slack: number
  /** Minimum planning pressure the board must reach. */
  planningFloor: number
  /** Pressure the generator aims at (>= floor); spikes above, breathers at it. */
  planningTarget: number
  /**
   * Round-4 floor: minimum loss of the previewing-human proxy
   * (`plannerLossRate`). 0/absent = legacy greedy-only selection. When set,
   * the greedy floor becomes a cheap SCREEN and this is the bar the shipped
   * board must clear — candidates a one-ply player beats blind are rejected.
   */
  plannerFloor?: number
  /** Where the planner loss should land (>= plannerFloor). */
  plannerTarget?: number
  /** Max forced honey-stops the optimal line may need (0 = tutorial-clean). */
  maxForcedStops: number
  /** Pre-placed honey cells seeded on empty board cells (lanes cut from move 1). */
  honeyLakes: number
  /**
   * "Sticky Hive" mode: fraction of FREE cells pre-seeded with honey (0/absent
   * = normal level). Supersedes honeyLakes when set. Keep at 0.4–0.6 — full
   * coverage measurably collapses into an orderless crawl.
   */
  floodCoverage?: number
  /** Layout restarts to sample; late high-floor slots need many more. */
  restarts: number
}

/** Build one bump-free-solvable board (bees + optional queen/hornets). */
function buildStructural(
  req: GenRequest,
  boardSet: ReadonlySet<string>,
  boardCells: number,
  baseSeed: number,
): GenBoard {
  const depthMid = (req.minDepth + req.maxDepth) / 2
  let best: GenBoard | null = null
  let bestScore = Infinity

  // Tutorial slots must be clean by construction: with no crossing lanes, every
  // escape order works and no bee ever sticks — one tap per bee, guaranteed.
  const noCrossings = req.maxForcedStops === 0

  for (let attempt = 0; attempt < req.attempts; attempt++) {
    const rng = makeRng(mixSeed(baseSeed, attempt))
    const hornetKeys = pickHornetCells(req.boardCells, req.hornets, rng)
    const bees = placeBees(
      req.boardCells,
      boardSet,
      hornetKeys,
      req.targetBees,
      req.rayBias,
      rng,
      noCrossings,
    )

    // Designate the first-placed bee (escapes last) as the queen.
    if (req.hasQueen && bees.length >= 2) bees[0].kind = 'queen'

    const hornets: GenOccupant[] = [...hornetKeys].map((k) => {
      const [q, r] = k.split(',').map(Number)
      return { q, r, dir: 0, kind: 'hornet' }
    })
    const occupants = [...hornets, ...bees]
    const metrics = analyzeBoard(occupants, boardSet, boardCells)
    if (!metrics.solvable) continue

    // Pre-seeded honey on cells no occupant sits on. Landing on a placed
    // bee's flight lane is the POINT — a lane cut before move one — and the
    // real search below decides whether the board is still cleanly orderable.
    // Two regimes share the mechanism: normal levels seed `honeyLakes` cells
    // (2), Sticky Hive levels seed `floodCoverage` of ALL free cells.
    const honeyCells: Array<[number, number]> = []
    const occKeys = new Set(occupants.map((o) => axialKey(o.q, o.r)))
    const freeCells = req.boardCells.filter(([q, r]) => !occKeys.has(axialKey(q, r)))
    const seedTarget =
      (req.floodCoverage ?? 0) > 0
        ? Math.round(freeCells.length * (req.floodCoverage ?? 0))
        : req.honeyLakes
    if (seedTarget > 0) {
      let guard = 0
      const taken = new Set<string>()
      while (honeyCells.length < seedTarget && guard < 400 && freeCells.length > 0) {
        guard++
        const [q, r] = freeCells[Math.floor(rng() * freeCells.length)]
        const k = axialKey(q, r)
        if (taken.has(k)) continue
        taken.add(k)
        honeyCells.push([q, r])
      }
    }

    const beeShort = Math.max(0, req.targetBees - bees.length)
    const inBand = metrics.depDepth >= req.minDepth && metrics.depDepth <= req.maxDepth
    const queenMissing = req.hasQueen && !metrics.hasQueen ? 40 : 0
    const hornetShort = Math.max(0, req.hornets - metrics.hornets) * 15
    const score =
      beeShort * 50 + (inBand ? 0 : 20) + Math.abs(metrics.depDepth - depthMid) + queenMissing + hornetShort

    if (score < bestScore) {
      best = { occupants, metrics, honeyCells, minMoves: metrics.beeCount, planningLoss: 0, plannerLoss: 0 }
      bestScore = score
      if (inBand && beeShort === 0 && queenMissing === 0 && hornetShort === 0) break
    }
  }

  if (!best) {
    const rng = makeRng(baseSeed)
    const bees = placeBees(
      req.boardCells,
      boardSet,
      new Set(),
      req.targetBees,
      req.rayBias,
      rng,
      noCrossings,
    )
    const metrics = analyzeBoard(bees, boardSet, boardCells)
    best = { occupants: bees, metrics, honeyCells: [], minMoves: metrics.beeCount, planningLoss: 0, plannerLoss: 0 }
  }
  return best
}

function toBoardState(
  req: GenRequest,
  board: GenBoard,
  moveBudget: number,
): BoardState {
  return new BoardState({
    id: 0,
    cells: req.boardCells.map((c) => [c[0], c[1]] as [number, number]),
    honeyCells: board.honeyCells,
    bees: board.occupants.map((o) => ({ q: o.q, r: o.r, dir: o.dir, kind: o.kind })),
    moveBudget,
    threeStarSpare: 0,
  })
}

export function generateLevel(req: GenRequest): GenBoard {
  const boardSet = new Set<string>()
  for (const [q, r] of req.boardCells) boardSet.add(axialKey(q, r))
  const boardCells = req.boardCells.length

  // One layout can easily come out toothless — every bee heading a different way
  // so no trail ever matters. So build several, VERIFY each is actually clearable
  // under permanent honey, measure how hard it is to play, and pick by that.
  //
  // AIM AT THE FLOOR, don't maximise. Taking the meanest layout every time gives
  // a jagged curve (a 96%-loss board landing at level 60 next to a free one), so
  // we take the gentlest layout that still clears the level's floor and only
  // reach for the hardest when nothing clears it.
  //
  // The permanent trail means a structural board is NOT automatically clearable:
  // a bump-free order can still fly a bee into honey an earlier bee left, and the
  // stuck bee then blocks the lanes behind it. So every candidate is run through
  // the real search; only boards it can actually solve are eligible, and the
  // shipped budget is measured off that real minimum — never assumed.
  // Most levels satisfy the floor in a handful of tries and bail early (below);
  // the budget is really for the stubborn late boards, where walls shorten flights
  // and order-forcing crossings are rare, so it takes many layouts to find a mean
  // one. The early-exit keeps the easy levels cheap.
  const restarts = req.restarts
  // 9-bee boards legitimately need deeper candidate searches: at 1.5M nodes
  // many solvable layouts hit the ceiling, get discarded as "unsolvable", and
  // the few survivors are forced/chaotic boards that measure 0.00 loss (the
  // L200 trial shipped a free SPIKE this way). The deeper cap only costs time
  // on boards that were being thrown away anyway. Flooded boards search deeper
  // lines by nature, so they get it too.
  const flooded = (req.floodCoverage ?? 0) > 0
  const searchCap = req.targetBees >= 9 || flooded ? 4_000_000 : 1_500_000
  const target = req.planningTarget
  const plannerFloor = req.plannerFloor ?? 0
  const plannerTarget = req.plannerTarget ?? plannerFloor + 0.1
  // Cost bands (lower wins): [0..1] planner floor cleared, aim at the planner
  // target; [100..101] greedy screen passed but planner floor missed;
  // [200..201] failed even the cheap greedy screen. With no planner floor
  // (tutorial band) the greedy metric is the whole story, as before.
  const costOf = (b: GenBoard): number => {
    if (b.planningLoss < req.planningFloor) return 200 + (req.planningFloor - b.planningLoss)
    if (plannerFloor === 0) return Math.abs(b.planningLoss - target)
    if (b.plannerLoss < plannerFloor) return 100 + (plannerFloor - b.plannerLoss)
    return Math.abs(b.plannerLoss - plannerTarget)
  }

  // How far above one-tap-per-bee we allow the optimum to sit. Crowded late
  // boards legitimately need a few forced honey-stops (fly in, re-fly out); a
  // board whose best line needs more than this plays as chaos, not a plan.
  // Tutorial slots pin this to 0 (clean by construction). ADAPTIVE: a rare
  // pathological seed finds nothing at the cap in all its restarts — rather
  // than fail the whole run, retry once at cap+1 (still inside the shipping
  // ceiling genLevels enforces).
  // Flooded boards invert the meaning of a "stop": collections ARE the game,
  // so the ceiling is derived from the seeded-honey count (re-honeyed lanes
  // can add a few beyond it), not from the normal-band cap.
  const floodSeedEst = flooded
    ? Math.round((boardCells - req.targetBees - req.hornets) * (req.floodCoverage ?? 0))
    : 0
  const stopCaps = flooded
    ? [floodSeedEst + 8]
    : req.maxForcedStops === 0
      ? [0]
      : [req.maxForcedStops, req.maxForcedStops + 1]

  // In the 9-bee band (and on flooded boards) a full restart sweep at the deep
  // search cap costs minutes per level, and hunting for the loss CLOSEST to
  // target is cosmetic there: anything from target−0.06 up demands real
  // planning. So take the first board that clears both the floor and
  // target−0.06 instead of scanning the whole pool for a marginally closer one.
  const quickAccept = (b: GenBoard | null): boolean => {
    if (!(req.targetBees >= 9 || flooded) || b === null) return false
    if (plannerFloor > 0)
      return (
        b.planningLoss >= req.planningFloor &&
        b.plannerLoss >= Math.max(plannerFloor, plannerTarget - 0.06)
      )
    return b.planningLoss >= Math.max(req.planningFloor, target - 0.06)
  }

  // Track the best board ACROSS stop caps: a below-floor board found at the
  // base cap is kept as a fallback, but no longer returned before cap+1 gets
  // its chance — a thin candidate pool at the tight cap (common in the 9-bee
  // band) sometimes only offers forced/chaotic 0.00-loss boards, while the
  // looser cap holds a genuinely mean one.
  //
  // Round 2 (remixed base seed) runs ONLY when a whole two-cap sweep stayed
  // below the floor: a pathological seed's layout stream can be all tangles
  // (the L200 trial shipped a 0.04-loss SPIKE after 464 restarts), and a fresh
  // stream is the only remaining rescue. Deterministic, so a full regen still
  // reproduces the shipped JSON byte for byte.
  let best: GenBoard | null = null
  let bestCost = Infinity

  // Three rounds: seeds that clear their floor return inside round 1, so the
  // extra rounds cost nothing except on pathological streams (L200 needed
  // round 2; L266's pool cleared the greedy screen yet measured planner 0%
  // across a full two-round sweep and needed round 3).
  for (const roundSeed of [req.seed, mixSeed(req.seed, 0xa11ce), mixSeed(req.seed, 0xf00d)]) {
    for (const stopSlack of stopCaps) {
      for (let s = 0; s < restarts; s++) {
        if (bestCost <= 0.06 || quickAccept(best)) break // close enough; stop burning CPU
        const seed = mixSeed(roundSeed, s * 0x9e3779b1)
        const board = buildStructural(req, boardSet, boardCells, seed)
        const goals = board.metrics.beeCount
        if (goals < 2) continue

        // Fewest taps to clear it under permanent honey. Returns null if the board
        // can't be cleared within goals+stopSlack taps (too tangled) OR the search hit
        // its node ceiling (unresolvable in budget) — either way it is not shippable.
        const minMoves = searchMinMoves(toBoardState(req, board, goals + stopSlack), goals + stopSlack, searchCap)
        if (minMoves === null) continue
        board.minMoves = minMoves

        // How often does competent-but-unplanned play still lose? That is the whole
        // point of the permanent honey: a clean escape now can wall off a lane later.
        board.planningLoss = smartGreedyLossRate(
          toBoardState(req, board, minMoves + req.slack),
          100,
          mixSeed(seed, 0xbeef),
        )

        // The expensive previewing-human measurement runs only on candidates
        // that already cleared the cheap greedy screen — a board the greedy
        // bot beats blind can only measure lower against the stronger bot
        // (planner <= greedy loss on every board).
        if (plannerFloor > 0 && board.planningLoss >= req.planningFloor) {
          board.plannerLoss = plannerLossRate(
            toBoardState(req, board, minMoves + req.slack),
            60,
            mixSeed(seed, 0x91a7),
          )
        }

        const cost = costOf(board)
        if (cost < bestCost) {
          best = board
          bestCost = cost
        }
      }

      // Floor cleared (cost < 100 means loss >= planningFloor) — ship it without
      // burning the looser cap's restart budget.
      if (best && bestCost < 100) return best
    }
  }

  if (best) return best

  // No layout in `restarts` tries was clearable within goals+stopSlack. Rather
  // than ship a board with an assumed (and likely wrong) budget, search a fresh
  // structural board as deep as needed to find its REAL minimum, and budget off
  // that. Only if even that search can't resolve it do we fall back to the goal
  // count — and genLevels' honey-solvability check will fail the run rather than
  // ship an unwinnable level.
  const board = buildStructural(req, boardSet, boardCells, req.seed)
  const goals = board.metrics.beeCount
  const deepCap = goals + (flooded ? floodSeedEst + 12 : 12)
  const deepMin = searchMinMoves(toBoardState(req, board, deepCap), deepCap, 8_000_000)
  board.minMoves = deepMin ?? goals
  board.planningLoss = 0
  return board
}
