/** Temp diagnostic: how often does mindless play lose? (higher = more thinking needed) */
import { LEVELS } from '../src/levels'
import { BoardState } from '../src/systems/BoardState'
import { makeRng } from '../src/utils/rng'

// Careless: tap a random occupant whose outcome is escape/stick (never a
// deliberate bump); may tap the queen early. Loss = queen-early, a deadlock
// (only bump-moves left with goals remaining), or exceeding the move budget.
function careless(level: (typeof LEVELS)[number], rand: () => number): boolean {
  const b = new BoardState({ ...level, moveBudget: level.moveBudget })
  for (let s = 0; s < 400; s++) {
    if (b.remaining === 0) return true
    if (b.status !== 'playing') return false
    const opts = b.allOccupants().filter((o) => o.isTappable() && b.trace(o).kind !== 'blocked')
    if (opts.length === 0) return false // stranded: only bumps remain
    const o = opts[Math.floor(rand() * opts.length)]
    b.tap(o.q, o.r)
  }
  return b.remaining === 0
}

let hs = 0
let ht = 0
let ps = 0
let pt = 0
const N = 40
for (const l of LEVELS) {
  const honey = (l.honeyCells?.length ?? 0) > 0
  const rand = makeRng(l.id * 13 + 5)
  let loss = 0
  for (let i = 0; i < N; i++) if (!careless(l, rand)) loss++
  if (honey) {
    hs += loss
    ht += N
  } else {
    ps += loss
    pt += N
  }
}
console.log('CARELESS-PLAY LOSS RATE (higher = more thinking required):')
console.log(`  honey levels (${ht / N}):  ${((100 * hs) / ht).toFixed(0)}% of mindless attempts LOSE`)
console.log(`  non-honey    (${pt / N}):  ${((100 * ps) / pt).toFixed(0)}% of mindless attempts LOSE`)
