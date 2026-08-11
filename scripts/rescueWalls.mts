/**
 * Replace the levels that are WALLS — boards a budget cannot fix.
 *
 * `retuneBudgets.mts` grants up to two extra moves to punishing levels and
 * flags the ones still under the floor afterwards. Those are boards, not
 * budgets: L140 measured a 0% first-try win rate for a realistic player, L115
 * 3%, L145 7%. No number of spare moves rescues a board that a player cannot
 * read, and a curve with 88 of them is a churn curve however good the rest is.
 *
 * So each flagged level is regenerated IN PLACE from its own curve slot, with
 * the planner floor walked down step by step (the floor is what made the
 * generator pick the meanest layout it could find). The first candidate that
 * both re-proves solvable and clears the measured win-rate floor is kept; the
 * other 200-odd levels are never touched.
 *
 * Run: npx tsx scripts/rescueWalls.mts [--apply] [--players N]
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { cpus, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { BoardState } from '../src/systems/BoardState'
import { estimateMinMoves, searchMinMoves } from '../src/systems/SolverSearch'
import { generateLevel } from '../src/systems/LevelGenerator'
import { slotFor } from '../src/config/levelCurve'
import { shapeCells } from '../src/systems/boardShapes'
import { makeRng, mixSeed } from '../src/utils/rng'
import type { LevelData } from '../src/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const LEVELS_PATH = resolve(HERE, '../src/levels/levels.generated.json')
const APPLY = process.argv.includes('--apply')
const playersArg = process.argv.indexOf('--players')
const PLAYERS = playersArg === -1 ? 24 : Number(process.argv[playersArg + 1])
const FLOOR = 0.4
const NOISE = 0.25

interface RawLevel {
  id: number
  minMoves: number
  moveBudget: number
  threeStarSpare: number
  cells: Array<[number, number]>
  honeyCells: Array<[number, number]>
  bees: Array<{ q: number; r: number; dir: number; kind: string }>
  [k: string]: unknown
}

const file = JSON.parse(readFileSync(LEVELS_PATH, 'utf8')) as { levels: RawLevel[] }

/** A realistic player: 1-ply planning, 25% misjudged moves, rescue on seal. */
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

function winRate(level: LevelData, salt: number): number {
  let wins = 0
  for (let t = 0; t < PLAYERS; t++) if (play(level, mixSeed(salt, t))) wins++
  return wins / PLAYERS
}

const asLevel = (raw: RawLevel): LevelData => raw as unknown as LevelData

/** Regenerate one level from its slot at a softened planner floor. */
function rescue(raw: RawLevel): { raw: RawLevel; rate: number; changed: boolean } {
  const before = winRate(asLevel(raw), raw.id * 31)
  if (before >= FLOOR) return { raw, rate: before, changed: false }

  const slot = slotFor(raw.id)
  const cells = shapeCells(slot.shape)
  let best: { raw: RawLevel; rate: number } = { raw, rate: before }

  // Walk the planner floor down. It is the knob that told the generator to keep
  // hunting for the meanest layout; relaxing it is what lets a readable board
  // through, and the slot keeps everything else (shape, bees, queen) intact.
  for (const scale of [0.7, 0.5, 0.3, 0.15, 0]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const floor = slot.plannerFloor * scale
      let out
      try {
        out = generateLevel({
          boardCells: cells,
          targetBees: slot.targetBees,
          minDepth: slot.minDepth,
          maxDepth: slot.maxDepth,
          rayBias: slot.rayBias,
          hasQueen: slot.hasQueen,
          hornets: slot.hornets,
          slack: slot.slack,
          planningFloor: slot.planningFloor * scale,
          planningTarget: slot.planningTarget * scale,
          plannerFloor: floor,
          plannerTarget: Math.max(floor, slot.plannerTarget * scale),
          maxForcedStops: slot.maxForcedStops,
          honeyLakes: slot.honeyLakes,
          floodCoverage: slot.floodCoverage,
          restarts: slot.restarts,
          seed: mixSeed(slot.seed + raw.id * 9173, attempt * 101 + Math.round(scale * 100)),
          attempts: slot.attempts,
        })
      } catch {
        continue
      }
      if (!out.metrics.solvable) continue

      const budget = out.minMoves + Math.max(1, raw.moveBudget - raw.minMoves)
      const candidate: RawLevel = {
        ...raw,
        cells: cells.map(([q, r]) => [q, r] as [number, number]),
        honeyCells: out.honeyCells as Array<[number, number]>,
        bees: out.occupants.map((o) => ({ q: o.q, r: o.r, dir: o.dir, kind: o.kind })),
        moveBudget: budget,
        threeStarSpare: Math.min(Number(raw.threeStarSpare), budget - out.minMoves),
        minMoves: out.minMoves,
        planningLoss: out.planningLoss,
        plannerLoss: out.plannerLoss,
        plannerFloor: floor,
      }
      // Ground truth: it must still be clearable within its own budget.
      if (searchMinMoves(new BoardState(asLevel(candidate)), budget, 4_000_000) === null) continue

      const rate = winRate(asLevel(candidate), raw.id * 31 + attempt + 1)
      if (rate > best.rate) best = { raw: candidate, rate }
      if (rate >= FLOOR) return { raw: candidate, rate, changed: true }
    }
  }
  return { raw: best.raw, rate: best.rate, changed: best.raw !== raw }
}

