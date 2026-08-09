/**
 * Offline level generator (spec §4). Run with `npm run gen:levels`.
 *
 * Builds all 300 levels from the difficulty curve, verifies each is solvable
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
import { BoardState } from '../src/systems/BoardState'
import { searchMinMoves } from '../src/systems/SolverSearch'

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
  /** "Sticky Hive" special: board starts part-flooded, landings carve it clean. */
  flooded: boolean
  minMoves: number
  /** Measured planning pressure (share of unplanned-but-competent plays that lose). */
  planningLoss: number
  /** The floor this level was required to clear (for the tuning report). */
  planningFloor: number
  /** Measured previewing-human (one-ply lookahead) loss — the round-4 metric. */
  plannerLoss: number
  /** The planner floor this level was required to clear. */
  plannerFloor: number
}

/** Generate a single level from its curve slot, returning the level + any hard failures. */
function genOne(slot: LevelSlot): { level: OutLevel; failures: string[] } {
  const failures: string[] = []
  const cells = shapeCells(slot.shape)
  const { occupants, honeyCells, minMoves, metrics, planningLoss, plannerLoss } = generateLevel({
    boardCells: cells,
    targetBees: slot.targetBees,
    minDepth: slot.minDepth,
    maxDepth: slot.maxDepth,
    rayBias: slot.rayBias,
    hasQueen: slot.hasQueen,
    hornets: slot.hornets,
    slack: slot.slack,
    planningFloor: slot.planningFloor,
    planningTarget: slot.planningTarget,
    plannerFloor: slot.plannerFloor,
    plannerTarget: slot.plannerTarget,
    maxForcedStops: slot.maxForcedStops,
    honeyLakes: slot.honeyLakes,
    floodCoverage: slot.floodCoverage,
    restarts: slot.restarts,
    seed: slot.seed,
    attempts: slot.attempts,
  })

  // metrics.beeCount = goal occupants (bees + queen). minMoves accounts for
  // honey-trail detours (== goals on a perfectly orderable board, which is what
  // the generator selects for); the budget is measured over minMoves.
  const goals = metrics.beeCount
  const moveBudget = minMoves + slot.slack
  if (!metrics.solvable) failures.push(`L${slot.id}: NOT solvable`)
  if (goals < 2) failures.push(`L${slot.id}: only ${goals} goal occupants`)
  if (moveBudget < minMoves) failures.push(`L${slot.id}: budget < minMoves`)

  // Ground truth: the SHIPPED board must be clearable within its SHIPPED budget
  // under the real permanent-honey rules. metrics.solvable ignores honey (it only
  // proves a bump-free order exists), so this is the check that actually stops an
  // unwinnable level — the exact bug the old assumed-budget fallback could ship.
  const honeyBoard = new BoardState({
    id: slot.id,
    cells: cells.map(([q, r]) => [q, r] as [number, number]),
    honeyCells,
    bees: occupants.map((o) => ({ q: o.q, r: o.r, dir: o.dir, kind: o.kind })),
    moveBudget,
    threeStarSpare: 0,
  })
  // Generous node cap: a genuinely hard board can need millions of expansions to
  // re-prove its solution, and a too-low cap would false-fail it as "unwinnable".
  if (searchMinMoves(honeyBoard, moveBudget, 8_000_000) === null)
    failures.push(`L${slot.id}: UNWINNABLE within budget ${moveBudget} (min ${minMoves}, goals ${goals})`)
  if (slot.threeStarSpare > moveBudget - minMoves)
    failures.push(`L${slot.id}: 3-star spare unreachable`)
  if (slot.hasQueen && !metrics.hasQueen) failures.push(`L${slot.id}: queen requested but absent`)
  // The tutorial cap is a hard promise (no stuck bees before the mechanic is
  // taught); late levels get a lenient ceiling so a single stubborn slot that
  // fell through to the deep-search fallback cannot brick the whole run.
  // Sticky Hive levels are exempt: carving the seeded honey IS the game, so
  // their ceiling is the seeded count plus re-honey headroom.
  const stops = minMoves - goals
  const stopCeiling =
    slot.floodCoverage > 0
      ? honeyCells.length + 8
      : slot.id <= 15
        ? slot.maxForcedStops
        : slot.maxForcedStops + 3
  if (stops > stopCeiling)
    failures.push(`L${slot.id}: needs ${stops} forced stops (cap ${stopCeiling})`)

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
      flooded: slot.floodCoverage > 0,
      minMoves,
      planningLoss: Math.round(planningLoss * 100) / 100,
      planningFloor: Math.round(slot.planningFloor * 100) / 100,
      plannerLoss: Math.round(plannerLoss * 100) / 100,
      plannerFloor: Math.round(slot.plannerFloor * 100) / 100,
    },
    failures,
  }
}

