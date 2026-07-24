/**
 * Prove every shipped level is beatable, and report by how much (npx tsx
 * scripts/verifyBeatable.ts). This drives the SAME BoardState the game does —
 * escape / bump / stuck / queen-last / honey-trail — through the real search,
 * so a pass here means a pass in the player's hands.
 *
 * For each level it prints: the minimum taps the search needs, the shipped move
 * budget, and the slack between them. Fails loudly (non-zero exit) if any level
 * cannot be cleared inside its budget.
 */
import { LEVELS } from '../src/levels'
import { BoardState } from '../src/systems/BoardState'
import { searchMinMoves } from '../src/systems/SolverSearch'

let worstSlack = Infinity
let failures = 0
const rows: string[] = []

for (const level of LEVELS) {
  const goals = level.bees.filter((b) => b.kind !== 'hornet').length
  // Unbounded budget so the search is never refused a tap mid-line; the real
  // budget is compared against the answer.
  const min = searchMinMoves(new BoardState({ ...level, moveBudget: 999 }), level.moveBudget + 2)
  if (min === null || min > level.moveBudget) {
    failures++
    rows.push(`L${String(level.id).padStart(3)}  UNBEATABLE  (min ${min}, budget ${level.moveBudget})`)
    continue
  }
  const slack = level.moveBudget - min
  worstSlack = Math.min(worstSlack, slack)
  const forced = min - goals
  rows.push(
    `L${String(level.id).padStart(3)}  ch${level.chapter}  min ${String(min).padStart(2)}  budget ${String(
      level.moveBudget,
    ).padStart(2)}  slack ${slack}  ${forced > 0 ? `(+${forced} forced honey-stop${forced > 1 ? 's' : ''})` : ''}`,
  )
}

console.log(rows.join('\n'))
console.log('')
if (failures > 0) {
  console.error(`✗ ${failures} level(s) are NOT beatable within budget.`)
  process.exit(1)
}
console.log(`✓ All ${LEVELS.length} levels beatable within budget. Tightest slack across the set: ${worstSlack}.`)
