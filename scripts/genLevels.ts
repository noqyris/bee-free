/**
 * Offline level generator (spec §4). Run with `npm run gen:levels`.
 *
 * Builds all 150 levels from the difficulty curve, verifies each is solvable
 * within its move budget, and writes them as static JSON. Levels are NOT
 * generated at runtime — this file's output is shipped as-is.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { buildLevelCurve } from '../src/config/levelCurve'
import { shapeCells, shapeLabel } from '../src/systems/boardShapes'
import { generateLevel } from '../src/systems/LevelGenerator'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, '../src/levels/levels.generated.json')

interface OutBee {
  q: number
  r: number
  dir: number
  kind: 'bee'
}
interface OutLevel {
  id: number
  chapter: number
  shape: string
  cells: Array<[number, number]>
  bees: OutBee[]
  moveBudget: number
  threeStarSpare: number
  difficulty: number
  depDepth: number
}

const slots = buildLevelCurve()
const levels: OutLevel[] = []
const failures: string[] = []

for (const slot of slots) {
  const cells = shapeCells(slot.shape)
  const { bees, metrics } = generateLevel({
    boardCells: cells,
    targetBees: slot.targetBees,
    minDepth: slot.minDepth,
    maxDepth: slot.maxDepth,
    rayBias: slot.rayBias,
    seed: slot.seed,
    attempts: slot.attempts,
  })

  const moveBudget = bees.length + slot.slack
  if (!metrics.solvable) failures.push(`L${slot.id}: NOT solvable`)
  if (bees.length < 2) failures.push(`L${slot.id}: only ${bees.length} bees`)
  if (moveBudget < bees.length) failures.push(`L${slot.id}: budget < bees`)
  if (slot.threeStarSpare > moveBudget - bees.length)
    failures.push(`L${slot.id}: 3-star spare unreachable`)

  levels.push({
    id: slot.id,
    chapter: slot.chapter,
    shape: shapeLabel(slot.shape),
    cells: cells.map(([q, r]) => [q, r] as [number, number]),
    bees: bees.map((b) => ({ q: b.q, r: b.r, dir: b.dir, kind: 'bee' as const })),
    moveBudget,
    threeStarSpare: Math.min(slot.threeStarSpare, moveBudget - bees.length),
    difficulty: Math.round(metrics.difficulty * 10) / 10,
    depDepth: metrics.depDepth,
  })
}

if (failures.length > 0) {
  console.error('\nGeneration failures:')
  for (const f of failures) console.error('  ' + f)
  process.exit(1)
}

writeFileSync(OUT, JSON.stringify({ schema: 1, count: levels.length, levels }, null, 0) + '\n')

// Summary per chapter for a human sanity check.
console.log(`\nGenerated ${levels.length} levels → ${OUT}\n`)
console.log('Chapter |  bees(min–max) | depth(min–max) | budget slack | difficulty(avg)')
console.log('--------|----------------|----------------|--------------|----------------')
for (let ch = 1; ch <= 6; ch++) {
  const g = levels.filter((l) => l.chapter === ch)
  const bees = g.map((l) => l.bees.length)
  const depth = g.map((l) => l.depDepth)
  const slack = g.map((l) => l.moveBudget - l.bees.length)
  const diff = g.map((l) => l.difficulty)
  const rng = (a: number[]) => `${Math.min(...a)}–${Math.max(...a)}`
  const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)
  console.log(
    `   ${ch}    |    ${rng(bees).padEnd(11)}| ${rng(depth).padEnd(15)}| ${rng(slack).padEnd(13)}| ${avg(diff)}`,
  )
}
console.log('')
