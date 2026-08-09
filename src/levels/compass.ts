import type { BeeSpec, Direction, LevelData, OccupantKind } from '../types'
import generated from './compass.generated.json'

/**
 * The 50 Compass Hive levels — the rotation mode's own ladder, generated
 * offline by `npx tsx scripts/genCompassLevels.ts` and shipped as static JSON
 * (same never-at-runtime contract as the campaign's 300).
 */
interface RawCompassLevel {
  id: number
  cells: number[][]
  honeyCells?: number[][]
  bees: Array<{ q: number; r: number; dir: number; kind: string; color?: number }>
  moveBudget: number
  threeStarSpare: number
  gates: number[][]
}

const COMPASS_LEVELS: ReadonlyArray<LevelData> = (generated.levels as RawCompassLevel[]).map(
  (l) => ({
    id: l.id,
    cells: l.cells.map((c) => [c[0], c[1]] as readonly [number, number]),
    honeyCells: (l.honeyCells ?? []).map((c) => [c[0], c[1]] as readonly [number, number]),
    bees: l.bees.map(
      (b): BeeSpec => ({
        q: b.q,
        r: b.r,
        dir: b.dir as Direction,
        kind: b.kind as OccupantKind,
        color: b.color,
      }),
    ),
    moveBudget: l.moveBudget,
    threeStarSpare: l.threeStarSpare,
    compass: true,
    gates: l.gates.map(
      (g) => [g[0], g[1], g[2], g[3]] as readonly [number, number, number, number],
    ),
  }),
)

export { COMPASS_LEVELS }
export const COMPASS_COUNT = COMPASS_LEVELS.length

/** 0-based index → compass level; clamped. */
export function getCompassLevel(index: number): LevelData {
  const i = Math.max(0, Math.min(COMPASS_LEVELS.length - 1, index))
  return COMPASS_LEVELS[i]
}
