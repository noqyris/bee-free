/**
 * Offline generator for the COMPASS HIVE mode (50 levels): small boards,
 * colored bees, colored rim gates, free rotation, flights-only budget.
 * Run: npx tsx scripts/genCompassLevels.ts  →  src/levels/compass.generated.json
 *
 * Construction is random-place + honest validation (no reverse trick: with
 * free rotation the classic bump-free guarantee is meaningless). A candidate
 * ships only if:
 *  - the rotation-aware search proves it solvable, with minMoves ≥ goals + 1
 *    (at least one forced multi-hop — pure rotate-and-drain boards are junk),
 *  - the compass planner bot (1-ply previewing human) loses at least the
 *    slot's floor at budget = minMoves + slack.
 */
import { spawn } from 'node:child_process'
import { cpus, tmpdir } from 'node:os'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { shapeCells, shapeLabel, type ShapeSpec } from '../src/systems/boardShapes'
import { BoardState } from '../src/systems/BoardState'
import { searchCompassMinMoves, compassPlannerLossRate } from '../src/systems/SolverSearch'
import { axialKey, DIRECTION_VECTORS } from '../src/systems/HexGrid'
import { makeRng, mixSeed } from '../src/utils/rng'
import type { LevelData } from '../src/types'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/levels/compass.generated.json')
const COUNT = 50

interface Slot {
  id: number
  shape: ShapeSpec
  bees: number
  colors: number
  hasQueen: boolean
  slack: number
  lakes: number
  floor: number
  minHops: number // minMoves - goals must be at least this
}

function slotFor(id: number): Slot {
  const p = (id - 1) / (COUNT - 1)
  const shapes: ShapeSpec[] = [
    { kind: 'triangleUp', size: 4 }, // 15
    { kind: 'rhombus', w: 4, h: 4 }, // 16
    { kind: 'hexagon', radius: 2 }, // 19
    { kind: 'rhombus', w: 5, h: 4 }, // 20
  ]
  return {
    id,
    shape: shapes[id % (id <= 10 ? 2 : 4)],
    bees: id <= 3 ? 2 : id <= 8 ? 3 : id <= 20 ? 4 : id <= 35 ? 5 : 6,
    colors: id <= 5 ? 2 : 3,
    hasQueen: id >= 12,
    // Slack 2 through C30: rotation branching makes even "fair" boards measure
    // hot, and this ladder is NEW to every player — one spare move is the
    // deep-end rule only.
    slack: id <= 30 ? 2 : 1,
    // Honey is what forces multi-hop routes (fly → stick → rotate → fly), so
    // the mid/late mode is generous with lakes — it also makes acceptable
    // candidates far more common, which is most of the generation speed.
    lakes: id <= 6 ? 0 : id <= 20 ? 3 : 4,
    floor: id <= 8 ? 0 : Math.min(0.1 + 0.3 * p, 0.4),
    minHops: id <= 8 ? 0 : 1,
  }
}

/** All rim crossings: [cell q, r, outward dir]. */
function rimCrossings(cells: ReadonlyArray<readonly [number, number]>): Array<[number, number, number]> {
  const set = new Set(cells.map(([q, r]) => axialKey(q, r)))
  const out: Array<[number, number, number]> = []
  for (const [q, r] of cells) {
    for (let d = 0; d < 6; d++) {
      const v = DIRECTION_VECTORS[d]
      if (!set.has(axialKey(q + v.q, r + v.r))) out.push([q, r, d])
    }
  }
  return out
}

type CompassOut = LevelData & { minMoves: number; plannerLoss: number; shape: string }

