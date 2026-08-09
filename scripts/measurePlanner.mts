/**
 * Hypothesis probe: how often does a PREVIEWING-HUMAN proxy lose on the
 * shipped levels? The proxy plays what the player actually plays: it sees
 * every landing cell (aim preview), never bumps, never frees the queen early,
 * and greedily picks the move that leaves the board LEAST blocked one ply
 * ahead (min estimateMinMoves after the move, ties broken toward escapes,
 * then randomly). A level that this bot clears blind is a level the tester
 * cruises; smart-greedy loss (the current curve metric) does not see that.
 *
 *   npx tsx scripts/measurePlanner.mts            # whole set, per-chapter
 *   npx tsx scripts/measurePlanner.mts 36 45 80   # specific levels
 */
import { LEVELS } from '../src/levels'
import { BoardState } from '../src/systems/BoardState'
import { estimateMinMoves } from '../src/systems/SolverSearch'
import { makeRng, mixSeed } from '../src/utils/rng'

function plannerLossRate(start: BoardState, trials: number, seedBase: number): number {
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
        .filter((m) => !(m.o.kind === 'queen' && m.out.kind === 'escaped' && goalsLeft > 1))
      if (cands.length === 0) break
      // One-ply evaluation with full preview information.
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

const args = process.argv.slice(2).map(Number)
const targets = args.length > 0 ? LEVELS.filter((l) => args.includes(l.id)) : LEVELS

if (args.length > 0) {
  for (const l of targets) {
    const loss = plannerLossRate(new BoardState(l), 60, 1000 + l.id)
    console.log(
      `L${l.id}: plannerLoss=${loss.toFixed(2)}  (shipped smartGreedy floor metric in JSON: see report)${l.flooded ? ' [flooded]' : ''}`,
    )
  }
} else {
  console.log('Chapter | planner-loss avg | free-vs-planner (0-loss) count')
  for (let ch = 1; ch <= 12; ch++) {
    const g = targets.filter((l) => (l.chapter ?? 0) === ch)
    let sum = 0
    let free = 0
    for (const l of g) {
      const loss = plannerLossRate(new BoardState(l), 40, 1000 + l.id)
      sum += loss
      if (loss === 0) free++
    }
    console.log(
      `   ${String(ch).padEnd(2)}   |      ${((sum / g.length) * 100).toFixed(0).padStart(3)}%        |   ${free}/${g.length}`,
    )
  }
}
