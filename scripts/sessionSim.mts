/**
 * Session simulator: how the campaign FEELS to play, not how hard it is.
 *
 * Difficulty tuning so far has measured one number per level (a bot's loss
 * rate). Retention is driven by different things — how long before the first
 * loss, how many tries a wall costs, how often a loss was a near miss (the
 * "one more go" trigger), and whether the reward drip keeps up with the shop.
 * This plays levels in order with the previewing-human bot, retries like a real
 * player, applies the same DifficultyDirector easing (+2 moves after 3 fails),
 * and reports those.
 *
 * Run: npx tsx scripts/sessionSim.mts [firstLevel] [lastLevel] [trials]
 */
import { BoardState } from '../src/systems/BoardState'
import { estimateMinMoves } from '../src/systems/SolverSearch'
import { LEVELS } from '../src/levels'
import { makeRng, mixSeed } from '../src/utils/rng'
import type { LevelData } from '../src/types'

const FROM = Number(process.argv[2] ?? 1)
const TO = Number(process.argv[3] ?? 300)
const TRIALS = Number(process.argv[4] ?? 12)

const FAILS_BEFORE_BONUS = 3
const BONUS_MOVES = 2

interface Attempt {
  won: boolean
  goalsLeft: number
  stars: number
}

/**
 * One playthrough by the previewing-human proxy: simulate each legal move one
 * ply, keep the least-blocking, never release the queen early, never bump.
 * Mirrors `plannerLossRate`'s policy but reports HOW the run ended, which is
 * what near-miss accounting needs.
 */
function playOnce(level: LevelData, bonusMoves: number, seed: number): Attempt {
  const b = new BoardState({ ...level, moveBudget: level.moveBudget + bonusMoves })
  const rand = makeRng(mixSeed(seed, 7919))
  for (let s = 0; s < 400; s++) {
    if (b.remaining === 0) {
      const spare = b.moveBudget - b.movesUsed
      const stars = spare >= level.threeStarSpare ? 3 : spare > 0 ? 2 : 1
      return { won: true, goalsLeft: 0, stars }
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
    b.tap(pool[Math.floor(rand() * pool.length)].m.o.q, pool[Math.floor(rand() * pool.length)].m.o.r)
  }
  return { won: false, goalsLeft: b.remaining, stars: 0 }
}

interface LevelStat {
  id: number
  firstTryWin: number // share of players clearing on attempt 1
  avgAttempts: number
  nearMissShare: number // of the losses, how many left exactly 1 bee
  avgStars: number
}

const stats: LevelStat[] = []
for (let id = FROM; id <= TO; id++) {
  const level = LEVELS[id - 1]
  let firstWins = 0
  let attemptsTotal = 0
  let losses = 0
  let nearMisses = 0
  let starsTotal = 0

  for (let t = 0; t < TRIALS; t++) {
    let fails = 0
    let attempts = 0
    for (;;) {
      attempts++
      const bonus = fails >= FAILS_BEFORE_BONUS ? BONUS_MOVES : 0
      const r = playOnce(level, bonus, mixSeed(id * 131 + t, attempts))
      if (r.won) {
        if (attempts === 1) firstWins++
        starsTotal += r.stars
        break
      }
      losses++
      if (r.goalsLeft === 1) nearMisses++
      fails++
      if (attempts >= 40) break // pathological: treat as a wall
    }
    attemptsTotal += attempts
  }
  stats.push({
    id,
    firstTryWin: firstWins / TRIALS,
    avgAttempts: attemptsTotal / TRIALS,
    nearMissShare: losses > 0 ? nearMisses / losses : 0,
    avgStars: starsTotal / TRIALS,
  })
}

const avg = (a: number[]): number => a.reduce((x, y) => x + y, 0) / (a.length || 1)
const pct = (n: number): string => `${(n * 100).toFixed(0)}%`

console.log(`\n=== SESSION SIM  L${FROM}–L${TO}, ${TRIALS} players each ===\n`)
console.log('chapter  firstTryWin  avgTries  nearMiss%  avgStars')
for (let ch = Math.ceil(FROM / 25); ch <= Math.ceil(TO / 25); ch++) {
  const s = stats.filter((x) => Math.ceil(x.id / 25) === ch)
  if (!s.length) continue
  console.log(
    `  ${String(ch).padStart(2)}     ${pct(avg(s.map((x) => x.firstTryWin))).padStart(9)}  ` +
      `${avg(s.map((x) => x.avgAttempts)).toFixed(1).padStart(7)}  ` +
      `${pct(avg(s.map((x) => x.nearMissShare))).padStart(8)}  ` +
      `${avg(s.map((x) => x.avgStars)).toFixed(2).padStart(8)}`,
  )
}

// The retention-critical shapes.
const firstLoss = stats.find((s) => s.firstTryWin < 0.999)
console.log(`\nFirst level that ever costs a retry: L${firstLoss?.id ?? '(none)'}`)

const walls = stats.filter((s) => s.avgAttempts >= 4).map((s) => `L${s.id}(${s.avgAttempts.toFixed(1)})`)
console.log(`Walls (>=4 tries on average): ${walls.length}${walls.length ? ' → ' + walls.slice(0, 14).join(', ') : ''}`)

let run = 0
let longestFree = 0
let freeAt = 0
for (const s of stats) {
  if (s.firstTryWin >= 0.999) {
    run++
    if (run > longestFree) {
      longestFree = run
      freeAt = s.id
    }
  } else run = 0
}
console.log(`Longest streak of never-fail levels: ${longestFree} (ending L${freeAt})`)
console.log(`Overall first-try win rate: ${pct(avg(stats.map((s) => s.firstTryWin)))}`)
console.log(`Overall near-miss share of losses: ${pct(avg(stats.map((s) => s.nearMissShare)))}`)
console.log(`Average stars per level: ${avg(stats.map((s) => s.avgStars)).toFixed(2)} / 3`)
