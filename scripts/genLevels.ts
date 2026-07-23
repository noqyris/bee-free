/**
 * Offline level generator (spec §4). Run with `npm run gen:levels`.
 *
 * Builds all 150 levels from the difficulty curve, verifies each is solvable
 * within its move budget, and writes them as static JSON. Levels are NOT
 * generated at runtime — this file's output is shipped as-is.
 *
 * Generation is CPU-heavy (full BFS validation + careless-loss sampling per
 * honey placement), so the parent process shards the id range across all cores
 * by re-spawning itself with `--shard START END`; a shard prints its levels as
 * JSON on stdout and the parent merges them back in id order.
 */
import { spawn } from 'node:child_process'
import { cpus, tmpdir } from 'node:os'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { buildLevelCurve, type LevelSlot } from '../src/config/levelCurve'
import { shapeCells, shapeLabel } from '../src/systems/boardShapes'
import { generateLevel } from '../src/systems/LevelGenerator'

const here = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const OUT = resolve(here, '../src/levels/levels.generated.json')

interface OutBee {
  q: number
  r: number
  dir: number
  kind: 'bee' | 'queen' | 'hornet'
}
interface OutLevel {
  id: number
  chapter: number
  shape: string
  cells: Array<[number, number]>
  honeyCells: Array<[number, number]>
  bees: OutBee[]
  moveBudget: number
  threeStarSpare: number
  difficulty: number
  depDepth: number
  hornets: number
  hasQueen: boolean
  minMoves: number
  /** Measured careless-loss (fraction of mindless plays that lose). */
  planningLoss: number
  /** The floor this level was required to clear (for the tuning report). */
  planningFloor: number
}

/** Generate a single level from its curve slot, returning the level + any hard failures. */
function genOne(slot: LevelSlot): { level: OutLevel; failures: string[] } {
  const failures: string[] = []
  const cells = shapeCells(slot.shape)
  const { occupants, honeyCells, minMoves, metrics, planningLoss } = generateLevel({
    boardCells: cells,
    targetBees: slot.targetBees,
    minDepth: slot.minDepth,
    maxDepth: slot.maxDepth,
    rayBias: slot.rayBias,
    hasQueen: slot.hasQueen,
    hornets: slot.hornets,
    honey: slot.honey,
    slack: slot.slack,
    planningFloor: slot.planningFloor,
    seed: slot.seed,
    attempts: slot.attempts,
  })

  // metrics.beeCount = goal occupants (bees + queen). minMoves accounts for
  // honey detours (== goals when there is no honey); the budget is over minMoves.
  const goals = metrics.beeCount
  const moveBudget = minMoves + slot.slack
  if (!metrics.solvable) failures.push(`L${slot.id}: NOT solvable`)
  if (goals < 2) failures.push(`L${slot.id}: only ${goals} goal occupants`)
  if (moveBudget < minMoves) failures.push(`L${slot.id}: budget < minMoves`)
  if (slot.threeStarSpare > moveBudget - minMoves)
    failures.push(`L${slot.id}: 3-star spare unreachable`)
  if (slot.hasQueen && !metrics.hasQueen) failures.push(`L${slot.id}: queen requested but absent`)
  if (slot.honey > 0 && honeyCells.length === 0)
    failures.push(`L${slot.id}: honey requested but none placed solvably`)

  return {
    level: {
      id: slot.id,
      chapter: slot.chapter,
      shape: shapeLabel(slot.shape),
      cells: cells.map(([q, r]) => [q, r] as [number, number]),
      honeyCells,
      bees: occupants.map((b) => ({ q: b.q, r: b.r, dir: b.dir, kind: b.kind })),
      moveBudget,
      threeStarSpare: Math.min(slot.threeStarSpare, moveBudget - minMoves),
      difficulty: Math.round(metrics.difficulty * 10) / 10,
      depDepth: metrics.depDepth,
      hornets: metrics.hornets,
      hasQueen: metrics.hasQueen,
      minMoves,
      planningLoss: Math.round(planningLoss * 100) / 100,
      planningFloor: Math.round(slot.planningFloor * 100) / 100,
    },
    failures,
  }
}

// ---- Shard mode: generate a contiguous id range, print JSON on stdout. ----
const shardArg = process.argv.indexOf('--shard')
if (shardArg !== -1) {
  const start = Number(process.argv[shardArg + 1])
  const end = Number(process.argv[shardArg + 2])
  const outFile = process.argv[shardArg + 3]
  const slots = buildLevelCurve().filter((s) => s.id >= start && s.id <= end)
  const levels: OutLevel[] = []
  const failures: string[] = []
  for (const slot of slots) {
    const r = genOne(slot)
    levels.push(r.level)
    failures.push(...r.failures)
  }
  // Write to a file, not stdout: the payload far exceeds the pipe buffer, and a
  // partial/async stdout write would truncate it (or fall through to parent mode).
  writeFileSync(outFile, JSON.stringify({ levels, failures }))
  process.exit(0)
}

