import { BoardState } from './BoardState'
import { makeRng, mixSeed } from '../utils/rng'

/**
 * Honey breaks the "removing a bee only unblocks" monotonicity (a bee flying
 * through honey gets STUCK and becomes a new blocker), so greedy no longer
 * proves solvability — order genuinely matters and you can strand yourself.
 *
 * This is a real breadth-first search over board configurations that drives the
 * actual BoardState rules (escape / bump / stuck / queen-last), so validation
 * and runtime can never disagree. Returns the minimum number of taps to clear
 * all goals, or null if unsolvable within `maxMoves` (or if the search exceeds
 * `cap` states, in which case the caller treats the board as too hard / rejects).
 *
 * The passed board should have an effectively unbounded budget so taps are not
 * refused mid-search; the caller derives the real budget from the result.
 */
export function searchMinMoves(start: BoardState, maxMoves: number, cap = 400_000): number | null {
  if (start.remaining === 0) return 0
  const visited = new Set<string>([start.stateKey()])
  let frontier: BoardState[] = [start]
  let depth = 0
  let expanded = 0

  while (frontier.length > 0 && depth < maxMoves) {
    const next: BoardState[] = []
    for (const state of frontier) {
      for (const occ of state.allOccupants()) {
        if (!occ.isTappable()) continue // hornets, etc.
        const child = state.clone()
        const outcome = child.tap(occ.q, occ.r)
        if (!outcome || outcome.kind === 'blocked') continue // a bump is a wasted move
        if (child.status === 'lost') continue // queen left early on this branch
        if (child.remaining === 0) return depth + 1
        const key = child.stateKey()
        if (visited.has(key)) continue
        visited.add(key)
        if (++expanded > cap) return null
        next.push(child)
      }
    }
    frontier = next
    depth++
  }
  return null
}

/**
 * Fraction of "mindless" playthroughs that LOSE — a proxy for how much a level
 * punishes careless play (i.e. how much thinking it requires). Careless = tap a
 * random occupant whose outcome is escape or stick (never a deliberate bump),
 * ignoring the queen-last rule. A run loses if it strands (only bumps remain),
 * violates the queen rule, or runs out of moves. `start` must carry the level's
 * real move budget.
 */
export function carelessLossRate(start: BoardState, trials: number, seedBase: number): number {
  let losses = 0
  for (let t = 0; t < trials; t++) {
    const rand = makeRng(mixSeed(seedBase, (t + 1) * 2654435761))
    const b = start.clone()
    let won = false
    for (let s = 0; s < 400; s++) {
      if (b.remaining === 0) {
        won = true
        break
      }
      if (b.status !== 'playing') break
      const opts = b.allOccupants().filter((o) => o.isTappable() && b.trace(o).kind !== 'blocked')
      if (opts.length === 0) break // stranded: only bump-moves left
      const o = opts[Math.floor(rand() * opts.length)]
      b.tap(o.q, o.r)
    }
    if (!won) losses++
  }
  return losses / trials
}

/**
 * A safe next tap for the runtime hint on honey boards: the first tap (escape or
 * stuck) that keeps the board solvable. Falls back to null if none.
 */
export function nextSolvingMove(
  board: BoardState,
  maxMoves: number,
): { q: number; r: number } | null {
  for (const occ of board.allOccupants()) {
    if (!occ.isTappable()) continue
    // Inflate the probe board's budget so the recursive search is never refused
    // a tap mid-way by the real (often tight) move budget.
    const child = board.cloneWithBudget(999)
    const outcome = child.tap(occ.q, occ.r)
    if (!outcome || outcome.kind === 'blocked') continue
    if (child.status === 'lost') continue
    if (child.remaining === 0) return { q: occ.q, r: occ.r }
    if (searchMinMoves(child, maxMoves) !== null) return { q: occ.q, r: occ.r }
  }
  return null
}
