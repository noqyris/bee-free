/**
 * Does a COMPETENT player actually have to think? (npx tsx scripts/humanDifficulty.ts)
 *
 * scripts/difficulty.ts measures careless-loss: how often *random* play loses.
 * That badly overstates difficulty for a human who has grasped the rules — on a
 * board with no honey, "tap any bee whose path is clear, save the queen for
 * last" ALWAYS wins, because removing a bee only ever unblocks others. Such a
 * level is 96% careless-loss and 0% hard.
 *
 * So this measures the honest signal: SMART-GREEDY loss. The bot plays the
 * obvious competent strategy — never bump, never release the queen early, pick
 * arbitrarily among the moves that look fine — but does NOT search ahead. If it
 * still loses, the level genuinely requires planning. If it always wins, the
 * level is free for anyone who understands the rules.
 */
import { LEVELS } from '../src/levels'
import { BoardState } from '../src/systems/BoardState'
import { makeRng, mixSeed } from '../src/utils/rng'
import type { LevelData } from '../src/types'

const TRIALS = 60

/** One competent-but-non-searching playthrough. Returns true if it won. */
function smartGreedyWins(level: LevelData, rand: () => number): boolean {
  const b = new BoardState(level)
  for (let step = 0; step < 500; step++) {
    if (b.remaining === 0) return true
    if (b.status !== 'playing') return false

    const goalsLeft = b.allOccupants().filter((o) => o.isGoal()).length
    const moves = b
      .allOccupants()
      .filter((o) => o.isTappable())
      .map((o) => ({ o, out: b.trace(o) }))
      .filter((m) => m.out.kind !== 'blocked') // never waste a move on a bump
      // Queen last: releasing her early is an instant loss, any player sees that.
      .filter((m) => !(m.o.kind === 'queen' && m.out.kind === 'escaped' && goalsLeft > 1))

    if (moves.length === 0) return false // stranded

    // Prefer a clean escape over deliberately gluing a bee into honey — that is
    // what an unreflective but sensible player does.
    const escapes = moves.filter((m) => m.out.kind === 'escaped')
    const pool = escapes.length > 0 ? escapes : moves
    const pick = pool[Math.floor(rand() * pool.length)]
    b.tap(pick.o.q, pick.o.r)
  }
  return b.remaining === 0
}

function lossRate(level: LevelData): number {
  let losses = 0
  for (let t = 0; t < TRIALS; t++) {
    const rand = makeRng(mixSeed(level.id * 7919, (t + 1) * 104729))
    if (!smartGreedyWins(level, rand)) losses++
  }
  return losses / TRIALS
}

const rows = LEVELS.map((l) => ({
  id: l.id,
  chapter: l.chapter ?? Math.ceil(l.id / 25),
  dry: l.dryMoves ?? 0,
  queen: l.bees.some((b) => b.kind === 'queen'),
  goals: l.bees.filter((b) => b.kind !== 'hornet').length,
  slack: l.moveBudget - l.bees.filter((b) => b.kind !== 'hornet').length,
  loss: lossRate(l),
}))

const pct = (x: number) => `${Math.round(x * 100)}%`

console.log('\nSMART-GREEDY LOSS = does a competent player have to plan ahead?')
console.log('ch | goals | dry moves | queen lvls | smart-greedy loss | free levels (0%)')
console.log('---|-------|-----------|------------|-------------------|------------------')
for (let ch = 1; ch <= 6; ch++) {
  const g = rows.filter((r) => r.chapter === ch)
  const avg = g.reduce((a, r) => a + r.loss, 0) / g.length
  const span = (a: number[]) => `${Math.min(...a)}–${Math.max(...a)}`
  console.log(
    ` ${ch} | ${span(g.map((r) => r.goals)).padEnd(6)}|    ${span(g.map((r) => r.dry)).padEnd(7)}|    ${String(g.filter((r) => r.queen).length).padStart(2)}/${g.length}    |        ${pct(avg).padStart(4)}       |      ${g.filter((r) => r.loss === 0).length}/${g.length}`,
  )
}

console.log('\n15-level windows (should trend UP):')
for (let w = 0; w < 150; w += 15) {
  const g = rows.slice(w, w + 15)
  const a = g.reduce((s, r) => s + r.loss, 0) / g.length
  console.log(`  L${String(w + 1).padStart(3)}-${String(w + 15).padStart(3)}  ${pct(a).padStart(4)}  ${'#'.repeat(Math.round(a * 40))}`)
}

const free = rows.filter((r) => r.loss === 0)
console.log(`\nFREE levels (competent play never loses): ${free.length}/150`)
console.log(`Overall smart-greedy loss: ${pct(rows.reduce((s, r) => s + r.loss, 0) / rows.length)}`)

// Does longer-lasting honey actually buy difficulty? (It should, monotonically.)
const m = (a: typeof rows) => (a.length ? pct(a.reduce((s, r) => s + r.loss, 0) / a.length) : '-')
console.log('\nBy how long the trail stays sticky:')
for (const d of [...new Set(rows.map((r) => r.dry))].sort((a, b) => a - b)) {
  const g = rows.filter((r) => r.dry === d)
  console.log(`  dries after ${d} move(s) (${String(g.length).padStart(3)} levels): ${m(g)}`)
}
console.log('')
