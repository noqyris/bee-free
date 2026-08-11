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
import generated from '../src/levels/levels.generated.json'

const FROM = Number(process.argv[2] ?? 1)
const TO = Number(process.argv[3] ?? 300)
const TRIALS = Number(process.argv[4] ?? 12)
/** Pass --no-rescue to measure the old behaviour for a before/after. */
const RESCUE = !process.argv.includes('--no-rescue')
/**
 * `--slack N` re-budgets every level to minMoves + N (and asks for at most one
 * wasted move for 3 stars) instead of using the shipped numbers. Retuning this
 * way needs no regeneration: minMoves is already recorded and verified for
 * every level, so the boards are untouched and only the budget moves.
 */
const slackArg = process.argv.indexOf('--slack')
const SLACK = slackArg === -1 ? null : Number(process.argv[slackArg + 1])
/**
 * `--noise p` — the share of moves where the player does NOT pick the best one.
 *
 * Without this the model is a 1-ply-optimal bot, and an optimal player wins
 * with zero moves wasted every single time, so stars are always 3 and the
 * budget can never bind. That is an artefact of the instrument, not of the
 * game: real players misjudge. Noise is what makes "won, but sloppily" — the
 * outcome 1- and 2-star wins exist to represent — possible at all.
 */
const noiseArg = process.argv.indexOf('--noise')
const NOISE = noiseArg === -1 ? 0.25 : Number(process.argv[noiseArg + 1])

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
  let b = new BoardState({ ...level, moveBudget: level.moveBudget + bonusMoves })
  const rand = makeRng(mixSeed(seed, 7919))
  // The dead-end rescue, modelled exactly as the scene applies it: a move that
  // seals the hive is rewound and charged. `history` is the scene's undo stack;
  // `forbidden` is the player learning "not that one from here", which is why a
  // rescue leads somewhere new instead of looping on the same mistake.
  const history: BoardState[] = []
  const forbidden = new Set<string>()

  for (let s = 0; s < 400; s++) {
    if (b.remaining === 0) {
      const spare = b.moveBudget - b.movesUsed
      const stars = spare >= level.threeStarSpare ? 3 : spare > 0 ? 2 : 1
      return { won: true, goalsLeft: 0, stars }
    }
    if (b.status !== 'playing') break
    const posKey = b.stateKey()
    const goalsLeft = b.allOccupants().filter((o) => o.isGoal()).length
    const cands = b
      .allOccupants()
      .filter((o) => o.isTappable())
      .map((o) => ({ o, out: b.trace(o) }))
      .filter((m) => m.out.kind !== 'blocked')
      .filter((m) => !(m.o.kind === 'queen' && m.out.kind === 'escaped' && goalsLeft > 1))
      .filter((m) => !forbidden.has(`${posKey}#${m.o.q},${m.o.r}`))
    if (cands.length === 0) {
      // Every move from here either bumps or seals. A real player does not stop
      // at that moment — they keep trying, each attempt rewound and charged,
      // until the budget is gone. Modelling that is what makes the loss land on
      // the MOVE COUNTER (with a countable number of bees left) instead of on
      // "the simulation gave up", and it is the only way the budget can show up
      // as a dial at all.
      b.chargeMove()
      if (b.status !== 'playing') break
      continue
    }
    const scored = cands
      .map((m) => {
        const child = b.clone()
        child.tap(m.o.q, m.o.r)
        if (child.status === 'lost') return null
        return { m, h: estimateMinMoves(child), esc: m.out.kind === 'escaped' ? 0 : 1 }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    if (scored.length === 0) break
    let pool: typeof scored
    if (rand() < NOISE) {
      pool = scored // a misjudged move: any legal one, best or not
    } else {
      const best = Math.min(...scored.map((x) => x.h))
      const pool0 = scored.filter((x) => x.h === best)
      const bestEsc = Math.min(...pool0.map((x) => x.esc))
      pool = pool0.filter((x) => x.esc === bestEsc)
    }
    const pick = pool[Math.floor(rand() * pool.length)]

    history.push(b.clone())
    b.tap(pick.m.o.q, pick.m.o.r)

    if (RESCUE && b.isSealed()) {
      const prev = history.pop()
      if (prev) {
        forbidden.add(`${posKey}#${pick.m.o.q},${pick.m.o.r}`)
        b = prev
        b.chargeMove()
      }
    }
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
  const shipped = LEVELS[id - 1]
  const min = (generated.levels[id - 1] as { minMoves: number }).minMoves
  const level: LevelData =
    SLACK === null
      ? shipped
      // 3 stars = spare EQUAL to the slack, i.e. not one move wasted. That is
      // what turns the budget into a legible ladder: perfect play 3 stars, one
      // wasted move 2, two wasted 1, and only then a loss.
      : { ...shipped, moveBudget: min + SLACK, threeStarSpare: SLACK }
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

console.log(
  `\n=== SESSION SIM  L${FROM}–L${TO}, ${TRIALS} players each  (rescue ${RESCUE ? 'ON' : 'OFF'}, slack ${SLACK ?? 'shipped'}) ===\n`,
)
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
