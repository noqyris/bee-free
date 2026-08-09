/**
 * Trial-generate a few slots under the CURRENT curve, timed — a cheap probe
 * before committing to a full (hour-long) `npm run gen:levels`. Prints the
 * chosen shape, measured planning loss, forced stops and generation time per
 * slot; identical seeds mean a probe result IS the full regen's result.
 *
 *   npx tsx scripts/trialSlots.mts 36 66 141
 */
import { slotFor } from '../src/config/levelCurve'
import { shapeCells, shapeLabel } from '../src/systems/boardShapes'
import { generateLevel } from '../src/systems/LevelGenerator'
import { BoardState } from '../src/systems/BoardState'
import { searchMinMoves } from '../src/systems/SolverSearch'

const ids = process.argv.slice(2).map(Number)
for (const id of ids) {
  const slot = slotFor(id)
  const cells = shapeCells(slot.shape)
  const t0 = Date.now()
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
    maxForcedStops: slot.maxForcedStops,
    honeyLakes: slot.honeyLakes,
    floodCoverage: slot.floodCoverage,
    plannerFloor: slot.plannerFloor,
    plannerTarget: slot.plannerTarget,
    restarts: slot.restarts,
    seed: slot.seed,
    attempts: slot.attempts,
  })
  const genMs = Date.now() - t0
  const budget = minMoves + slot.slack
  const t1 = Date.now()
  const board = new BoardState({
    id,
    cells: cells.map(([q, r]) => [q, r] as [number, number]),
    honeyCells,
    bees: occupants.map((o) => ({ q: o.q, r: o.r, dir: o.dir, kind: o.kind })),
    moveBudget: budget,
    threeStarSpare: 0,
  })
  const verified = searchMinMoves(board, budget, 8_000_000)
  const verifyMs = Date.now() - t1
  const goals = metrics.beeCount
  console.log(
    `L${id}: shape=${shapeLabel(slot.shape)}(${cells.length}c) bees=${goals} lakes=${slot.honeyLakes} ` +
      `slack=${slot.slack} floor=${slot.planningFloor.toFixed(2)} → greedy=${planningLoss.toFixed(2)} ` +
      `plannerFloor=${slot.plannerFloor.toFixed(2)} → planner=${plannerLoss.toFixed(2)} ` +
      `min=${minMoves} stops=${minMoves - goals} verified=${verified} gen=${(genMs / 1000).toFixed(1)}s verify=${(verifyMs / 1000).toFixed(1)}s`,
  )
}
