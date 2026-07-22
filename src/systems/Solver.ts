import { axialKey, DIRECTION_VECTORS } from './HexGrid'
import type { BeeSpec } from '../types'

/**
 * Pure analysis of a plain-bee board (no obstacles). Shared by the offline
 * generator, the validator, CI, and the runtime hint feature.
 *
 * Key property of plain-bee boards: removing a bee can only *unblock* others,
 * never block them. So a solvable board can never deadlock via greedy play, and
 * the minimum solution length always equals the bee count (a bump-free order
 * always exists). Difficulty therefore lives in the move budget and in how many
 * bees are blocked at any moment — not in avoiding a dead end.
 */

export interface SolverBee {
  q: number
  r: number
  dir: number
}

export interface BoardMetrics {
  beeCount: number
  boardCells: number
  fillPct: number
  solvable: boolean
  minMoves: number
  /** Longest forced ordering chain (dependency-DAG depth). */
  depDepth: number
  /** Bees whose straight path is blocked by another bee at the start. */
  blockedAtStart: number
  /** Bees that can escape immediately at the start (safe first taps). */
  freeAtStart: number
  /** Composite difficulty score used to order/bucket levels. */
  difficulty: number
}

export function toSolverBees(bees: ReadonlyArray<BeeSpec>): SolverBee[] {
  return bees.map((b) => ({ q: b.q, r: b.r, dir: b.dir }))
}

/**
 * Cells in a bee's straight path that are occupied, until the ray leaves the
 * board. Returns the occupant keys blocking it (empty = clear path to edge).
 */
function blockersInPath(
  bee: SolverBee,
  boardSet: ReadonlySet<string>,
  occToBee: ReadonlyMap<string, number>,
): number[] {
  const v = DIRECTION_VECTORS[bee.dir]
  let q = bee.q
  let r = bee.r
  const found: number[] = []
  for (;;) {
    q += v.q
    r += v.r
    const k = axialKey(q, r)
    if (!boardSet.has(k)) return found
    const id = occToBee.get(k)
    if (id !== undefined) found.push(id)
  }
}

export function analyzeBoard(
  bees: ReadonlyArray<SolverBee>,
  boardSet: ReadonlySet<string>,
  boardCells: number,
): BoardMetrics {
  const occToBee = new Map<string, number>()
  bees.forEach((b, i) => occToBee.set(axialKey(b.q, b.r), i))

  // Initial blocking + dependency graph (edge i -> j means i must wait for j).
  const deps: number[][] = bees.map((b) => blockersInPath(b, boardSet, occToBee))
  let blockedAtStart = 0
  for (const d of deps) if (d.length > 0) blockedAtStart++

  // Longest chain in the dependency DAG (memoized; acyclic by construction).
  const memo = new Int32Array(bees.length).fill(-1)
  const stack = new Uint8Array(bees.length)
  const depthOf = (i: number): number => {
    if (memo[i] >= 0) return memo[i]
    if (stack[i]) return 0 // cycle guard (shouldn't happen on generated boards)
    stack[i] = 1
    let best = 0
    for (const j of deps[i]) best = Math.max(best, 1 + depthOf(j))
    stack[i] = 0
    memo[i] = best
    return best
  }
  let depDepth = 0
  for (let i = 0; i < bees.length; i++) depDepth = Math.max(depDepth, depthOf(i))

  // Greedy solvability: repeatedly remove any bee with a clear path.
  const remaining = new Map<string, SolverBee>()
  bees.forEach((b) => remaining.set(axialKey(b.q, b.r), b))
  let progress = true
  while (progress && remaining.size > 0) {
    progress = false
    const occ = new Map<string, number>()
    let idx = 0
    for (const rk of remaining.keys()) occ.set(rk, idx++)
    for (const [key, b] of remaining) {
      if (blockersInPath(b, boardSet, occ).length === 0) {
        remaining.delete(key)
        progress = true
        break
      }
    }
  }
  const solvable = remaining.size === 0

  const fillPct = boardCells > 0 ? bees.length / boardCells : 0
  const difficulty =
    bees.length * 1.0 + depDepth * 2.2 + blockedAtStart * 1.4 + fillPct * 12

  return {
    beeCount: bees.length,
    boardCells,
    fillPct,
    solvable,
    minMoves: bees.length,
    depDepth,
    blockedAtStart,
    freeAtStart: bees.length - blockedAtStart,
    difficulty,
  }
}

/**
 * Runtime hint: the position of any bee that can currently escape. Because
 * greedy always solves a plain-bee board, any escapable bee is a safe hint.
 * Returns null only if the board is empty or (impossibly) deadlocked.
 */
export function nextSafeMove(
  bees: ReadonlyArray<SolverBee>,
  boardSet: ReadonlySet<string>,
): SolverBee | null {
  const occ = new Map<string, number>()
  bees.forEach((b, i) => occ.set(axialKey(b.q, b.r), i))
  for (const b of bees) {
    if (blockersInPath(b, boardSet, occ).length === 0) return b
  }
  return null
}