// ---- Parent mode: fan out shards across cores, merge, write, summarize. ----
function runShard(start: number, end: number): Promise<{ levels: OutLevel[]; failures: string[] }> {
  return new Promise((res, rej) => {
    const outFile = join(tmpdir(), `beefree-shard-${start}-${end}.json`)
    // Re-invoke via the SAME runtime as the parent (tsx registers a .ts loader
    // through execArgv); a bare `node` child can't import TypeScript.
    const child = spawn(
      process.execPath,
      [...process.execArgv, process.argv[1], '--shard', String(start), String(end), outFile],
      { env: process.env },
    )
    let err = ''
    child.stderr.on('data', (d) => (err += d))
    child.on('close', (code) => {
      if (code !== 0) return rej(new Error(`shard ${start}-${end} exited ${code}:\n${err}`))
      try {
        const parsed = JSON.parse(readFileSync(outFile, 'utf8'))
        rmSync(outFile, { force: true })
        res(parsed)
      } catch (e) {
        rej(new Error(`shard ${start}-${end} unreadable: ${(e as Error).message}\nstderr:\n${err}`))
      }
    })
  })
}

const curve = buildLevelCurve()
const workers = Math.max(1, Math.min(cpus().length - 1, 8))
const perShard = Math.ceil(curve.length / workers)
const ranges: Array<[number, number]> = []
for (let i = 0; i < curve.length; i += perShard) {
  ranges.push([curve[i].id, curve[Math.min(i + perShard, curve.length) - 1].id])
}

console.log(`Generating ${curve.length} levels across ${ranges.length} workers...`)
const t0 = Date.now()
const results = await Promise.all(ranges.map(([a, b]) => runShard(a, b)))
const levels = results.flatMap((r) => r.levels).sort((a, b) => a.id - b.id)
const failures = results.flatMap((r) => r.failures)

if (failures.length > 0) {
  console.error('\nGeneration failures:')
  for (const f of failures) console.error('  ' + f)
  process.exit(1)
}

writeFileSync(OUT, JSON.stringify({ schema: 1, count: levels.length, levels }, null, 0) + '\n')
console.log(`\nGenerated ${levels.length} levels in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${OUT}\n`)

// Per-chapter summary for a human sanity check.
console.log('Chapter | goals(min–max) | depth(min–max) | queens | hornets | honey | careless-loss(avg) | difficulty(avg)')
console.log('--------|----------------|----------------|--------|---------|-------|--------------------|----------------')
for (let ch = 1; ch <= 6; ch++) {
  const g = levels.filter((l) => l.chapter === ch)
  const goalsOf = (l: OutLevel) => l.bees.filter((b) => b.kind !== 'hornet').length
  const goals = g.map(goalsOf)
  const depth = g.map((l) => l.depDepth)
  const diff = g.map((l) => l.difficulty)
  const queens = g.filter((l) => l.hasQueen).length
  const hornets = g.reduce((a, l) => a + l.hornets, 0)
  const honeyLvls = g.filter((l) => l.honeyCells.length > 0).length
  const rng = (a: number[]) => `${Math.min(...a)}–${Math.max(...a)}`
  const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)
  const cl = (g.reduce((a, l) => a + l.planningLoss, 0) / g.length) * 100
  console.log(
    `   ${ch}    |    ${rng(goals).padEnd(11)}| ${rng(depth).padEnd(15)}|   ${String(queens).padEnd(5)}|   ${String(hornets).padEnd(6)}| ${String(honeyLvls).padEnd(6)}|        ${(cl.toFixed(0) + '%').padEnd(11)}|  ${avg(diff)}`,
  )
}

// Report any level that failed to reach its rising careless-loss floor.
const short = levels.filter((l) => l.planningLoss + 0.02 < l.planningFloor)
if (short.length > 0) {
  console.log(`\n${short.length} level(s) BELOW their careless-loss floor (tune the curve):`)
  for (const l of short)
    console.log(
      `  L${l.id}: got ${(l.planningLoss * 100).toFixed(0)}% vs floor ${(l.planningFloor * 100).toFixed(0)}%  (honey ${l.honeyCells.length}, queen ${l.hasQueen ? 'Y' : 'n'}, hornets ${l.hornets})`,
    )
} else {
  console.log('\nAll levels meet their careless-loss floor. ✓')
}
console.log('')
