/**
 * Auto-tune every level's MOVE BUDGET to hit a target first-try win rate.
 *
 * Why this is possible at all: the boards are already generated, verified and
 * playtested, and `minMoves` is recorded for each one. The budget is the only
 * number that has to change, so the whole curve can be retuned in minutes
 * instead of the ~90-minute regeneration a board change would cost — and the
 * levels themselves are not touched.
 *
 * Why it is worth doing: measured first-try win rates run 29-39% through
 * chapters 8-12, i.e. a player fails two levels out of three. That is a churn
 * curve. And until the sealed-hive rescue landed, budget was an inert dial
 * (slack 1 -> 4 moved the win rate 32% -> 33%), so this could not have worked
 * before. Now it does: 54/56/58/59% for slack 1/2/3/4.
 *
 * For each level it finds the SMALLEST slack whose simulated first-try win rate
 * clears the target for that part of the game — smallest, so levels stay as
 * tight as the target allows rather than being flooded with spare moves.
 *
 * Run: npx tsx scripts/retuneBudgets.mts [--apply] [--players N]
 * Without --apply it reports and writes nothing.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { cpus, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { BoardState } from '../src/systems/BoardState'
import { estimateMinMoves } from '../src/systems/SolverSearch'
import { makeRng, mixSeed } from '../src/utils/rng'
import type { LevelData } from '../src/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const LEVELS_PATH = resolve(HERE, '../src/levels/levels.generated.json')
const APPLY = process.argv.includes('--apply')
const playersArg = process.argv.indexOf('--players')
const PLAYERS = playersArg === -1 ? 8 : Number(process.argv[playersArg + 1])

const NOISE = 0.25

interface RawLevel {
  id: number
  minMoves: number
  moveBudget: number
  threeStarSpare: number
  [k: string]: unknown
}

const file = JSON.parse(readFileSync(LEVELS_PATH, 'utf8')) as { levels: RawLevel[] }

/**
 * The RESCUE FLOOR: the first-try win rate below which a level reads as a wall
 * rather than a challenge.
 *
 * Deliberately a floor and not a target. A first pass aimed at proper target
 * rates (85% early falling to 52%) and the result argued against itself: 177
 * of 300 levels could not reach their target even with six spare moves, 183
 * wanted the maximum, and the projected win rate still only reached 50% — for
 * an average of +3 moves per level, which would hand a competent player a
 * trivial game and flatten the star ladder that was just built. Budget turns
 * out to be a real dial but a weak one, because the losses it fixes are not the
 * losses players have.
 *
 * So this only rescues levels that are measurably punishing, and grants at most
 * two moves over what they ship with. It removes rage-quit spikes without
 * retuning a curve that four playtest passes already shaped — and without
 * betting the game on a bot whose absolute calibration is unproven.
 */
const FLOOR = 0.4
const MAX_EXTRA = 2

/** One playthrough with the rescue loop and a noisy (i.e. human) player. */
function play(level: LevelData, seed: number): boolean {
  let b = new BoardState(level)
  const rand = makeRng(mixSeed(seed, 7919))
  const history: BoardState[] = []
  const forbidden = new Set<string>()
  for (let s = 0; s < 400; s++) {
    if (b.remaining === 0) return true
    if (b.status !== 'playing') return false
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
      b.chargeMove()
      if (b.status !== 'playing') return false
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
    if (scored.length === 0) {
      b.chargeMove()
      if (b.status !== 'playing') return false
      continue
    }
    let pool = scored
    if (rand() >= NOISE) {
      const best = Math.min(...scored.map((x) => x.h))
      const p0 = scored.filter((x) => x.h === best)
      const bestEsc = Math.min(...p0.map((x) => x.esc))
      pool = p0.filter((x) => x.esc === bestEsc)
    }
    const pick = pool[Math.floor(rand() * pool.length)]
    history.push(b.clone())
    b.tap(pick.m.o.q, pick.m.o.r)
    if (b.isSealed()) {
      const prev = history.pop()
      if (prev) {
        forbidden.add(`${posKey}#${pick.m.o.q},${pick.m.o.r}`)
        b = prev
        b.chargeMove()
      }
    }
  }
  return false
}

function winRate(raw: RawLevel, slack: number): number {
  const level = {
    ...(raw as unknown as LevelData),
    moveBudget: raw.minMoves + slack,
    threeStarSpare: slack,
  }
  let wins = 0
  for (let t = 0; t < PLAYERS; t++) if (play(level, mixSeed(raw.id * 977 + slack, t))) wins++
  return wins / PLAYERS
}

