/**
 * Per-level difficulty profiler (tuning aid, not part of the build).
 *   npx tsx scripts/difficulty.ts            # curve + monotonicity report
 *   npx tsx scripts/difficulty.ts --rows     # one line per level
 *
 * The ground-truth "how much thinking does this level demand?" signal is the
 * CARELESS-LOSS RATE: the fraction of mindless playthroughs (tap any random
 * occupant whose outcome is escape/stick, ignore the queen-last rule) that LOSE.
 * 0% = you can win without thinking; high = careless play is punished.
 *
 * We also print the structural levers (bees, depth, slack, honey, queen,
 * hornets) and a blended difficulty score, then flag every place the curve goes
 * DOWN as the level id goes up (a "harder and harder" curve should have none of
 * consequence).
 */
import { LEVELS } from '../src/levels'
import { BoardState } from '../src/systems/BoardState'
import { makeRng, mixSeed } from '../src/utils/rng'
import type { LevelData } from '../src/types'

const TRIALS = 120

/** Fraction of mindless playthroughs that lose (see file header). */
function carelessLoss(level: LevelData): number {
  let losses = 0
  for (let t = 0; t < TRIALS; t++) {
    const rand = makeRng(mixSeed(level.id * 2654435761, (t + 1) * 40503))
    const b = new BoardState(level)
    let won = false
    for (let s = 0; s < 500; s++) {
      if (b.remaining === 0) {
        won = true
        break
      }
      if (b.status !== 'playing') break
      const opts = b.allOccupants().filter((o) => o.isTappable() && b.trace(o).kind !== 'blocked')
      if (opts.length === 0) break
      const o = opts[Math.floor(rand() * opts.length)]
      b.tap(o.q, o.r)
    }
    if (!won) losses++
  }
  return losses / TRIALS
}

interface Row {
  id: number
  chapter: number
  goals: number
  honey: number
  queen: boolean
  hornets: number
  depth: number
  budget: number
  minMoves: number
  slack: number
  careless: number // 0..1
  score: number
}

const rows: Row[] = LEVELS.map((l) => {
  const goals = l.bees.filter((b) => b.kind !== 'hornet').length
  const hornets = l.bees.filter((b) => b.kind === 'hornet').length
  const queen = l.bees.some((b) => b.kind === 'queen')
  const honey = l.honeyCells?.length ?? 0
  const careless = carelessLoss(l)
  // minMoves ~= budget - stored slack isn't available; recover from depDepth-free
  // signal: goals + honey detours <= budget. Use budget & goals for the report.
  const slack = l.moveBudget - goals
  // Blended score: careless-loss dominates (it's the real signal), the rest add
  // texture for tie-breaking / sanity.
  const score =
    careless * 100 +
    goals * 1.2 +
    (l.depDepth ?? 0) * 3 +
    honey * 4 +
    (queen ? 6 : 0) +
    hornets * 3 -
    slack * 4
  return {
    id: l.id,
    chapter: l.chapter ?? Math.ceil(l.id / 25),
    goals,
    honey,
    queen,
    hornets,
    depth: l.depDepth ?? 0,
    budget: l.moveBudget,
    minMoves: l.moveBudget - slack,
    slack,
    careless,
    score,
  }
})

const pct = (x: number) => `${Math.round(x * 100)}%`

if (process.argv.includes('--rows')) {
  console.log('id  ch  goals depth honey queen horn slack  careless  score')
  for (const r of rows) {
    console.log(
      `${String(r.id).padStart(3)} ${r.chapter}   ${String(r.goals).padStart(2)}    ${String(r.depth).padStart(2)}    ${String(r.honey).padStart(2)}    ${r.queen ? 'Q' : '.'}    ${String(r.hornets)}    ${String(r.slack).padStart(2)}   ${pct(r.careless).padStart(4)}    ${r.score.toFixed(0)}`,
    )
  }
}

// Per-chapter summary.
console.log('\nPer-chapter difficulty (careless-loss = fraction of mindless plays that LOSE):')
console.log('ch | goals(avg) | depth(avg) | honey lvls | queen lvls | careless-loss(avg) | score(avg)')
console.log('---|------------|------------|------------|------------|--------------------|----------')
for (let ch = 1; ch <= 6; ch++) {
  const g = rows.filter((r) => r.chapter === ch)
  const avg = (f: (r: Row) => number) => g.reduce((a, r) => a + f(r), 0) / g.length
  console.log(
    ` ${ch} |    ${avg((r) => r.goals).toFixed(1).padStart(4)}    |    ${avg((r) => r.depth).toFixed(1).padStart(4)}    |    ${String(g.filter((r) => r.honey > 0).length).padStart(2)}/${g.length}    |    ${String(g.filter((r) => r.queen).length).padStart(2)}/${g.length}    |        ${pct(avg((r) => r.careless)).padStart(4)}        |   ${avg((r) => r.score).toFixed(0)}`,
  )
}

// Windowed careless-loss to see the shape of the "does it demand thought?" curve.
console.log('\nCareless-loss in 15-level windows (should trend UP):')
for (let w = 0; w < 150; w += 15) {
  const g = rows.slice(w, w + 15)
  const a = g.reduce((s, r) => s + r.careless, 0) / g.length
  const bar = '█'.repeat(Math.round(a * 40))
  console.log(`  L${String(w + 1).padStart(3)}-${String(w + 15).padStart(3)}  ${pct(a).padStart(4)}  ${bar}`)
}

// Monotonicity: how often does difficulty DROP as id rises? Compare each level
// to the trailing 5-level average (a local dip, robust to saw-tooth spikes).
let dips = 0
let bigDips = 0
for (let i = 5; i < rows.length; i++) {
  const prevAvg = rows.slice(i - 5, i).reduce((s, r) => s + r.score, 0) / 5
  if (rows[i].score < prevAvg) dips++
  if (rows[i].score < prevAvg - 15) bigDips++
}
console.log(`\nMonotonicity: ${dips}/145 levels dip below their trailing-5 average (${bigDips} by a large margin).`)

const zeroCareless = rows.filter((r) => r.careless === 0)
console.log(
  `\nMindless-winnable levels (careless-loss = 0%): ${zeroCareless.length}/150` +
    (zeroCareless.length ? `  →  ${zeroCareless.map((r) => r.id).join(', ')}` : ''),
)
const overall = rows.reduce((s, r) => s + r.careless, 0) / rows.length
console.log(`Overall careless-loss across all 150: ${pct(overall)}\n`)