// ---- Shard mode: generate an interleaved id slice, write JSON to a file. ----
// Round-robin (id-1 % stride === offset), NOT contiguous ranges: generation
// cost climbs steeply with level id (the 9-bee band runs 1–4 min per level vs
// ~1 s in the tutorial), so contiguous shards leave the last worker grinding
// alone for an hour after the rest finish. Interleaving gives every worker the
// same cost mix, cutting wall-clock roughly in half.
const shardArg = process.argv.indexOf('--shard')
if (shardArg !== -1) {
  const offset = Number(process.argv[shardArg + 1])
  const stride = Number(process.argv[shardArg + 2])
  const outFile = process.argv[shardArg + 3]
  const slots = buildLevelCurve().filter((s) => (s.id - 1) % stride === offset)
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
function runShard(offset: number, stride: number): Promise<{ levels: OutLevel[]; failures: string[] }> {
  return new Promise((res, rej) => {
    const outFile = join(tmpdir(), `beefree-shard-${offset}-of-${stride}.json`)
    // Re-invoke via the SAME runtime as the parent (tsx registers a .ts loader
    // through execArgv); a bare `node` child can't import TypeScript.
    const child = spawn(
      process.execPath,
      [...process.execArgv, process.argv[1], '--shard', String(offset), String(stride), outFile],
      { env: process.env },
    )
    let err = ''
    child.stderr.on('data', (d) => (err += d))
    child.on('close', (code) => {
      if (code !== 0) return rej(new Error(`shard ${offset}/${stride} exited ${code}:\n${err}`))
      try {
        const parsed = JSON.parse(readFileSync(outFile, 'utf8'))
        rmSync(outFile, { force: true })
        res(parsed)
      } catch (e) {
        rej(new Error(`shard ${offset}/${stride} unreadable: ${(e as Error).message}\nstderr:\n${err}`))
      }
    })
  })
}

const curve = buildLevelCurve()
const workers = Math.max(1, Math.min(cpus().length - 1, 8))

console.log(`Generating ${curve.length} levels across ${workers} workers (interleaved)...`)
const t0 = Date.now()
const results = await Promise.all(
  Array.from({ length: workers }, (_, i) => runShard(i, workers)),
)
const levels = results.flatMap((r) => r.levels).sort((a, b) => a.id - b.id)
const failures = results.flatMap((r) => r.failures)

if (failures.length > 0) {
  console.error('\nGeneration failures:')
  for (const f of failures) console.error('  ' + f)
  process.exit(1)
}

writeFileSync(OUT, JSON.stringify({ schema: 1, count: levels.length, levels }, null, 0) + '\n')
console.log(`\nGenerated ${levels.length} levels in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${OUT}\n`)

// Per-chapter summary for a human sanity check. "free" counts zero-planningLoss
// levels — boards a competent no-lookahead player never loses — because a back
// half full of those is the failure mode this report exists to catch.
console.log('Chapter | goals(min–max) | budget(min–max) | queens | hornets | forced stops | free(0-loss) | planning-loss(avg) | planner-loss(avg) | planner-free | difficulty(avg)')
console.log('--------|----------------|-----------------|--------|---------|--------------|--------------|--------------------|-------------------|--------------|----------------')
const chapterCount = Math.max(...levels.map((l) => l.chapter))
for (let ch = 1; ch <= chapterCount; ch++) {
  const g = levels.filter((l) => l.chapter === ch)
  const goalsOf = (l: OutLevel) => l.bees.filter((b) => b.kind !== 'hornet').length
  const goals = g.map(goalsOf)
  const budget = g.map((l) => l.moveBudget)
  const diff = g.map((l) => l.difficulty)
  const queens = g.filter((l) => l.hasQueen).length
  const hornets = g.reduce((a, l) => a + l.hornets, 0)
  // Levels where even best play must fly into its own honey at least once.
  const forced = g.filter((l) => l.minMoves > goalsOf(l)).length
  const free = g.filter((l) => l.planningLoss === 0).length
  // Planner columns only mean something where the floor exists (id >= 26).
  const floored = g.filter((l) => l.plannerFloor > 0)
  const plannerFree = floored.filter((l) => l.plannerLoss === 0).length
  const pl =
    floored.length > 0
      ? ((floored.reduce((a, l) => a + l.plannerLoss, 0) / floored.length) * 100).toFixed(0) + '%'
      : '—'
  const rng = (a: number[]) => `${Math.min(...a)}–${Math.max(...a)}`
  const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)
  const cl = (g.reduce((a, l) => a + l.planningLoss, 0) / g.length) * 100
  console.log(
    `   ${String(ch).padEnd(2)}   |    ${rng(goals).padEnd(11)}|     ${rng(budget).padEnd(12)}|   ${String(queens).padEnd(5)}|   ${String(hornets).padEnd(6)}|      ${String(forced).padEnd(8)}|      ${String(free).padEnd(8)}|        ${(cl.toFixed(0) + '%').padEnd(11)}|        ${pl.padEnd(11)}|      ${String(plannerFree).padEnd(8)}|  ${avg(diff)}`,
  )
}