interface Tuned {
  id: number
  slack: number
  rate: number
  oldBudget: number
  newBudget: number
  capped: boolean
}

function tune(raw: RawLevel): Tuned {
  const shippedSlack = raw.moveBudget - raw.minMoves
  const shippedRate = winRate(raw, shippedSlack)
  // Fine as it ships: leave it exactly alone.
  if (shippedRate >= FLOOR) {
    return {
      id: raw.id,
      slack: shippedSlack,
      rate: shippedRate,
      oldBudget: raw.moveBudget,
      newBudget: raw.moveBudget,
      capped: false,
    }
  }
  let best = { slack: shippedSlack, rate: shippedRate }
  for (let extra = 1; extra <= MAX_EXTRA; extra++) {
    const slack = shippedSlack + extra
    const rate = winRate(raw, slack)
    if (rate > best.rate) best = { slack, rate }
    if (rate >= FLOOR) {
      return {
        id: raw.id,
        slack,
        rate,
        oldBudget: raw.moveBudget,
        newBudget: raw.minMoves + slack,
        capped: false,
      }
    }
  }
  // Two extra moves still leaves it a wall — the BOARD is the problem, not the
  // budget. Take the best of what we tried and flag it for regeneration.
  return {
    id: raw.id,
    slack: best.slack,
    rate: best.rate,
    oldBudget: raw.moveBudget,
    newBudget: raw.minMoves + best.slack,
    capped: true,
  }
}

// ---- shard mode ----
const shardArg = process.argv.indexOf('--shard')
if (shardArg !== -1) {
  const offset = Number(process.argv[shardArg + 1])
  const stride = Number(process.argv[shardArg + 2])
  const outFile = process.argv[shardArg + 3]
  const out: Tuned[] = []
  for (const raw of file.levels) if ((raw.id - 1) % stride === offset) out.push(tune(raw))
  writeFileSync(outFile, JSON.stringify(out))
  process.exit(0)
}

// ---- parent ----
function runShard(offset: number, stride: number): Promise<Tuned[]> {
  return new Promise((res, rej) => {
    const outFile = join(tmpdir(), `beefree-retune-${offset}-of-${stride}.json`)
    const child = spawn(
      process.execPath,
      [...process.execArgv, process.argv[1], '--shard', String(offset), String(stride), outFile, '--players', String(PLAYERS)],
      { env: process.env },
    )
    let err = ''
    child.stderr.on('data', (d) => (err += d))
    child.on('close', (code) => {
      if (code !== 0) return rej(new Error(`shard ${offset} exited ${code}:\n${err}`))
      const parsed = JSON.parse(readFileSync(outFile, 'utf8')) as Tuned[]
      rmSync(outFile, { force: true })
      res(parsed)
    })
  })
}

const workers = Math.max(1, Math.min(cpus().length - 1, 8))
console.log(`Tuning ${file.levels.length} budgets across ${workers} workers (${PLAYERS} players/level)...`)
const t0 = Date.now()
const tuned = (await Promise.all(Array.from({ length: workers }, (_, i) => runShard(i, workers))))
  .flat()
  .sort((a, b) => a.id - b.id)

const changed = tuned.filter((t) => t.newBudget !== t.oldBudget)
const capped = tuned.filter((t) => t.capped)
const avg = (a: number[]): number => a.reduce((x, y) => x + y, 0) / (a.length || 1)

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(0)}s.`)
console.log(`budgets changed: ${changed.length}/${tuned.length}`)
console.log(`slack distribution: ${JSON.stringify(tuned.reduce<Record<number, number>>((a, t) => ((a[t.slack] = (a[t.slack] ?? 0) + 1), a), {}))}`)
console.log(`extra moves granted, average: +${avg(tuned.map((t) => t.newBudget - t.oldBudget)).toFixed(2)}`)
console.log(`projected first-try win rate: ${(100 * avg(tuned.map((t) => t.rate))).toFixed(0)}%`)
console.log(`levels a budget CANNOT fix (need regenerating): ${capped.length}${capped.length ? ' → ' + capped.slice(0, 20).map((t) => `L${t.id}(${(100 * t.rate).toFixed(0)}%)`).join(', ') : ''}`)

if (!APPLY) {
  console.log('\nDRY RUN — re-run with --apply to write levels.generated.json.')
  process.exit(0)
}

for (const t of tuned) {
  const raw = file.levels[t.id - 1]
  raw.moveBudget = t.newBudget
  raw.threeStarSpare = t.slack
}
writeFileSync(LEVELS_PATH, JSON.stringify(file) + '\n')
console.log(`\nWrote ${LEVELS_PATH}`)
