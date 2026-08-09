import { axialKey, DIRECTION_VECTORS } from './HexGrid'
import type { BeeSpec, OccupantKind } from '../types'

/**
 * Pure analysis of a board (bees + queen + hornets). Shared by the offline
 * generator, the validator, CI, and the runtime hint feature.
 *
 * Invariants that keep this tractable:
 * - Removing a bee only *unblocks* others (never blocks), so among the movable
 *   pieces greedy play never deadlocks and min moves = goal count.
 * - Hornets are permanent blockers (never removed, never a goal).
 * - The queen is a goal that must be escaped LAST; a board is only "solvable"
 *   if the goals can be cleared with the queen going last.
 */

export interface SolverBee {
  q: number
  r: number
  dir: number
  kind: OccupantKind
}

export interface BoardMetrics {
  beeCount: number // goal occupants (bees + queen)
  boardCells: number
  fillPct: number
  solvable: boolean
  minMoves: number
  depDepth: number
  blockedAtStart: number
  freeAtStart: number
  hornets: number
  hasQueen: boolean
  difficulty: number
}

export function toSolverBees(bees: ReadonlyArray<BeeSpec>): SolverBee[] {
  return bees.map((b) => ({ q: b.q, r: b.r, dir: b.dir, kind: b.kind }))
}

const isGoalKind = (k: OccupantKind): boolean => k !== 'hornet'

/** Indices (into the occupant list) of occupants standing in a bee's ray. */
function blockersInPath(
  occ: SolverBee,
  boardSet: ReadonlySet<string>,
  occToIdx: ReadonlyMap<string, number>,
): number[] {
  const v = DIRECTION_VECTORS[occ.dir]
  let q = occ.q
  let r = occ.r
  const found: number[] = []
  for (;;) {
    q += v.q
    r += v.r
    const k = axialKey(q, r)
    if (!boardSet.has(k)) return found
    const idx = occToIdx.get(k)
    if (idx !== undefined) found.push(idx)
  }
}

export function analyzeBoard(
  occ: ReadonlyArray<SolverBee>,
  boardSet: ReadonlySet<string>,
  boardCells: number,
): BoardMetrics {
  const occToIdx = new Map<string, number>()
  occ.forEach((o, i) => occToIdx.set(axialKey(o.q, o.r), i))

  const goals = occ.filter((o) => isGoalKind(o.kind))
  const hornets = occ.length - goals.length
  const hasQueen = occ.some((o) => o.kind === 'queen')

  // Blocking at start (any occupant, incl. hornets, in the ray).
  let blockedAtStart = 0
  for (const g of goals) {
    if (blockersInPath(g, boardSet, occToIdx).length > 0) blockedAtStart++
  }

  // Dependency depth over GOALS only (hornets are constant, ignored for order).
  const goalIdx = new Map<string, number>()
  goals.forEach((g, i) => goalIdx.set(axialKey(g.q, g.r), i))
  const deps: number[][] = goals.map((g) => {
    const v = DIRECTION_VECTORS[g.dir]
    let q = g.q
    let r = g.r
    const out: number[] = []
    for (;;) {
      q += v.q
      r += v.r
      const k = axialKey(q, r)
      if (!boardSet.has(k)) break
      const j = goalIdx.get(k)
      if (j !== undefined) out.push(j)
    }
    return out
  })
  const memo = new Int32Array(goals.length).fill(-1)
  const stack = new Uint8Array(goals.length)
  const depthOf = (i: number): number => {
    if (memo[i] >= 0) return memo[i]
    if (stack[i]) return 0
    stack[i] = 1
    let best = 0
    for (const j of deps[i]) best = Math.max(best, 1 + depthOf(j))
    stack[i] = 0
    memo[i] = best
    return best
  }
  let depDepth = 0
  for (let i = 0; i < goals.length; i++) depDepth = Math.max(depDepth, depthOf(i))

  const solvable = isSolvable(occ, boardSet)

  const fillPct = boardCells > 0 ? occ.length / boardCells : 0
  const difficulty =
    goals.length * 1.0 +
    depDepth * 2.2 +
    blockedAtStart * 1.4 +
    hornets * 1.5 +
    (hasQueen ? 3 : 0) +
    fillPct * 12

  return {
    beeCount: goals.length,
    boardCells,
    fillPct,
    solvable,
    minMoves: goals.length,
    depDepth,
    blockedAtStart,
    freeAtStart: goals.length - blockedAtStart,
    hornets,
    hasQueen,
    difficulty,
  }
}

/**
 * Greedy solvability with the queen-last rule: repeatedly escape any non-queen
 * goal whose path is clear; escape the queen only once she is the last goal.
 * Hornets stay forever. Returns true iff all goals can be cleared this way.
 */
function isSolvable(occ: ReadonlyArray<SolverBee>, boardSet: ReadonlySet<string>): boolean {
  const remaining = new Map<string, SolverBee>()
  occ.forEach((o) => remaining.set(axialKey(o.q, o.r), o))

  const goalsLeft = () => {
    let n = 0
    for (const o of remaining.values()) if (isGoalKind(o.kind)) n++
    return n
  }

  for (;;) {
    const gl = goalsLeft()
    if (gl === 0) return true

    const occToIdx = new Map<string, number>()
    let i = 0
    for (const k of remaining.keys()) occToIdx.set(k, i++)

    let removedKey: string | null = null
    for (const [key, o] of remaining) {
      if (o.kind === 'hornet') continue
      if (o.kind === 'queen' && gl > 1) continue // queen must be last
      if (blockersInPath(o, boardSet, occToIdx).length === 0) {
        removedKey = key
        break
      }
    }
    if (removedKey === null) return false // deadlock
    remaining.delete(removedKey)
  }
}

/**
 * STRUCTURAL helper only — honey-blind, NOT a gameplay hint. It sees occupants
 * but not the permanent honey, so a bee it calls "free" can still fly straight
 * into a trail and stick. For a real hint use SolverSearch.nextSolvingMove,
 * which plays the actual BoardState rules. This exists for generator/test code
 * that reasons about bump-freedom alone.
 */
export function nextBumpFreeMove(
  occ: ReadonlyArray<SolverBee>,
  boardSet: ReadonlySet<string>,
): SolverBee | null {
  const occToIdx = new Map<string, number>()
  occ.forEach((o, i) => occToIdx.set(axialKey(o.q, o.r), i))
  const goalsLeft = occ.filter((o) => isGoalKind(o.kind)).length
  for (const o of occ) {
    if (o.kind === 'hornet') continue
    if (o.kind === 'queen' && goalsLeft > 1) continue
    if (blockersInPath(o, boardSet, occToIdx).length === 0) return o
  }
  return null
}
