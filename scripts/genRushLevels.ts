/**
 * Offline generator for RUSH HIVE — the unpark-the-cars prototype.
 * Run: npx tsx scripts/genRushLevels.ts [count]  →  src/levels/rush.generated.json
 *
 * The construction follows from one hard consequence of the rules: a bee's
 * direction is FIXED and it only ever moves forward, so it lives on a single
 * line for the whole level. If that line does not end at an exit, the bee can
 * never leave, no matter what the player does. So levels are built exit-first:
 *
 *   1. pick a handful of rim mouths,
 *   2. place bees ONLY on lines that terminate at one of them,
 *   3. keep the board if the real search proves it clearable inside a budget,
 *      and a previewing-human bot loses often enough to make it a puzzle.
 *
 * Bees that share a line queue up behind one exit (a lane of traffic); the
 * pressure comes from lines that CROSS, where clearing one lane parks a bee in
 * front of another.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { cpus, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { shapeCells, type ShapeSpec } from '../src/systems/boardShapes'
import { BoardState } from '../src/systems/BoardState'
import { searchMinMoves, plannerLossRate } from '../src/systems/SolverSearch'
import { axialKey, DIRECTION_VECTORS } from '../src/systems/HexGrid'
import { makeRng, mixSeed } from '../src/utils/rng'
import { GATE_ANY, type LevelData } from '../src/types'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/levels/rush.generated.json')
const COUNT = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 20)

interface Slot {
  id: number
  shape: ShapeSpec
  bees: number
  exits: number
  hasQueen: boolean
  slack: number
  floor: number
}

function slotFor(id: number, count: number): Slot {
  const p = count > 1 ? (id - 1) / (count - 1) : 0
  const shapes: ShapeSpec[] = [
    { kind: 'hexagon', radius: 2 }, // 19
    { kind: 'rhombus', w: 5, h: 4 }, // 20
    { kind: 'hexagon', radius: 2 },
    { kind: 'rhombus', w: 5, h: 5 }, // 25
  ]
  return {
    id,
    shape: shapes[id % (id <= 6 ? 2 : 4)],
    // Traffic needs density: too few bees and every lane is already clear.
    bees: id <= 3 ? 3 : id <= 8 ? 4 : id <= 14 ? 5 : 6,
    // FEWER exits = more shared lanes = more queueing. This is the mode's
    // main difficulty dial, far more than bee count.
    exits: id <= 4 ? 3 : id <= 12 ? 2 : 2,
    hasQueen: id >= 10,
    slack: id <= 8 ? 2 : 1,
    floor: id <= 4 ? 0 : Math.min(0.12 + 0.4 * p, 0.45),
  }
}

/** Every rim crossing of the board: [q, r, outward dir]. */
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

/**
 * All cells that reach `exit` by flying in the exit's direction — the exit's
 * LANE, walked backwards from the mouth. These are the only cells a bee facing
 * that direction may legally start on.
 */
function laneFor(
  exit: [number, number, number],
  cellSet: Set<string>,
): Array<[number, number]> {
  const [eq, er, d] = exit
  const v = DIRECTION_VECTORS[d]
  const lane: Array<[number, number]> = []
  let q = eq
  let r = er
  while (cellSet.has(axialKey(q, r))) {
    lane.push([q, r])
    q -= v.q
    r -= v.r
  }
  return lane
}

type RushOut = LevelData & { minMoves: number; plannerLoss: number }