// Longest run of consecutive free levels past the teaching band — the "player
// coasts for half an hour" smell that per-chapter averages hide.
{
  let run = 0
  let best = 0
  let bestAt = 0
  for (const l of levels) {
    if (l.id > 25 && l.planningLoss === 0) {
      run++
      if (run > best) {
        best = run
        bestAt = l.id
      }
    } else run = 0
  }
  console.log(
    `\nLongest zero-loss run after L25: ${best} level(s)` +
      (best > 0 ? ` (ending at L${bestAt})` : ''),
  )
}

// Report any level below its PLANNER floor — the round-4 bar. These are the
// levels a previewing one-ply player clears too easily; tune the curve.
const plannerShort = levels.filter((l) => l.plannerLoss + 0.02 < l.plannerFloor)
if (plannerShort.length > 0) {
  console.log(`\n${plannerShort.length} level(s) BELOW their PLANNER floor:`)
  for (const l of plannerShort)
    console.log(
      `  L${l.id}: planner ${(l.plannerLoss * 100).toFixed(0)}% vs floor ${(l.plannerFloor * 100).toFixed(0)}%  (greedy ${(l.planningLoss * 100).toFixed(0)}%)`,
    )
} else {
  console.log('\nAll levels meet their planner (previewing-human) floor. ✓')
}

// Report any level that failed to reach its rising planning-pressure floor.
const short = levels.filter((l) => l.planningLoss + 0.02 < l.planningFloor)
if (short.length > 0) {
  console.log(`\n${short.length} level(s) BELOW their planning floor (tune the curve):`)
  for (const l of short)
    console.log(
      `  L${l.id}: got ${(l.planningLoss * 100).toFixed(0)}% vs floor ${(l.planningFloor * 100).toFixed(0)}%  (bees ${l.bees.filter((b) => b.kind !== 'hornet').length}, queen ${l.hasQueen ? 'Y' : 'n'}, hornets ${l.hornets})`,
    )
} else {
  console.log('\nAll levels meet their planning floor. ✓')
}
console.log('')