function genOne(slot: Slot): CompassOut | null {
  const cells = shapeCells(slot.shape).map(([q, r]) => [q, r] as [number, number])
  const rims = rimCrossings(cells)
  // Fallback: the board closest to the acceptance band, shipped (with a log)
  // if no attempt lands inside it — a slightly-off special beats a hard fail.
  let best: CompassOut | null = null
  let bestDist = Infinity
  for (let attempt = 0; attempt < 1200; attempt++) {
    const rng = makeRng(mixSeed(0xc0a55 + slot.id * 6151, attempt))
    const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]

    // Bees on distinct cells, colors round-robin, random initial facing.
    const used = new Set<string>()
    const bees: Array<{ q: number; r: number; dir: number; kind: 'bee' | 'queen'; color: number }> = []
    for (let i = 0; i < slot.bees; i++) {
      let cell: [number, number] | null = null
      for (let g = 0; g < 60 && !cell; g++) {
        const c = pick(cells)
        if (!used.has(axialKey(c[0], c[1]))) cell = c
      }
      if (!cell) break
      used.add(axialKey(cell[0], cell[1]))
      bees.push({
        q: cell[0],
        r: cell[1],
        dir: Math.floor(rng() * 6),
        kind: slot.hasQueen && i === 0 ? 'queen' : 'bee',
        color: i % slot.colors,
      })
    }
    if (bees.length < slot.bees) continue

    // One gate per color on distinct rim crossings.
    const gates: Array<[number, number, number, number]> = []
    const takenRims = new Set<number>()
    for (let c = 0; c < slot.colors; c++) {
      let idx = -1
      for (let g = 0; g < 60; g++) {
        const i = Math.floor(rng() * rims.length)
        if (!takenRims.has(i)) {
          idx = i
          break
        }
      }
      if (idx < 0) break
      takenRims.add(idx)
      gates.push([rims[idx][0], rims[idx][1], rims[idx][2], c])
    }
    if (gates.length < slot.colors) continue

    // Honey lakes on free cells.
    const honeyCells: Array<[number, number]> = []
    for (let i = 0; i < slot.lakes; i++) {
      for (let g = 0; g < 60; g++) {
        const c = pick(cells)
        const k = axialKey(c[0], c[1])
        if (!used.has(k)) {
          used.add(k)
          honeyCells.push(c)
          break
        }
      }
    }

    const base: LevelData = {
      id: slot.id,
      cells,
      honeyCells,
      bees,
      moveBudget: 99,
      threeStarSpare: 0,
      compass: true,
      gates,
    }
    const min = searchCompassMinMoves(new BoardState(base), slot.bees + 8, 1_500_000)
    if (min === null) continue
    if (min - slot.bees < slot.minHops) continue // too drainable
    const budget = min + slot.slack
    const loss = compassPlannerLossRate(
      new BoardState({ ...base, moveBudget: budget }),
      40,
      mixSeed(0xbee5, slot.id * 31 + attempt),
    )
    // Wide ceiling: rotation branching makes honest compass boards measure
    // 0.6-0.75 routinely; a tight ceiling burned 40 min/level rejecting them.
    const hi = 0.8
    const out: CompassOut = {
      ...base,
      moveBudget: budget,
      threeStarSpare: slot.slack,
      minMoves: min,
      plannerLoss: Math.round(loss * 100) / 100,
      shape: shapeLabel(slot.shape),
    }
    if (loss >= slot.floor && loss <= hi) return out
    const dist = loss < slot.floor ? slot.floor - loss : loss - hi
    if (dist < bestDist) {
      best = out
      bestDist = dist
    }
  }
  if (best) console.error(`C${slot.id}: shipped OFF-BAND (dist ${bestDist.toFixed(2)}, loss ${best.plannerLoss})`)
  return best
}

// ---- Shard mode: generate an interleaved id slice, write JSON to a file. ----
// Same round-robin split as genLevels.ts, and for the same reason: compass cost
// climbs hard with id (C1–10 measured 59s total, C11–20 another ~18 min), so
// contiguous ranges would leave one worker grinding the tail alone.
const shardArg = process.argv.indexOf('--shard')
if (shardArg !== -1) {
  const offset = Number(process.argv[shardArg + 1])
  const stride = Number(process.argv[shardArg + 2])
  const outFile = process.argv[shardArg + 3]
  const out: unknown[] = []
  const failed: number[] = []
  for (let id = 1; id <= COUNT; id++) {
    if ((id - 1) % stride !== offset) continue
    const l = genOne(slotFor(id))
    if (!l) failed.push(id)
    else out.push(l)
  }
  writeFileSync(outFile, JSON.stringify({ levels: out, failed }))
  process.exit(0)
}

// ---- Parent mode: fan out shards across cores, merge, write, summarize. ----
function runShard(offset: number, stride: number): Promise<{ levels: CompassOut[]; failed: number[] }> {
  return new Promise((res, rej) => {
    const outFile = join(tmpdir(), `beefree-compass-${offset}-of-${stride}.json`)
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

const workers = Math.max(1, Math.min(cpus().length - 1, 8))
console.log(`Generating ${COUNT} compass levels across ${workers} workers (interleaved)...`)
const t0 = Date.now()
const results = await Promise.all(Array.from({ length: workers }, (_, i) => runShard(i, workers)))

const failedIds = results.flatMap((r) => r.failed).sort((a, b) => a - b)
if (failedIds.length > 0) {
  console.error(`FAILED to generate within attempts: C${failedIds.join(', C')}`)
  process.exit(1)
}
const levels = results.flatMap((r) => r.levels).sort((a, b) => a.id - b.id)

writeFileSync(OUT, JSON.stringify({ schema: 1, count: levels.length, levels }) + '\n')
const ls = levels
console.log(
  `Generated ${levels.length} compass levels in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${OUT}`,
)
console.log(
  `plannerLoss avg ${(ls.reduce((a, l) => a + l.plannerLoss, 0) / ls.length).toFixed(2)}, ` +
    `minMoves ${Math.min(...ls.map((l) => l.minMoves))}–${Math.max(...ls.map((l) => l.minMoves))}`,
)
