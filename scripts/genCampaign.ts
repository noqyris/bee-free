/**
 * Offline generator for the CAMPAIGN under the sealed-rim rules.
 * Run: npx tsx scripts/genCampaign.ts [count]  →  src/levels/levels.generated.json
 *
 * This replaces the open-rim campaign, and the reason is a measurement rather
 * than a preference. On the old 300 levels, 65.8% of bees could fly straight
 * out on tap 1, and — the decisive number — ALL 1420 opening escape taps in the
 * whole game kept the level winnable, with not one costing a move of
 * optimality. There was no first move in the campaign that could be wrong, so
 * the first ~3 taps of every level were free. That is a direct consequence of
 * the rim being an exit everywhere.
 *
 * Sealing it and cutting doors takes opening openness from 65% to 14% with
 * three doors and 9% with two, and with turning allowed the boards stay
 * solvable while needing ~4 moves beyond one-per-bee — i.e. routing.
 *
 * The rules, all of which BoardState already supports:
 *  - the rim is a wall except at gates (`compass: true` + `gates`)
 *  - turning is free; only flights spend moves
 *  - doors are UNIVERSAL (GATE_ANY) while the game teaches, coloured later
 *  - no queen: 100% of the old campaign's dead ends were "workers jammed,
 *    queen has a clear lane, taking it loses"
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { cpus, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { shapeCells, shapeLabel, type ShapeSpec } from '../src/systems/boardShapes'
import { BoardState } from '../src/systems/BoardState'
import { searchCompassMinMoves, compassPlannerLossRate } from '../src/systems/SolverSearch'
import { axialKey, DIRECTION_VECTORS } from '../src/systems/HexGrid'
import { makeRng, mixSeed } from '../src/utils/rng'
import { GATE_ANY, type LevelData } from '../src/types'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/levels/levels.generated.json')
const COUNT = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 300)

interface Slot {
  id: number
  chapter: number
  shape: ShapeSpec
  bees: number
  /** Number of DOORS. Measured as the strongest structural difficulty dial. */
  doors: number
  /** 1 = universal doors (no matching yet); 2-3 = matched colours. */
  colors: number
  lakes: number
  slack: number
  floor: number
  ceiling: number
}

function slotFor(id: number, count: number): Slot {
  const p = count > 1 ? (id - 1) / (count - 1) : 0
  const chapter = Math.ceil((id / count) * 12)
  // Boards grow slowly. Rotation multiplies the branching factor by six, so a
  // board that looks modest is already a deep search.
  const shape: ShapeSpec =
    id <= 20
      ? { kind: 'triangleUp', size: 4 }
      : id <= 60
        ? { kind: 'rhombus', w: 4, h: 4 }
        : id <= 140
          ? { kind: 'hexagon', radius: 2 }
          : { kind: 'rhombus', w: 5, h: 4 }
  return {
    id,
    chapter,
    shape,
    bees: id <= 5 ? 2 : id <= 15 ? 3 : id <= 45 ? 4 : id <= 120 ? 5 : 6,
    // Doors are the difficulty dial (measured: 3 doors 0.48 loss vs 2 doors
    // 0.78 on the same board) — far stronger than the move budget, which is
    // nearly inert here exactly as it was in the old campaign.
    doors: id <= 40 ? 4 : id <= 120 ? 3 : 2,
    // Doors first, colours much later: with a sealed rim, "which bee can even
    // reach a door" is already a real decision, and it is the one the old game
    // never asked.
    colors: id <= 60 ? 1 : id <= 160 ? 2 : 3,
    lakes: id <= 12 ? 0 : id <= 60 ? 2 : 3,
    slack: id <= 60 ? 3 : id <= 160 ? 2 : 1,
    floor: id <= 10 ? 0 : Math.min(0.08 + 0.32 * p, 0.4),
    ceiling: Math.min(0.4 + 0.22 * p, 0.62),
  }
}

