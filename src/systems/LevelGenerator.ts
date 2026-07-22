import { axialKey, DIRECTION_VECTORS } from './HexGrid'
import { analyzeBoard, type BoardMetrics, type SolverBee } from './Solver'
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
 */

export interface GenOccupant extends SolverBee {}

export interface GenBoard {
  occupants: GenOccupant[]
  metrics: BoardMetrics
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
}

export function generateLevel(req: GenRequest): GenBoard {
  const boardSet = new Set<string>()
  for (const [q, r] of req.boardCells) boardSet.add(axialKey(q, r))
  const boardCells = req.boardCells.length
  const depthMid = (req.minDepth + req.maxDepth) / 2

  let best: GenBoard | null = null
  let bestScore = Infinity

  for (let attempt = 0; attempt < req.attempts; attempt++) {
    const rng = makeRng(mixSeed(req.seed, attempt))
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
      best = { occupants, metrics }
      bestScore = score
      if (inBand && beeShort === 0 && queenMissing === 0 && hornetShort === 0) break
    }
  }

  if (!best) {
    const rng = makeRng(req.seed)
    const bees = placeBees(req.boardCells, boardSet, new Set(), req.targetBees, req.rayBias, rng)
    best = { occupants: bees, metrics: analyzeBoard(bees, boardSet, boardCells) }
  }
  return best
}
