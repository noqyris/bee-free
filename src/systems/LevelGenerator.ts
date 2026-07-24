import { axialKey, DIRECTION_VECTORS } from './HexGrid'
import { analyzeBoard, type BoardMetrics, type SolverBee } from './Solver'
import { BoardState } from './BoardState'
import { searchMinMoves, smartGreedyLossRate } from './SolverSearch'
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
}

/** In-board ray length from (q,r) along dir, or -1 if a placed occupant blocks it. */
function clearRayLen(
  q: number,
  r: number,
  dir: number,
  boardSet: ReadonlySet<string>,
  occ: ReadonlySet<string>,
): number {
  const v = DIRECTION_VECTORS[dir]
  let len = 0
  let cq = q
  let cr = r
  for (;;) {
    cq += v.q
    cr += v.r
    const k = axialKey(cq, cr)
    if (!boardSet.has(k)) return len
    if (occ.has(k)) return -1
    len++
  }
}

interface Candidate {
  q: number
  r: number
  dir: number
  len: number
}

function placeBees(
  boardCells: ReadonlyArray<Cell>,
  boardSet: ReadonlySet<string>,
  hornetKeys: ReadonlySet<string>,
  targetBees: number,
  rayBias: number,
  rng: Rng,
): GenOccupant[] {
  const occ = new Set<string>(hornetKeys) // hornets are permanent, block placement + rays
  const bees: GenOccupant[] = []

  while (bees.length < targetBees) {
    const candidates: Candidate[] = []
    for (const [q, r] of boardCells) {
      if (occ.has(axialKey(q, r))) continue
      for (let dir = 0; dir < 6; dir++) {
        const len = clearRayLen(q, r, dir, boardSet, occ)
        if (len >= 0) candidates.push({ q, r, dir, len })
      }
    }
    if (candidates.length === 0) break
    // Long rays cross more of the board, so they overlap more other flight
    // paths — which is exactly where the trail forces an order.
    const chosen = weightedPick(rng, candidates, (c) => Math.pow(c.len + 1, rayBias))
    occ.add(axialKey(chosen.q, chosen.r))
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
  /** Moves a flown-over cell stays sticky. The level's core difficulty knob. */
  dryMoves: number
  /** Move budget above the minimum. */
  slack: number
  /** Minimum planning pressure the board must reach. */
  planningFloor: number
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

  for (let attempt = 0; attempt < req.attempts; attempt++) {
    const rng = makeRng(mixSeed(baseSeed, attempt))
    const hornetKeys = pickHornetCells(req.boardCells, req.hornets, rng)
    const bees = placeBees(req.boardCells, boardSet, hornetKeys, req.targetBees, req.rayBias, rng)

    // Designate the first-placed bee (escapes last) as the queen.
    if (req.hasQueen && bees.length >= 2) bees[0].kind = 'queen'

    const hornets: GenOccupant[] = [...hornetKeys].map((k) => {
      const [q, r] = k.split(',').map(Number)
      return { q, r, dir: 0, kind: 'hornet' }
    })
    const occupants = [...hornets, ...bees]
    const metrics = analyzeBoard(occupants, boardSet, boardCells)
    if (!metrics.solvable) continue

    const beeShort = Math.max(0, req.targetBees - bees.length)
    const inBand = metrics.depDepth >= req.minDepth && metrics.depDepth <= req.maxDepth
    const queenMissing = req.hasQueen && !metrics.hasQueen ? 40 : 0
    const hornetShort = Math.max(0, req.hornets - metrics.hornets) * 15
    const score =
      beeShort * 50 + (inBand ? 0 : 20) + Math.abs(metrics.depDepth - depthMid) + queenMissing + hornetShort

    if (score < bestScore) {
      best = { occupants, metrics, honeyCells: [], minMoves: metrics.beeCount, planningLoss: 0 }
      bestScore = score
      if (inBand && beeShort === 0 && queenMissing === 0 && hornetShort === 0) break
    }
  }

  if (!best) {
    const rng = makeRng(baseSeed)
    const bees = placeBees(req.boardCells, boardSet, new Set(), req.targetBees, req.rayBias, rng)
    const metrics = analyzeBoard(bees, boardSet, boardCells)
    best = { occupants: bees, metrics, honeyCells: [], minMoves: metrics.beeCount, planningLoss: 0 }
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
    dryMoves: req.dryMoves,
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
  // so no trail ever matters. So build several, measure how hard each really is
  // to order, and pick by that measurement.
  //
  // AIM AT THE FLOOR, don't maximise. Taking the meanest layout every time gives
  // a jagged curve (a 96%-loss board landing at level 60 next to a free one), so
  // we take the gentlest layout that still clears the level's floor and only
  // reach for the hardest when nothing clears it.
  const restarts = req.dryMoves > 0 ? 22 : 4
  const target = req.planningFloor + 0.08

  const costOf = (loss: number, minMoves: number, goals: number): number => {
    const miss = loss < req.planningFloor ? 100 + (req.planningFloor - loss) : Math.abs(loss - target)
    // Mild nudge towards boards a perfect run can clear in one tap per bee.
    return miss + (minMoves - goals) * 0.05
  }

  let best: GenBoard | null = null
  let bestCost = Infinity

  const sweep = (salt: number, spare: number): void => {
    for (let s = 0; s < restarts; s++) {
      if (bestCost <= 0.06) return // close enough to the target; stop burning CPU
      const seed = mixSeed(req.seed, mixSeed(salt, s * 0x9e3779b1))
      const board = buildStructural(req, boardSet, boardCells, seed)
      const goals = board.metrics.beeCount

      // How few taps can clear it once the trail is in play? Allow a few forced
      // honey-stops: rejecting anything that is not one-tap-per-bee silently
      // selects for boards where the trail never gets in the way, which is the
      // opposite of what these levels are for.
      const minMoves = searchMinMoves(toBoardState(req, board, 999), goals + spare)
      if (minMoves === null) continue // no line within reach — unusable
      board.minMoves = minMoves
      board.planningLoss = smartGreedyLossRate(
        toBoardState(req, board, minMoves + req.slack),
        80,
        mixSeed(seed, 0xbeef),
      )

      const cost = costOf(board.planningLoss, minMoves, goals)
      if (cost < bestCost) {
        best = board
        bestCost = cost
      }
    }
  }

  sweep(0, 3)
  // A crowded late board can be hard enough that EVERY layout needs more than
  // three forced stops, so the first sweep rejects them all and keeps whichever
  // freak sparse layout it could validate. Widening the allowance rescues those
  // levels; it is only worth the CPU when the first sweep missed the floor.
  if (bestCost >= 100) sweep(0x51ed, 6)

  // Nothing measured cleanly (search capped on every layout): fall back to a
  // structural board so the run still produces a level and the caller's
  // validation reports it rather than crashing.
  if (!best) {
    const board = buildStructural(req, boardSet, boardCells, req.seed)
    board.minMoves = board.metrics.beeCount
    best = board
  }
  return best
}
