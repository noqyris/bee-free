import { BoardState } from './BoardState'
import { makeRng, mixSeed } from '../utils/rng'

/**
 * Minimum taps to clear every goal, or null if that is impossible within
 * `maxMoves` (or if the search blew past `cap` expansions, in which case the
 * caller should treat the board as unusable rather than trust a guess).
 *
 * This drives the real BoardState rules — escape / bump / stuck / queen-last /
 * honey trail — so validation and runtime can never disagree.
 *
 * It is iterative-deepening DFS rather than the breadth-first search this used
 * to be. The honey trail is part of the position, so two different orders no
 * longer converge on one state and BFS degenerated into enumerating
 * permutations. Deepening on the move budget with h = "one tap per goal left"
 * prunes that flat: at the tightest bound every tap MUST remove a goal, so any
 * line where a bee gets stuck in a trail is cut the moment it happens. Boards
 * that are perfectly orderable — the ones we ship — are therefore found at the
 * very first bound.
 *
 * The passed board should have an effectively unbounded budget so taps are not
 * refused mid-search; the caller derives the real budget from the result.
 */
export function searchMinMoves(start: BoardState, maxMoves: number, cap = 300_000): number | null {
  const goals = start.remaining
  if (goals === 0) return 0
  if (maxMoves < goals) return null

  let nodes = 0
  let capped = false

  const dfs = (state: BoardState, used: number, bound: number, seen: Map<string, number>): boolean => {
    // h = one tap per remaining goal. Admissible (nothing clears two at once),
    // and it is what makes the tight bounds cheap.
    if (used + state.remaining > bound) return false
    const key = state.stateKey()
    const bestSoFar = seen.get(key)
    if (bestSoFar !== undefined && bestSoFar <= used) return false
    seen.set(key, used)

    // Tracing first avoids cloning for moves we would throw away, and lets us
    // try clean escapes before honey-stops (the answer is usually all escapes).
    const moves = state
      .allOccupants()
      .filter((o) => o.isTappable())
      .map((o) => ({ occ: o, out: state.trace(o) }))
      // A bump burns a move and smears more honey — never part of a best line.
      .filter((m) => m.out.kind !== 'blocked')
      .sort((a, b) => (a.out.kind === 'escaped' ? 0 : 1) - (b.out.kind === 'escaped' ? 0 : 1))

    for (const move of moves) {
      if (nodes >= cap) {
        capped = true
        return false
      }
      nodes++
      const child = state.clone()
      child.tap(move.occ.q, move.occ.r)
      if (child.status === 'lost') continue // queen left early on this branch
      if (child.remaining === 0) return true
      if (dfs(child, used + 1, bound, seen)) return true
    }
    return false
  }

  const root = start.cloneWithBudget(Number.MAX_SAFE_INTEGER)
  for (let bound = goals; bound <= maxMoves; bound++) {
    if (dfs(root, 0, bound, new Map())) return bound
    if (capped) return null
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
 * Fraction of COMPETENT-but-non-searching playthroughs that LOSE — the honest
 * measure of whether a level demands planning, and the signal the whole
 * difficulty curve is tuned against.
 *
 * `carelessLossRate` above measures random play, which wildly overstates
 * difficulty: with no honey in play, "tap any clear bee, save the queen for
 * last" ALWAYS wins (removing a bee only unblocks others), yet random play
 * loses ~96% of the time there. Such a level scores as brutal and plays as free.
 *
 * This bot instead plays the obvious good strategy — never bump, never release
 * the queen early, prefer a clean escape over gluing a bee into honey — but does
 * NOT look ahead, so it cannot see that today's clean escape lays a trail across
 * the lane the next bee needs. When it still loses, the level genuinely requires
 * a plan, which is exactly what the honey trail is there to demand.
 */
export function smartGreedyLossRate(start: BoardState, trials: number, seedBase: number): number {
  let losses = 0
  for (let t = 0; t < trials; t++) {
    const rand = makeRng(mixSeed(seedBase, (t + 1) * 104729))
    const b = start.clone()
    let won = false
    for (let s = 0; s < 400; s++) {
      if (b.remaining === 0) {
        won = true
        break
      }
      if (b.status !== 'playing') break

      const goalsLeft = b.allOccupants().filter((o) => o.isGoal()).length
      const moves = b
        .allOccupants()
        .filter((o) => o.isTappable())
        .map((o) => ({ o, out: b.trace(o) }))
        .filter((m) => m.out.kind !== 'blocked')
        .filter((m) => !(m.o.kind === 'queen' && m.out.kind === 'escaped' && goalsLeft > 1))
      if (moves.length === 0) break // stranded

      const escapes = moves.filter((m) => m.out.kind === 'escaped')
      const pool = escapes.length > 0 ? escapes : moves
      const pick = pool[Math.floor(rand() * pool.length)]
      b.tap(pick.o.q, pick.o.r)
    }
    if (!won) losses++
  }
  return losses / trials
}

/**
 * A safe next tap for the runtime hint: the first tap (escape or stuck) that
 * keeps the board winnable in the moves that are left. Falls back to null.
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
