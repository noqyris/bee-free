/**
 * Ground-truth audit: re-solve EVERY shipped level from scratch with the real
 * search and confirm it is winnable within its shipped budget under the
 * CURRENT rules. (genLevels proves this at generation time; this re-proves it
 * against the code as it stands today.)  Usage: npx tsx scripts/verifyAllLevels.mts
 */
import { LEVELS } from '../src/levels'
import { BoardState } from '../src/systems/BoardState'
import { searchMinMoves } from '../src/systems/SolverSearch'

let bad = 0
const t0 = Date.now()
for (const level of LEVELS) {
  const board = new BoardState({ ...level, moveBudget: 999 })
  const min = searchMinMoves(board, level.moveBudget, 8_000_000)
  if (min === null) {
    console.log(`L${level.id}: UNSOLVABLE within budget ${level.moveBudget}`)
    bad++
  } else if (min > level.moveBudget) {
    console.log(`L${level.id}: min ${min} > budget ${level.moveBudget}`)
    bad++
  }
  if (level.id % 50 === 0) console.log(`...through L${level.id} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
}
console.log(bad === 0 ? `ALL ${LEVELS.length} LEVELS SOLVABLE WITHIN BUDGET ✓` : `${bad} level(s) FAILED`)
process.exit(bad === 0 ? 0 : 1)
