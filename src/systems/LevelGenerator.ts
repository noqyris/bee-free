import { axialKey, DIRECTION_VECTORS } from './HexGrid'
import { analyzeBoard, type BoardMetrics, type SolverBee } from './Solver'
import { makeRng, mixSeed, weightedPick, type Rng } from '../utils/rng'
import type { Cell } from './boardShapes'

/**
 * Solvability-guaranteed reverse generation (spec §4).
 *
 * We build the solution in reverse: the LAST bee to escape is placed first on
 * an empty board (clear path guaranteed), and each subsequent bee is placed so
 * its straight path is clear of every already-placed bee. Since already-placed
 * bees are exactly the ones still present when this bee escapes in the forward
 * solution, escaping in reverse-placement order is always a valid, bump-free
 * solution. Dependencies (forced ordering) emerge because later-placed bees can
 * land in an earlier bee's path.
 */

export interface GenBoard {
  bees: SolverBee[]
  metrics: BoardMetrics
}

/**
 * Length of the in-board straight ray from (q,r) in direction `dir`, or -1 if a
 * currently-occupied cell blocks it before it leaves the board.
 */
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
    if (!boardSet.has(k)) return len // left the board with a clear path
    if (occ.has(k)) return -1 // blocked by an already-placed bee
    len++
  }
}

interface Candidate {
  q: number
  r: number
  dir: number
  len: number
}

/**
 * Place up to `targetBees` bees on the board. `rayBias` steers difficulty:
 * higher values favor long internal rays, which are more likely to be blocked
 * by bees placed later, producing deeper dependency chains.
 */
function placeBees(
  boardCells: ReadonlyArray<Cell>,
  boardSet: ReadonlySet<string>,
  targetBees: number,
  rayBias: number,
  rng: Rng,
): SolverBee[] {
  const occ = new Set<string>()
  const bees: SolverBee[] = []

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

    const chosen = weightedPick(rng, candidates, (c) => Math.pow(c.len + 1, rayBias))
    occ.add(axialKey(chosen.q, chosen.r))
    bees.push({ q: chosen.q, r: chosen.r, dir: chosen.dir })
  }

  return bees
}

export interface GenRequest {
  boardCells: ReadonlyArray<Cell>
  targetBees: number
  minDepth: number
  maxDepth: number
  rayBias: number
  seed: number
  attempts: number
}

/**
 * Generate a board matching the requested difficulty band. Deterministic for a
 * given seed. Tries many sub-seeded attempts and keeps the one whose dependency
 * depth best fits [minDepth, maxDepth] (with the target bee count). Falls back
 * to the closest candidate so generation never fails outright.
 */
export function generateLevel(req: GenRequest): GenBoard {
  const boardSet = new Set<string>()
  for (const [q, r] of req.boardCells) boardSet.add(axialKey(q, r))
  const boardCells = req.boardCells.length
  const depthMid = (req.minDepth + req.maxDepth) / 2

  let best: GenBoard | null = null
  let bestScore = Infinity

  for (let attempt = 0; attempt < req.attempts; attempt++) {
    const rng = makeRng(mixSeed(req.seed, attempt))
    const bees = placeBees(req.boardCells, boardSet, req.targetBees, req.rayBias, rng)
    const metrics = analyzeBoard(bees, boardSet, boardCells)
    if (!metrics.solvable) continue // safety; reverse gen guarantees this anyway

    const beeShort = Math.max(0, req.targetBees - bees.length)
    const inBand = metrics.depDepth >= req.minDepth && metrics.depDepth <= req.maxDepth
    // Lower is better: heavy penalty for missing bee count or depth band.
    const score =
      beeShort * 50 + (inBand ? 0 : 20) + Math.abs(metrics.depDepth - depthMid)

    if (score < bestScore) {
      best = { bees, metrics }
      bestScore = score
      if (inBand && beeShort === 0) break // perfect fit — stop early
    }
  }

  if (!best) {
    // Degenerate fallback: a single empty-path placement always solvable.
    const rng = makeRng(req.seed)
    const bees = placeBees(req.boardCells, boardSet, req.targetBees, req.rayBias, rng)
    best = { bees, metrics: analyzeBoard(bees, boardSet, boardCells) }
  }
  return best
}
