/**
 * Difficulty diagnostics for the shipped level set. Not part of the build —
 * a tuning aid. Run: `npx tsx scripts/analyzeLevels.ts`
 */
import { LEVELS } from '../src/levels'
import { analyzeBoard, toSolverBees } from '../src/systems/Solver'
import { axialKey } from '../src/systems/HexGrid'

function boardSet(cells: ReadonlyArray<readonly [number, number]>): Set<string> {
  return new Set(cells.map(([q, r]) => axialKey(q, r)))
}

interface Row {
  id: number
  chapter: number
  bees: number
  free: number
  freePct: number
  depth: number
  slack: number
  trivial: boolean
}

const rows: Row[] = LEVELS.map((l) => {
  const m = analyzeBoard(toSolverBees(l.bees), boardSet(l.cells), l.cells.length)
  const slack = l.moveBudget - m.beeCount // budget is over goal occupants
  const free = m.freeAtStart
  // "Trivial": every bee is escapable at the start (no ordering forced at all),
  // OR the budget is so loose that many bumps are survivable.
  const trivial = free === m.beeCount || slack >= Math.ceil(m.beeCount / 2)
  return {
    id: l.id,
    chapter: l.chapter ?? 0,
    bees: m.beeCount,
    free,
    freePct: Math.round((free / m.beeCount) * 100),
    depth: m.depDepth,
    slack,
    trivial,
  }
})

console.log('\nPer-chapter difficulty diagnostics:')
console.log('ch | avg bees | avg free% (lower=harder) | avg depth | avg slack | trivial levels')
console.log('---|----------|--------------------------|-----------|-----------|---------------')
for (let ch = 1; ch <= 6; ch++) {
  const g = rows.filter((r) => r.chapter === ch)
  const avg = (f: (r: Row) => number) => (g.reduce((a, r) => a + f(r), 0) / g.length).toFixed(1)
  const trivialCount = g.filter((r) => r.trivial).length
  console.log(
    ` ${ch} |   ${avg((r) => r.bees).padStart(5)}  |          ${avg((r) => r.freePct).padStart(5)}%          |   ${avg((r) => r.depth).padStart(4)}    |   ${avg((r) => r.slack).padStart(4)}    | ${trivialCount}/${g.length}`,
  )
}

const totalTrivial = rows.filter((r) => r.trivial).length
console.log(`\nTrivial (no forced ordering OR huge slack): ${totalTrivial}/150`)
console.log(
  `Levels where ALL bees are free at start (pure "read the arrows"): ${rows.filter((r) => r.free === r.bees).length}/150`,
)

// Show the first 12 levels in detail (what a new player actually meets).
console.log('\nFirst 12 levels (what a new player experiences):')
console.log('id | bees | free (escapable now) | depth | slack')
for (const r of rows.slice(0, 12)) {
  console.log(
    ` ${String(r.id).padStart(2)} |  ${String(r.bees).padStart(2)}  |   ${String(r.free).padStart(2)} / ${r.bees} (${String(r.freePct).padStart(3)}%)      |   ${r.depth}   |  ${r.slack}`,
  )
}
