import { BoardState } from './BoardState'
import { DIRECTION_VECTORS, axialKey } from './HexGrid'
import { makeRng, mixSeed } from '../utils/rng'

/**
 * Admissible lower bound on the taps needed to clear the board — the IDA*
 * heuristic, exported so the runtime (doomed alarm, star pips) can share it.
 *
 * h = goals + |honeyed cells on the union of the goals' forward exit rays|.
 *
 * Why that is a true lower bound: a bee only ever moves along its fixed ray,
 * so every currently-honeyed cell ahead of a goal must either be landed on by
 * that goal (a stuck-tap) or collected by some other bee's landing before the
 * goal can fly through — one landing per distinct cell, and a landing is never
 * an escape. Add one escape tap per goal and nothing is double-counted. Honey
 * laid LATER only raises the true cost, never lowers it below this bound.
 *
 * On the sparse shipped boards this collapses to the old "one tap per goal"
 * bound plus the forced honey-stops, which is exactly the recorded minMoves —
 * boards are found at the FIRST deepening bound. On flooded boards it is the
 * difference between 21s and 2s of search.
 */
export function estimateMinMoves(state: BoardState): number {
  const goals = state.allOccupants().filter((o) => o.isGoal())
  if (goals.length === 0) return 0
  const honeyAhead = new Set<string>()
  for (const g of goals) {
    const { q: dq, r: dr } = DIRECTION_VECTORS[g.dir]
    let q = g.q + dq
    let r = g.r + dr
    while (state.cells.has(axialKey(q, r))) {
      const key = axialKey(q, r)
      if (state.honey.has(key)) honeyAhead.add(key)
      q += dq
      r += dr
    }
  }
  return goals.length + honeyAhead.size
}

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
    // Hop-aware admissible h (see estimateMinMoves): goals + honey on their
    // exit rays. Strictly dominates the old one-tap-per-goal bound, so tight
    // bounds prune lines that glue a lane shut the moment it happens.
    if (used + estimateMinMoves(state) > bound) return false
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
      // Rush: a bee flush against its blocker yields a zero-length park, which
      // `tap` refuses. Left in, the search would count a move that never
      // happened and explore a child identical to its parent.
      .filter(
        (m) =>
          m.out.kind !== 'parked' || m.out.at.q !== m.occ.q || m.out.at.r !== m.occ.r,
      )
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
  // Deepening starts at h(root), not at the goal count — on flooded boards the
  // true minimum sits far above goals, and every bound below h(root) would be
  // a full failed sweep.
  for (let bound = Math.max(goals, estimateMinMoves(root)); bound <= maxMoves; bound++) {
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
        // Rush: a zero-length park is refused by `tap`, so offering it to the
        // bot would let it "play" a move that changes nothing and stall out.
        .filter((m) => m.out.kind !== 'parked' || m.out.at.q !== m.o.q || m.out.at.r !== m.o.r)
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
 * Compass-mode minimum: fewest LAUNCHES to clear the board when every bee may
 * be freely rotated before each launch (rotation is free; only flights count).
 * Branching is bees × 6 directions per move, so this is meant for the small
 * Compass boards (≤7 bees) — not the campaign. Returns null when unsolvable
 * within `maxMoves` or the node cap was hit (treat as unusable).
 */
export function searchCompassMinMoves(
  start: BoardState,
  maxMoves: number,
  cap = 2_000_000,
): number | null {
  const goals = start.remaining
  if (goals === 0) return 0
  if (maxMoves < goals) return null

  let nodes = 0
  let capped = false

  const dfs = (state: BoardState, used: number, bound: number, seen: Map<string, number>): boolean => {
    // h = one launch per remaining goal. Weak but admissible under rotation:
    // direction choice invalidates the honey-ray bound (a bee may pick a
    // clean lane), and small boards keep the weak bound affordable.
    if (used + state.remaining > bound) return false
    const key = state.stateKey()
    const bestSoFar = seen.get(key)
    if (bestSoFar !== undefined && bestSoFar <= used) return false
    seen.set(key, used)

    for (const occ of state.allOccupants()) {
      if (!occ.isTappable()) continue
      for (let dir = 0; dir < 6; dir++) {
        if (nodes >= cap) {
          capped = true
          return false
        }
        nodes++
        const child = state.clone()
        const childOcc = child.occupantAt(occ.q, occ.r)!
        childOcc.dir = dir
        const out = child.trace(childOcc)
        if (out.kind === 'blocked') continue // a bump is never part of a best line
        child.tap(occ.q, occ.r)
        if (child.status === 'lost') continue
        if (child.remaining === 0) return true
        if (dfs(child, used + 1, bound, seen)) return true
      }
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
 * Compass-mode previewing-human proxy: at every step it tries each bee in each
 * direction one ply deep and launches the least-blocking non-bump option
 * (ties → escapes through a gate first). Mirrors what a player with the
 * rotation preview actually does; the mode's difficulty floor is measured
 * against it.
 */
export function compassPlannerLossRate(start: BoardState, trials: number, seedBase: number): number {
  let losses = 0
  for (let t = 0; t < trials; t++) {
    const rand = makeRng(mixSeed(seedBase, (t + 1) * 15485863))
    const b = start.clone()
    let won = false
    for (let s = 0; s < 300; s++) {
      if (b.remaining === 0) {
        won = true
        break
      }
      if (b.status !== 'playing') break
      const goalsLeft = b.allOccupants().filter((o) => o.isGoal()).length
      const scored: Array<{ q: number; r: number; dir: number; h: number; esc: number }> = []
      for (const occ of b.allOccupants()) {
        if (!occ.isTappable()) continue
        for (let dir = 0; dir < 6; dir++) {
          const child = b.clone()
          const childOcc = child.occupantAt(occ.q, occ.r)!
          childOcc.dir = dir
          const out = child.trace(childOcc)
          if (out.kind === 'blocked') continue
          if (childOcc.kind === 'queen' && out.kind === 'escaped' && goalsLeft > 1) continue
          child.tap(occ.q, occ.r)
          if (child.status === 'lost') continue
          scored.push({
            q: occ.q,
            r: occ.r,
            dir,
            h: child.remaining,
            esc: out.kind === 'escaped' ? 0 : 1,
          })
        }
      }
      if (scored.length === 0) break
      const best = Math.min(...scored.map((x) => x.h + x.esc * 0.5))
      const pool = scored.filter((x) => x.h + x.esc * 0.5 === best)
      const pick = pool[Math.floor(rand() * pool.length)]
      const occ = b.occupantAt(pick.q, pick.r)!
      occ.dir = pick.dir
      b.tap(pick.q, pick.r)
    }
    if (!won) losses++
  }
  return losses / trials
}

/**
 * Fraction of PREVIEWING-HUMAN playthroughs that LOSE — the strongest loss
 * bot, and the one the late curve is floored against.
 *
 * Ground truth (playtest round 4): a tester with the aim preview cruised
 * levels that `smartGreedyLossRate` scored at 50%+. The preview shows every
 * landing cell and the trail a flight will lay, so a human is effectively a
 * ONE-PLY solver: they reject any move that visibly walls somebody in. This
 * bot plays exactly that — for every legal move it simulates one ply and
 * keeps the move that leaves the board least blocked (minimum
 * `estimateMinMoves`), preferring clean escapes among ties, never bumping,
 * never freeing the queen early.
 *
 * A level this bot still loses requires seeing TWO OR MORE plies ahead —
 * i.e. genuine planning that the preview cannot do for you. That is the bar
 * the late game is generated against; `smartGreedyLossRate` stays as the
 * cheap first-pass screen (the planner is strictly stronger, so
 * plannerLoss <= greedyLoss on every board).
 */
export function plannerLossRate(start: BoardState, trials: number, seedBase: number): number {
  let losses = 0
  for (let t = 0; t < trials; t++) {
    const rand = makeRng(mixSeed(seedBase, (t + 1) * 7919))
    const b = start.clone()
    let won = false
    for (let s = 0; s < 400; s++) {
      if (b.remaining === 0) {
        won = true
        break
      }
      if (b.status !== 'playing') break
      const goalsLeft = b.allOccupants().filter((o) => o.isGoal()).length
      const cands = b
        .allOccupants()
        .filter((o) => o.isTappable())
        .map((o) => ({ o, out: b.trace(o) }))
        .filter((m) => m.out.kind !== 'blocked')
        // Rush: a zero-length park is refused by `tap`, so offering it to the
        // bot would let it "play" a move that changes nothing and stall out.
        .filter((m) => m.out.kind !== 'parked' || m.out.at.q !== m.o.q || m.out.at.r !== m.o.r)
        .filter((m) => !(m.o.kind === 'queen' && m.out.kind === 'escaped' && goalsLeft > 1))
      if (cands.length === 0) break
      const scored = cands
        .map((m) => {
          const child = b.clone()
          child.tap(m.o.q, m.o.r)
          if (child.status === 'lost') return null
          return { m, h: estimateMinMoves(child), esc: m.out.kind === 'escaped' ? 0 : 1 }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
      if (scored.length === 0) break
      const best = Math.min(...scored.map((x) => x.h))
      const pool0 = scored.filter((x) => x.h === best)
      const bestEsc = Math.min(...pool0.map((x) => x.esc))
      const pool = pool0.filter((x) => x.esc === bestEsc)
      const pick = pool[Math.floor(rand() * pool.length)]
      b.tap(pick.m.o.q, pick.m.o.r)
    }
    if (!won) losses++
  }
  return losses / trials
}

/**
 * A safe next tap for the runtime hint: the first tap (escape or stuck) that
 * keeps the board winnable in the moves that are left. Falls back to null.
 *
 * `maxMoves` counts the moves left INCLUDING the suggested tap (pass
 * board.movesLeft) — the recursive check runs on maxMoves - 1, because the
 * suggested tap has already been spent on the probe board.
 */
export function nextSolvingMove(
  board: BoardState,
  maxMoves: number,
): { q: number; r: number } | null {
  if (maxMoves < 1) return null
  for (const occ of board.allOccupants()) {
    if (!occ.isTappable()) continue
    // Inflate the probe board's budget so the recursive search is never refused
    // a tap mid-way by the real (often tight) move budget.
    const child = board.cloneWithBudget(Number.MAX_SAFE_INTEGER)
    const outcome = child.tap(occ.q, occ.r)
    if (!outcome || outcome.kind === 'blocked') continue
    if (child.status === 'lost') continue
    if (child.remaining === 0) return { q: occ.q, r: occ.r }
    if (searchMinMoves(child, maxMoves - 1) !== null) return { q: occ.q, r: occ.r }
  }
  return null
}