function rimCrossings(cells: Array<[number, number]>): Array<[number, number, number]> {
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

type OutLevel = LevelData & {
  chapter: number
  shape: string
  minMoves: number
  plannerLoss: number
  difficulty: number
  depDepth: number
}

function genOne(slot: Slot): OutLevel | null {
  const cells = shapeCells(slot.shape).map(([q, r]) => [q, r] as [number, number])
  const rims = rimCrossings(cells)
  let best: OutLevel | null = null
  let bestDist = Infinity

  for (let attempt = 0; attempt < 700; attempt++) {
    const rng = makeRng(mixSeed(0xCA47 + slot.id * 6151, attempt))
    const pick = <T>(a: T[]): T => a[Math.floor(rng() * a.length)]

    // Doors. Every colour needs at least one; extras spread over the colours.
    const gates: Array<[number, number, number, number]> = []
    const taken = new Set<number>()
    for (let d = 0; d < slot.doors; d++) {
      let idx = -1
      for (let g = 0; g < 60; g++) {
        const i = Math.floor(rng() * rims.length)
        if (!taken.has(i)) {
          idx = i
          break
        }
      }
      if (idx < 0) break
      taken.add(idx)
      const colour = slot.colors === 1 ? GATE_ANY : d % slot.colors
      gates.push([rims[idx][0], rims[idx][1], rims[idx][2], colour])
    }
    if (gates.length < Math.max(slot.colors, 2)) continue
    const doorColours = [...new Set(gates.map((g) => g[3]))]

    // Bees, each on a free cell, facing anywhere — turning is free, so the
    // starting heading is flavour rather than a constraint.
    const used = new Set<string>()
    const bees: Array<{ q: number; r: number; dir: number; kind: 'bee'; color: number }> = []
    for (let i = 0; i < slot.bees; i++) {
      let placed = false
      for (let g = 0; g < 60 && !placed; g++) {
        const c = pick(cells)
        const k = axialKey(c[0], c[1])
        if (used.has(k)) continue
        used.add(k)
        bees.push({
          q: c[0],
          r: c[1],
          dir: Math.floor(rng() * 6),
          kind: 'bee',
          color: doorColours[i % doorColours.length],
        })
        placed = true
      }
      if (!placed) break
    }
    if (bees.length < slot.bees) continue

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

    const min = searchCompassMinMoves(new BoardState(base), slot.bees + 9, 1_200_000)
    if (min === null) continue
    // A board solved in one tap per bee has no routing in it — everybody just
    // turns once and leaves. That is the old campaign's failure, restated.
    if (min < slot.bees + 2) continue

    const budget = min + slot.slack
    const level: LevelData = {
      ...base,
      moveBudget: budget,
      threeStarSpare: Math.min(slot.slack, budget - min),
    }
    const loss = compassPlannerLossRate(new BoardState(level), 32, 3121 + slot.id)

    const out: OutLevel = {
      ...level,
      chapter: slot.chapter,
      shape: shapeLabel(slot.shape),
      minMoves: min,
      plannerLoss: loss,
      difficulty: Math.round((min - slot.bees) * 10) / 10,
      depDepth: min - slot.bees,
    }
    if (loss >= slot.floor && loss <= slot.ceiling) return out
    const dist = loss < slot.floor ? slot.floor - loss : loss - slot.ceiling
    if (dist < bestDist) {
      bestDist = dist
      best = out
    }
  }
  return best
}

// ---- shard ----
const shardArg = process.argv.indexOf('--shard')
if (shardArg !== -1) {
  const offset = Number(process.argv[shardArg + 1])
  const stride = Number(process.argv[shardArg + 2])
  const outFile = process.argv[shardArg + 3]
  const total = Number(process.argv[shardArg + 4])
  const out: unknown[] = []
  const failed: number[] = []
  for (let id = 1; id <= total; id++) {
    if ((id - 1) % stride !== offset) continue
    const l = genOne(slotFor(id, total))
    if (!l) failed.push(id)
    else out.push(l)
  }
  writeFileSync(outFile, JSON.stringify({ levels: out, failed }))
  process.exit(0)
}

// ---- parent ----
function runShard(offset: number, stride: number): Promise<{ levels: OutLevel[]; failed: number[] }> {
  return new Promise((res, rej) => {
    const outFile = join(tmpdir(), `beefree-campaign-${offset}-of-${stride}.json`)
    const child = spawn(
      process.execPath,
      [...process.execArgv, process.argv[1], '--shard', String(offset), String(stride), outFile, String(COUNT)],
      { env: process.env },
    )
    let err = ''
    child.stderr.on('data', (d) => (err += d))
    child.on('close', (code) => {
      if (code !== 0) return rej(new Error(`shard ${offset} exited ${code}:\n${err}`))
      const parsed = JSON.parse(readFileSync(outFile, 'utf8'))
      rmSync(outFile, { force: true })
      res(parsed)
    })
  })
}

const workers = Math.max(1, Math.min(cpus().length - 1, 8))
console.log(`Generating ${COUNT} campaign levels (sealed rim) across ${workers} workers...`)
const t0 = Date.now()
const results = await Promise.all(Array.from({ length: workers }, (_, i) => runShard(i, workers)))
const failed = results.flatMap((r) => r.failed).sort((a, b) => a - b)
const levels = results.flatMap((r) => r.levels).sort((a, b) => a.id - b.id)
if (failed.length > 0) console.error(`FAILED: L${failed.join(', L')}`)
if (levels.length !== COUNT) {
  console.error(`only ${levels.length}/${COUNT} generated — not writing`)
  process.exit(1)
}
writeFileSync(
  OUT,
  JSON.stringify({ schema: 1, progression: 'sealed-rim', count: levels.length, levels }) + '\n',
)
const avg = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length
console.log(`Generated ${levels.length} levels in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${OUT}`)
console.log(
  `plannerLoss avg ${avg(levels.map((l) => l.plannerLoss)).toFixed(2)}, ` +
    `forced hops avg ${avg(levels.map((l) => l.minMoves - l.bees.length)).toFixed(1)}, ` +
    `bees ${Math.min(...levels.map((l) => l.bees.length))}–${Math.max(...levels.map((l) => l.bees.length))}`,
)