// ---- shard ----
const shardArg = process.argv.indexOf('--shard')
if (shardArg !== -1) {
  const offset = Number(process.argv[shardArg + 1])
  const stride = Number(process.argv[shardArg + 2])
  const outFile = process.argv[shardArg + 3]
  const out: Array<{ id: number; rate: number; changed: boolean; raw: RawLevel }> = []
  for (const raw of file.levels) {
    if ((raw.id - 1) % stride !== offset) continue
    const r = rescue(raw)
    if (r.changed || r.rate < FLOOR) out.push({ id: raw.id, rate: r.rate, changed: r.changed, raw: r.raw })
  }
  writeFileSync(outFile, JSON.stringify(out))
  process.exit(0)
}

// ---- parent ----
function runShard(offset: number, stride: number): Promise<Array<{ id: number; rate: number; changed: boolean; raw: RawLevel }>> {
  return new Promise((res, rej) => {
    const outFile = join(tmpdir(), `beefree-walls-${offset}-of-${stride}.json`)
    const child = spawn(
      process.execPath,
      [...process.execArgv, process.argv[1], '--shard', String(offset), String(stride), outFile, '--players', String(PLAYERS)],
      { env: process.env },
    )
    let err = ''
    child.stderr.on('data', (d) => (err += d))
    child.on('close', (code) => {
      if (code !== 0) return rej(new Error(`shard ${offset} exited ${code}:\n${err}`))
      res(JSON.parse(readFileSync(outFile, 'utf8')))
      rmSync(outFile, { force: true })
    })
  })
}

const workers = Math.max(1, Math.min(cpus().length - 1, 8))
console.log(`Rescuing walls across ${workers} workers (${PLAYERS} players/level, floor ${FLOOR})...`)
const t0 = Date.now()
const results = (await Promise.all(Array.from({ length: workers }, (_, i) => runShard(i, workers))))
  .flat()
  .sort((a, b) => a.id - b.id)

const fixed = results.filter((r) => r.changed && r.rate >= FLOOR)
const stubborn = results.filter((r) => r.rate < FLOOR)
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(0)}s.`)
console.log(`walls rescued: ${fixed.length}`)
console.log(`still below the floor: ${stubborn.length}${stubborn.length ? ' → ' + stubborn.slice(0, 20).map((r) => `L${r.id}(${(100 * r.rate).toFixed(0)}%)`).join(', ') : ''}`)

if (!APPLY) {
  console.log('\nDRY RUN — re-run with --apply to write levels.generated.json.')
  process.exit(0)
}
for (const r of results) if (r.changed) file.levels[r.id - 1] = r.raw
writeFileSync(LEVELS_PATH, JSON.stringify(file) + '\n')
console.log(`\nWrote ${LEVELS_PATH} (${results.filter((r) => r.changed).length} levels replaced)`)