function genOne(slot: Slot): RushOut | null {
  const cells = shapeCells(slot.shape).map(([q, r]) => [q, r] as [number, number])
  const cellSet = new Set(cells.map(([q, r]) => axialKey(q, r)))
  const rims = rimCrossings(cells)

  let best: RushOut | null = null
  let bestDist = Infinity

  for (let attempt = 0; attempt < 900; attempt++) {
    const rng = makeRng(mixSeed(0x5150 + slot.id * 7717, attempt))
    const pick = <T>(a: T[]): T => a[Math.floor(rng() * a.length)]

    // Exits, and the lanes that feed them.
    const exits: Array<[number, number, number]> = []
    for (let i = 0; i < slot.exits; i++) {
      const e = pick(rims)
      if (!exits.some((x) => x[0] === e[0] && x[1] === e[1] && x[2] === e[2])) exits.push(e)
    }
    if (exits.length < Math.min(2, slot.exits)) continue
    const lanes = exits.map((e) => ({ dir: e[2], cells: laneFor(e, cellSet) })).filter((l) => l.cells.length >= 2)
    if (lanes.length === 0) continue

    // Bees: each one on some exit's lane, facing that exit.
    const used = new Set<string>()
    const bees: Array<{ q: number; r: number; dir: number; kind: 'bee' | 'queen' }> = []
    for (let i = 0; i < slot.bees; i++) {
      let placed = false
      for (let g = 0; g < 80 && !placed; g++) {
        const lane = pick(lanes)
        const cell = pick(lane.cells)
        const key = axialKey(cell[0], cell[1])
        if (used.has(key)) continue
        used.add(key)
        bees.push({
          q: cell[0],
          r: cell[1],
          dir: lane.dir,
          kind: slot.hasQueen && i === 0 ? 'queen' : 'bee',
        })
        placed = true
      }
      if (!placed) break
    }
    if (bees.length < slot.bees) continue

    const base: LevelData = {
      id: slot.id,
      cells,
      bees,
      moveBudget: 99,
      threeStarSpare: 0,
      rush: true,
      gates: exits.map(([q, r, d]) => [q, r, d, GATE_ANY] as const),
    }

    const min = searchMinMoves(new BoardState(base), slot.bees + 10, 400_000)
    if (min === null) continue
    // A board solved in exactly one tap per bee has no traffic in it at all —
    // everybody just drives out. The mode only exists for boards where
    // somebody has to be shuffled first.
    if (min <= slot.bees) continue

    const budget = min + slot.slack
    const level: LevelData = { ...base, moveBudget: budget, threeStarSpare: Math.min(1, slot.slack) }
    const loss = plannerLossRate(new BoardState(level), 40, 5231 + slot.id)

    const out: RushOut = { ...level, minMoves: min, plannerLoss: loss }
    if (loss >= slot.floor) return out
    const dist = slot.floor - loss
    if (dist < bestDist) {
      bestDist = dist
      best = out
    }
  }
  return best
}

// ---- shard mode ----
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
function runShard(offset: number, stride: number): Promise<{ levels: RushOut[]; failed: number[] }> {
  return new Promise((res, rej) => {
    const outFile = join(tmpdir(), `beefree-rush-${offset}-of-${stride}.json`)
    const child = spawn(
      process.execPath,
      [...process.execArgv, process.argv[1], '--shard', String(offset), String(stride), outFile, String(COUNT)],
      { env: process.env },
    )
    let err = ''
    child.stderr.on('data', (d) => (err += d))
    child.on('close', (code) => {
      if (code !== 0) return rej(new Error(`shard ${offset} exited ${code}:\n${err}`))
      try {
        const parsed = JSON.parse(readFileSync(outFile, 'utf8'))
        rmSync(outFile, { force: true })
        res(parsed)
      } catch (e) {
        rej(new Error(`shard ${offset} unreadable: ${(e as Error).message}\n${err}`))
      }
    })
  })
}

const workers = Math.max(1, Math.min(cpus().length - 1, 8))
console.log(`Generating ${COUNT} rush levels across ${workers} workers...`)
const t0 = Date.now()
const results = await Promise.all(Array.from({ length: workers }, (_, i) => runShard(i, workers)))
const failed = results.flatMap((r) => r.failed).sort((a, b) => a - b)
if (failed.length > 0) console.error(`FAILED: R${failed.join(', R')}`)
const levels = results.flatMap((r) => r.levels).sort((a, b) => a.id - b.id)
if (levels.length === 0) {
  console.error('no levels generated')
  process.exit(1)
}
writeFileSync(OUT, JSON.stringify({ schema: 1, count: levels.length, levels }) + '\n')
console.log(`Generated ${levels.length} rush levels in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${OUT}`)
console.log(
  `plannerLoss avg ${(levels.reduce((a, l) => a + l.plannerLoss, 0) / levels.length).toFixed(2)}, ` +
    `minMoves ${Math.min(...levels.map((l) => l.minMoves))}–${Math.max(...levels.map((l) => l.minMoves))}, ` +
    `bees ${Math.min(...levels.map((l) => l.bees.length))}–${Math.max(...levels.map((l) => l.bees.length))}`,
)
